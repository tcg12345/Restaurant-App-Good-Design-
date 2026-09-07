import json
import unittest
from unittest.mock import patch
import tempfile
from pathlib import Path
from types import SimpleNamespace

from schedules import normalize_schedule,labelled_schedule
from seed import classify
from collector import extract,collect,Response,Fetcher
from completeness import readiness
from test_pilot import SEED,document,html
from national_source import balance,adopt
from pilot import connect
from worker import initialize,write_json,get_state


class NationalTests(unittest.TestCase):
    def test_upgrade_uses_isolated_source_runtime_and_owned_launch_label(self):
        import upgrade,background,plistlib
        from worker import DEFAULT_CONFIG,config_at
        with tempfile.TemporaryDirectory() as temporary:
            home=Path(temporary);service=home/'Application Support/Collector';data=service/'data';data.mkdir(parents=True)
            (data/'pilot.sqlite').touch();write_json(data/'control.json',DEFAULT_CONFIG)
            plist=home/'Library/LaunchAgents/com.goodeats.restaurant-collector.plist';plist.parent.mkdir(parents=True);plist.touch()
            source_python=service/'source-python/bin/python';source_python.parent.mkdir(parents=True);source_python.touch()
            def fake_repair(before_install): before_install(data,home/'backup')
            with patch.multiple(background,SERVICE=service,DATA=data,PLIST=plist),patch.object(Path,'home',return_value=home),patch('upgrade.subprocess.run',return_value=SimpleNamespace(returncode=0)),patch('upgrade.repair',side_effect=fake_repair),patch.object(background,'launch',return_value=SimpleNamespace(returncode=0)):
                upgrade.upgrade()
            settings=plistlib.loads((plist.parent/'com.goodeats.restaurant-source.plist').read_bytes())
            self.assertEqual(settings['ProgramArguments'][0],str(source_python))
            self.assertEqual(settings['Label'],'com.goodeats.restaurant-source')
            self.assertEqual(config_at(data)['daily_requests'],500000)
            self.assertEqual(config_at(data)['workers'],48)

    def test_locality_balancing_and_atomic_adoption_preserve_existing_data(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary);sources=output/'nationwide-source';sources.mkdir()
            raw=sources/'raw.jsonl';pool=sources/'balanced.jsonl'
            rows=[{**SEED,'id':str(i),'name':f'Restaurant {i}','address':f'{10+i} Main Street',
                   'category':'restaurant','locality':city,'region':'TX','selection_score':100-i,
                   'selection_reason':'nationwide_us'} for i,city in enumerate(['Dallas','Dallas','Frisco','Cary'])]
            raw.write_text(''.join(json.dumps(row)+'\n' for row in rows))
            report=balance(raw,pool,output/'national-coverage.json')
            cities=[json.loads(line)['locality'] for line in pool.read_text().splitlines()]
            self.assertEqual(len(set(cities[:3])),3);self.assertEqual(cities[-1],'Dallas')
            self.assertEqual(report['named_localities'],3)
            write_json(output/'nationwide-ready.json',report)
            (output/'candidates.jsonl').write_text('old source\n')
            db=connect(output/'pilot.sqlite');initialize(db)
            self.assertTrue(adopt(db,output))
            self.assertEqual(db.execute('SELECT count(*) FROM restaurants').fetchone()[0],4)
            self.assertFalse(adopt(db,output))
            self.assertEqual((output/'source-backups/pre-national-candidates.jsonl').read_text(),'old source\n')
            # Recover a journal left after the DB commit without resetting the cursor.
            offset=get_state(db,'pool_offset');write_json(output/'source-adoption.json',report)
            self.assertTrue(adopt(db,output));self.assertEqual(get_state(db,'pool_offset'),offset)
            db.close()

    def test_rural_and_suburban_places_no_longer_need_a_market_radius(self):
        for name,lat,lng,locality,region in [('Rural Diner',46.0,-100.0,'Small Town','ND'),
                                             ('Suburban Grill',33.17,-96.75,'Frisco','TX')]:
            row={**SEED,'name':name,'lat':lat,'lng':lng,'locality':locality,'region':region,
                 'websites':['https://example.com'],'confidence':.9}
            result=classify(row,{},markets=[],nationwide=True)
            self.assertEqual(result['selection_reason'],'nationwide_us')
            self.assertIn(locality,result['market'])
            self.assertIsNone(classify(row,{},markets=[]))

    def test_ampm_closed_days_and_multiple_services_are_preserved(self):
        values=normalize_schedule(['Mo: Closed','Tu-Fr 11:30 AM - 2:00 PM, 5:00 PM - 10:00 PM','Sa-Su 12:00-23:00'])
        self.assertEqual(len(values),11)
        self.assertEqual(values[0],{'dayOfWeek':'Monday','opens':'00:00','closes':'00:00'})
        self.assertEqual(values[2]['opens'],'17:00')
        self.assertIsNone(normalize_schedule('Mo-Fr 5-10pm'))
        self.assertIsNone(normalize_schedule('Mo-Fr 13:99-17:00'))
        parsed,_=labelled_schedule('Hours & Location Sunday Closed Monday - Thursday 5:00 pm - 8:30 pm Friday 5:00 pm - 9:30 pm Saturday 11:30 am - 2:00pm 5:00 pm - 9:30 pm Get Directions')
        saturday=[v for v in parsed if v['dayOfWeek']=='Saturday']
        self.assertEqual([(v['opens'],v['closes']) for v in saturday],[('11:30','14:00'),('17:00','21:30')])

    def test_visible_hours_require_branch_evidence_and_general_schedule(self):
        page=html(document(openingHoursSpecification=None,openingHours=None))+'<h2>Hours</h2><p>Monday - Friday 11:00 AM - 10:00 PM Saturday - Sunday 12:00 PM - 11:00 PM</p>'
        observations,_=extract(page,SEED['website'],SEED)
        self.assertTrue(readiness(SEED,observations)['complete'])
        for altered in [page.replace('Hours','Happy Hours'),page.replace('Hours','Hours: Brunch')]:
            observations,_=extract(altered,SEED['website'],SEED)
            self.assertFalse(readiness(SEED,observations)['complete'])
        observations,_=extract(page.replace('10 Main Street','999 Other Street'),SEED['website'],{**SEED,'lat':0,'lng':0})
        self.assertFalse(readiness(SEED,observations)['complete'])

    def test_deeper_visit_continues_without_redownloading_previous_pages(self):
        start=SEED['website'];menu=start.rstrip('/')+'/menu'
        partial={'pages':[{'url':start,'status':200}],'observations':[],'remaining_urls':[menu],'deeper_due':True}
        fetcher=Fetcher('test')
        with patch.object(fetcher,'get',return_value=Response(menu,200,{'content-type':'text/html'},html(document()).encode())) as get:
            result=collect(SEED,fetcher,2,partial)
        get.assert_called_once_with(menu)
        self.assertTrue(readiness(SEED,result['observations'])['complete'])
        self.assertFalse(result['deeper_due'])


if __name__=='__main__': unittest.main()
