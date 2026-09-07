import csv
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from collector import extract,collect,Response,Fetcher
from completeness import readiness
from enrichment import text_facts,text_matches_branch,menu_estimate,pdf_text
from test_pilot import SEED,document,html

TEXT='''Excellent Bistro
10 Main Street, New York, NY
Cuisine: French
Price range: $25-$45
Hours
Monday - Friday 11:00 AM - 10:00 PM
Saturday - Sunday 12:00 PM - 10:00 PM
'''


class EnrichmentTests(unittest.TestCase):
    def test_estimates_export_separately_and_expire_with_evidence(self):
        from pilot import connect
        from worker import initialize
        from exports import export_finished
        from collector import now
        menu='\nEntrees\nPasta $20\nSalmon $30\nSteak $40'
        facts=text_facts(TEXT.replace('Price range: $25-$45','')+menu,SEED['website'],SEED)
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary);db=connect(output/'pilot.sqlite');initialize(db)
            db.execute('INSERT INTO restaurants VALUES(?,?,?,?,?,?,?)',(SEED['id'],0,json.dumps(SEED),'facts_found',1,json.dumps({'observations':facts}),now()));db.commit()
            summary=export_finished(db,output)
            self.assertEqual(summary['complete_restaurants'],0)
            with (output/'menu-estimates.csv').open() as handle: rows=list(csv.DictReader(handle))
            self.assertEqual(len(rows),1);self.assertEqual(rows[0]['review_required'],'true')
            self.assertIn('price_range',rows[0]['missing_fields'])
            db.execute("UPDATE menu_estimates SET expires_at='2000-01-01'");db.commit()
            export_finished(db,output)
            with (output/'menu-estimates.csv').open() as handle: self.assertEqual(list(csv.DictReader(handle)),[])
            db.close()

    def test_upgrade_preserves_settings_and_does_not_reinstall_source_agent(self):
        import background,enrichment_upgrade
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temporary:
            service=Path(temporary);data=service/'data';data.mkdir()
            (data/'pilot.sqlite').touch();plist=service/'collector.plist';plist.touch()
            python=service/'source-python/bin/python';python.parent.mkdir(parents=True);python.touch()
            with patch.multiple(background,SERVICE=service,DATA=data,PLIST=plist),patch('enrichment_upgrade.subprocess.run',return_value=SimpleNamespace(returncode=0)),patch('enrichment_upgrade.repair') as repair,patch.object(background,'launch') as launch:
                enrichment_upgrade.upgrade()
            repair.assert_called_once_with();launch.assert_not_called()

    def test_version_upgrade_retries_readable_incomplete_sites_once(self):
        from pilot import connect
        from worker import initialize,schedule_rechecks,DEFAULT_CONFIG
        from collector import now
        with tempfile.TemporaryDirectory() as temporary:
            db=connect(Path(temporary)/'pilot.sqlite');initialize(db)
            for identifier,status,pages,facts in [('readable','no_facts',[{'status':200}],[]),
                 ('blocked','fetch_error',[{'error':'robots_disallowed'}],[]),
                 ('finished','facts_found',[{'status':200}],extract(html(document()),SEED['website'],SEED)[0])]:
                db.execute('INSERT INTO restaurants VALUES(?,?,?,?,?,?,?)',(identifier,0,json.dumps(SEED),status,1,json.dumps({'collector_version':'0.6','pages':pages,'observations':facts}),now()))
            db.commit();schedule_rechecks(db,DEFAULT_CONFIG)
            self.assertEqual({r[0] for r in db.execute("SELECT id FROM restaurants WHERE status='pending'")},{'readable'})
            db.execute("UPDATE restaurants SET status='no_facts' WHERE id='readable'");db.commit()
            schedule_rechecks(db,DEFAULT_CONFIG)
            self.assertEqual(db.execute("SELECT count(*) FROM restaurants WHERE status='pending'").fetchone()[0],0)
            db.close()

    def test_plain_html_can_complete_without_schema(self):
        page='<html>'+''.join('<p>'+line+'</p>' for line in TEXT.splitlines())+'</html>'
        facts,_=extract(page,SEED['website'],SEED)
        self.assertTrue(readiness(SEED,facts)['complete'])
        self.assertEqual(next(f['value'] for f in facts if f['field']=='price_range'),'$25-$45')

    def test_text_requires_exact_branch_and_rejects_other_locations(self):
        self.assertTrue(text_matches_branch(TEXT,SEED))
        for text in [TEXT.replace('10 Main','100 Main'),TEXT.replace('New York','Boston'),
                     TEXT.replace('Excellent Bistro','Another Bistro'),TEXT+'\n20 Other Street, Brooklyn\n']:
            self.assertEqual(text_facts(text,SEED['website'],SEED),[])
        wrong=html(document(geo={'latitude':0,'longitude':0}))+'<p>'+TEXT+'</p>'
        self.assertFalse(readiness(SEED,extract(wrong,SEED['website'],SEED)[0])['complete'])

    def test_fixed_menu_preserves_basis_and_never_guesses_a_dollar_rating(self):
        facts=text_facts(TEXT.replace('Price range: $25-$45','Tasting menu: $85 per person'),SEED['website'],SEED)
        price=next(f for f in facts if f['field']=='price_range')
        self.assertEqual(price['value'],'$85-$85 per person')
        self.assertEqual(price['price_basis'],'published_fixed_menu_per_person')
        no_price=TEXT.replace('Price range: $25-$45','Soup $12 and steak $45')
        self.assertIn('price_range',readiness(SEED,text_facts(no_price,SEED['website'],SEED))['missing_fields'])

    def test_estimated_entree_prices_stay_out_of_complete_gate(self):
        menu='\nEntrees\nPasta $20\nSalmon $30\nSteak $40\nAdd shrimp $10\nDesserts\nCake $8'
        estimate=menu_estimate(menu)
        self.assertEqual(estimate['sample_count'],3);self.assertEqual(estimate['median'],30)
        facts=text_facts(TEXT.replace('Price range: $25-$45','')+menu,SEED['website'],SEED)
        self.assertTrue(any(f['field']=='menu_price_estimate' for f in facts))
        self.assertFalse(readiness(SEED,facts)['complete'])
        self.assertIsNone(menu_estimate(menu.replace('Entrees','Cocktails')))

    def test_pdf_links_from_schema_use_shared_fetcher_and_match_branch(self):
        menu='https://assets.example/menu.pdf'
        root=html(document(priceRange=None,hasMenu=menu))
        fetcher=Fetcher('test');calls=[]
        def get(url):
            calls.append(url)
            return Response(url,200,{'content-type':'text/html' if url==SEED['website'] else 'application/pdf'},root.encode() if url==SEED['website'] else b'%PDF-test')
        with patch.object(fetcher,'get',side_effect=get),patch('enrichment.pdf_text',return_value=TEXT.split('Hours')[0].replace('Cuisine: French','')):
            result=collect(SEED,fetcher,3)
        self.assertEqual(calls,[SEED['website'],menu])
        self.assertTrue(readiness(SEED,result['observations'])['complete'])
        self.assertTrue(any(p.get('document_type')=='pdf' for p in result['pages']))

    def test_dinner_pdf_without_menu_in_its_url_is_discovered(self):
        menu='https://assets.example/12345.pdf'
        root=html(document(priceRange=None))+f'<a href="{menu}">Dinner</a>'
        def get(url):
            return Response(url,200,{'content-type':'text/html' if url==SEED['website'] else 'application/pdf'},root.encode() if url==SEED['website'] else b'%PDF-test')
        fetcher=Fetcher('test')
        with patch.object(fetcher,'get',side_effect=get),patch('enrichment.pdf_text',return_value=TEXT.split('Hours')[0].replace('Cuisine: French','')):
            result=collect(SEED,fetcher,3)
        self.assertTrue(readiness(SEED,result['observations'])['complete'])

    def test_restricted_pdf_not_parsed_and_failed_pdf_does_not_drop_facts(self):
        menu=SEED['website']+'menu.pdf'
        root=html(document(priceRange=None,hasMenu=menu))
        fetcher=Fetcher('test')
        def get(url):
            return Response(url,200,{'content-type':'text/html'} if url==SEED['website'] else {'content-type':'application/pdf','x-robots-tag':'noarchive'},root.encode() if url==SEED['website'] else b'%PDF-test')
        with patch.object(fetcher,'get',side_effect=get),patch('enrichment.pdf_text') as parse:
            result=collect(SEED,fetcher,3)
        parse.assert_not_called()
        self.assertTrue(result['observations']);self.assertFalse(readiness(SEED,result['observations'])['complete'])
        self.assertEqual(result['pages'][-1]['skip'],'publisher_restriction')

    def test_real_pdf_decoder(self):
        try:
            from pypdf import PdfWriter
            from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject
        except ImportError: self.skipTest('pypdf optional in crawler runtime; required in isolated document runtime')
        writer=PdfWriter();page=writer.add_blank_page(width=612,height=792)
        font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
        page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):writer._add_object(font)})})
        stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 40 740 Td (Excellent Bistro) Tj ET')
        page[NameObject('/Contents')]=writer._add_object(stream)
        data=io.BytesIO();writer.write(data)
        self.assertIn('Excellent Bistro',pdf_text(data.getvalue()))
        with self.assertRaises(ValueError): pdf_text(b'%PDF-broken')


if __name__=='__main__': unittest.main()
