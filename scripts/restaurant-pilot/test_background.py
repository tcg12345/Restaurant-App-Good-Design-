import contextlib
import csv
import io
import json
from pathlib import Path
import tempfile
import unittest
import argparse
from unittest.mock import patch
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone,timedelta

from collector import extract, now
from completeness import readiness
from exports import export, export_finished
from pilot import connect, crawl
from worker import DailyBudget, initialize, replenish, write_json, DEFAULT_CONFIG
from test_pilot import SEED, document, html


def facts():
    return extract(html(document()),SEED['website'],SEED)[0]


class CompletenessTests(unittest.TestCase):
    def test_requires_all_three_and_accepts_unknown_hotel(self):
        self.assertTrue(readiness(SEED,facts())['complete'])
        self.assertIsNone(readiness(SEED,facts())['hotel']['in_hotel'])
        self.assertFalse(readiness(SEED,[f for f in facts() if f['field']!='price_range'])['complete'])

    def test_unknown_stale_conflicting_and_foreign_are_excluded(self):
        for field,value in [('price_range','unknown'),('cuisines','N/A'),('hours',', , ,')]:
            values=[{**f,'value':value} if f['field']==field else f for f in facts()]
            self.assertFalse(readiness(SEED,values)['complete'])
        old=(datetime.now(timezone.utc)-timedelta(days=91)).isoformat()
        self.assertFalse(readiness(SEED,[{**f,'observed_at':old} for f in facts()])['complete'])
        price=next(f for f in facts() if f['field']=='price_range')
        self.assertFalse(readiness(SEED,facts()+[{**price,'value':'$$$$'}])['complete'])
        self.assertFalse(readiness({**SEED,'country':'CA'},facts())['complete'])

    def test_string_array_hours_are_usable(self):
        values=extract(html(document(openingHoursSpecification=None,openingHours=['Mo-Fr 11:00-22:00','Sa-Su 12:00-23:00'])),SEED['website'],SEED)[0]
        self.assertTrue(readiness(SEED,values)['complete'])

    def test_finished_exports_never_contain_partial_profiles(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td);db=connect(path/'pilot.sqlite')
            for i,observations in enumerate([facts(),facts()[:1]]):
                seed={**SEED,'id':str(i)}
                db.execute('INSERT INTO restaurants(id,priority,seed,status,result,updated_at) VALUES(?,?,?,?,?,?)',
                    (str(i),i,json.dumps(seed),'facts_found',json.dumps({'observations':observations}),now()))
            db.commit()
            with contextlib.redirect_stdout(io.StringIO()): summary=export(db,path)
            self.assertEqual(summary['complete_restaurants'],1)
            with (path/'restaurants-complete.csv').open() as handle: finished=list(csv.DictReader(handle))
            self.assertEqual(len(finished),1)
            self.assertTrue(all(finished[0][f] for f in ['cuisines','hours','price_range']))
            self.assertEqual(finished[0]['in_hotel'],'unknown')
            with (path/'review.csv').open() as handle: self.assertEqual(len(list(csv.DictReader(handle))),1)
            db.close()


class HotelTests(unittest.TestCase):
    def hotel(self):
        return {'@type':'Hotel','name':'Example Hotel','address':{'streetAddress':'10 Main Street','addressLocality':'New York','addressRegion':'NY'}}

    def test_containment_collects_hotel_identity(self):
        observations=extract(html(document(containedInPlace=self.hotel())),SEED['website'],SEED)[0]
        hotel=readiness(SEED,observations)['hotel']
        self.assertIs(hotel['in_hotel'],True)
        self.assertEqual(hotel['hotel_name'],'Example Hotel')
        self.assertEqual(hotel['hotel_location']['address']['streetAddress'],'10 Main Street')

    def test_hotel_container_and_graph_reference(self):
        for node in [{**self.hotel(),'containsPlace':document()},
                     {'@graph':[{**self.hotel(),'@id':'#hotel'},document(containedInPlace={'@id':'#hotel'})]}]:
            observations=extract(html(node),SEED['website'],SEED)[0]
            self.assertIs(readiness(SEED,observations)['hotel']['in_hotel'],True)

    def test_absence_is_unknown_explicit_negative_is_false(self):
        self.assertIsNone(readiness(SEED,facts())['hotel']['in_hotel'])
        observations=extract(html(document())+'<p>We are not located in a hotel.</p>',SEED['website'],SEED)[0]
        self.assertIs(readiness(SEED,observations)['hotel']['in_hotel'],False)

    def test_unresolved_or_distant_hotel_not_confirmed(self):
        for hotel in [{'@type':'Hotel','name':'Example Hotel'},
                      {**self.hotel(),'geo':{'latitude':34.0,'longitude':-118.0}}]:
            observations=extract(html(document(containedInPlace=hotel)),SEED['website'],SEED)[0]
            self.assertIsNone(readiness(SEED,observations)['hotel']['in_hotel'])


class HtmlTests(unittest.TestCase):
    def test_microdata_nested_postal_address_and_fields(self):
        markup='''<div itemscope itemtype="https://schema.org/Restaurant">
        <span itemprop="name">Excellent Bistro</span>
        <div itemprop="address" itemscope itemtype="https://schema.org/PostalAddress">
        <span itemprop="streetAddress">10 Main Street</span><span itemprop="addressLocality">New York</span></div>
        <meta itemprop="servesCuisine" content="French"><span itemprop="priceRange">$$$</span>
        <time itemprop="openingHours" datetime="Mo-Su 17:00-23:00">Daily evening</time></div>'''
        observations=extract(markup,SEED['website'],SEED)[0]
        self.assertTrue(readiness(SEED,observations)['complete'])
        self.assertEqual({o['method'] for o in observations},{'microdata'})

    def test_explicit_labels_require_branch_and_dont_guess_dish_prices(self):
        markup=html(document(servesCuisine=None,priceRange=None))+'<p>Cuisine: French. Price range: $$$.</p>'
        self.assertTrue(readiness(SEED,extract(markup,SEED['website'],SEED)[0])['complete'])
        self.assertFalse(readiness(SEED,extract('<p>French fries $5</p>',SEED['website'],SEED)[0])['complete'])


class BackgroundTests(unittest.TestCase):
    def test_failed_recheck_retains_fresh_evidence_without_redating(self):
        with tempfile.TemporaryDirectory() as td:
            db=connect(Path(td)/'pilot.sqlite');prior={'observations':facts(),'pages':[],'status':'facts_found'}
            db.execute('INSERT INTO restaurants(id,priority,seed,status,result,updated_at) VALUES(?,?,?,?,?,?)',
                       ('one',1,json.dumps(SEED),'pending',json.dumps(prior),now()));db.commit()
            args=argparse.Namespace(contact='https://example.org/bot',delay=2,timeout=2,max_requests=10,workers=1,max_pages=1,retry_errors=False,limit=1)
            failed={'status':'fetch_error','observations':[],'pages':[{'error':'robots_unavailable_403'}]}
            with patch('pilot.collect',return_value=failed),contextlib.redirect_stdout(io.StringIO()):crawl(db,args)
            saved=json.loads(db.execute('SELECT result FROM restaurants').fetchone()[0])
            self.assertEqual(saved['observations'],prior['observations'])
            self.assertEqual(saved['last_check']['status'],'fetch_error')
            self.assertTrue(readiness(SEED,saved['observations'])['complete']);db.close()

    def test_incremental_export_removes_a_newly_incomplete_record(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td);db=connect(path/'pilot.sqlite');initialize(db)
            db.execute('INSERT INTO restaurants(id,priority,seed,status,result,updated_at) VALUES(?,?,?,?,?,?)',
                       ('one',1,json.dumps(SEED),'facts_found',json.dumps({'observations':facts()}),now()));db.commit()
            self.assertEqual(export_finished(db,path)['complete_restaurants'],1)
            db.execute('UPDATE restaurants SET result=?,updated_at=?',(json.dumps({'observations':[]}),now()));db.commit()
            self.assertEqual(export_finished(db,path)['complete_restaurants'],0)
            self.assertEqual((path/'restaurants-complete.jsonl').read_text(),'')
            self.assertFalse(json.loads((path/'restaurants.jsonl').read_text())['fully_completed']);db.close()

    def test_daily_budget_is_atomic_and_persists_across_restart(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td);budget=DailyBudget(path,5)
            def reserve(_):
                try: budget.reserve();return True
                except ValueError: return False
            with ThreadPoolExecutor(max_workers=8) as pool:
                self.assertEqual(sum(pool.map(reserve,range(20))),5)
            budget.close();budget=DailyBudget(path,5)
            self.assertEqual(budget.used(),5)
            with self.assertRaisesRegex(ValueError,'budget_exhausted'):budget.reserve()
            budget.close()

    def test_pause_prevents_http_reservation(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td);write_json(path/'control.json',{**DEFAULT_CONFIG,'paused':True})
            budget=DailyBudget(path,5)
            with self.assertRaises(ValueError):budget.reserve()
            self.assertEqual(budget.used(),0);budget.close()

    def test_pool_checkpoint_deduplicates_and_excludes_foreign(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td);source=path/'candidates.jsonl';db=connect(path/'pilot.sqlite');initialize(db)
            rows=[{**SEED,'category':'restaurant'}, {**SEED,'id':'duplicate','category':'restaurant'},
                  {**SEED,'id':'foreign','country':'CA','category':'restaurant'},
                  {**SEED,'id':'two','name':'Second Restaurant','category':'restaurant'}]
            source.write_text(''.join(json.dumps(r)+'\n' for r in rows))
            self.assertEqual(replenish(db,source,1),1)
            self.assertEqual(replenish(db,source,10),1)
            self.assertEqual(replenish(db,source,10),0)
            self.assertEqual(db.execute('SELECT count(*) FROM restaurants').fetchone()[0],2);db.close()


if __name__=='__main__':unittest.main()
