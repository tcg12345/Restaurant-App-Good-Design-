import csv
import contextlib
import io
import json
import plistlib
import sqlite3
import sys
import tempfile
import unittest
from datetime import datetime,timezone,timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from collector import now,extract
from completeness import REQUIRED
from exports import export,export_finished,map_eligible,HEADERS
from pilot import connect
from test_pilot import SEED,document,html


def observations(): return extract(html(document()),SEED['website'],SEED)[0]


def insert(db,identifier,fields=(),seed=None,status='facts_found',attempts=1):
    facts=[o for o in observations() if o['field'] in fields]
    seed={**(seed or SEED),'id':identifier,'dataset':'Overture Places','release':'2026-08-19.0','source_uri':'s3://example/places'}
    db.execute('INSERT INTO restaurants VALUES(?,?,?,?,?,?,?)',(identifier,0,json.dumps(seed),status,attempts,json.dumps({'observations':facts}),now()));db.commit()


class CatalogTests(unittest.TestCase):
    def test_zero_through_three_details_all_export_with_exact_flags(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary);db=connect(output/'pilot.sqlite')
            for i in range(4):insert(db,str(i),REQUIRED[:i])
            insert(db,'queued',(),status='pending',attempts=0)
            insert(db,'no-site',(),seed={**SEED,'website':None},status='no_website',attempts=0)
            insert(db,'failed',(),status='fetch_error')
            with contextlib.redirect_stdout(io.StringIO()):summary=export(db,output)
            self.assertEqual(summary['catalog_restaurants'],7);self.assertEqual(summary['complete_restaurants'],1)
            with (output/'restaurants.csv').open() as f:rows={r['id']:r for r in csv.DictReader(f)}
            for i in range(4):
                self.assertEqual(rows[str(i)]['details_count'],str(i))
                self.assertEqual(rows[str(i)]['fully_completed'],'true' if i==3 else 'false')
                self.assertEqual(json.loads(rows[str(i)]['fallback_fields']),list(REQUIRED[i:]))
                self.assertEqual(float(rows[str(i)]['longitude']),SEED['lng'])
            self.assertEqual(rows['queued']['collection_attempted'],'false')
            self.assertEqual(rows['queued']['last_checked_at'],'')
            self.assertEqual(rows['no-site']['website'],'')
            with (output/'restaurants-complete.csv').open() as f:self.assertEqual(len(list(csv.DictReader(f))),1)
            self.assertEqual(db.execute('SELECT count(*) FROM runs').fetchone()[0],0)
            db.close()

    def test_invalid_identity_excluded_and_zero_longitude_remains_numeric(self):
        for seed in [{**SEED,'country':'CA'},{**SEED,'name':''},{**SEED,'lat':None},{**SEED,'lng':float('nan')},{**SEED,'lat':91}]:
            self.assertFalse(map_eligible(seed))
        self.assertTrue(map_eligible({**SEED,'lng':0}))

    def test_conflict_does_not_hide_other_fields_or_count_as_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary);db=connect(output/'pilot.sqlite');insert(db,'one',REQUIRED)
            facts=observations();price=next(f for f in facts if f['field']=='price_range')
            facts.append({**price,'value':'$$$$'})
            db.execute('UPDATE restaurants SET result=?',(json.dumps({'observations':facts}),));db.commit()
            export_finished(db,output)
            with (output/'restaurants.csv').open() as f:row=next(csv.DictReader(f))
            self.assertEqual(row['details_count'],'2');self.assertEqual(row['price_range'],'')
            self.assertEqual(json.loads(row['fallback_fields']),['price_range'])
            self.assertEqual(json.loads(row['conflicting_fields']),['price_range']);db.close()

    def test_expiry_downgrades_instead_of_removing_catalog_and_refresh_promotes(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary);db=connect(output/'pilot.sqlite');insert(db,'one',REQUIRED)
            self.assertEqual(export_finished(db,output)['complete_restaurants'],1)
            old=(datetime.now(timezone.utc)-timedelta(days=91)).isoformat()
            facts=[{**f,'observed_at':old} for f in observations()]
            db.execute('UPDATE restaurants SET result=?',(json.dumps({'observations':facts}),))
            db.execute("UPDATE catalog_restaurants SET expires_at='2000-01-01'");db.commit()
            summary=export_finished(db,output)
            self.assertEqual(summary['catalog_restaurants'],1);self.assertEqual(summary['complete_restaurants'],0)
            db.execute('UPDATE restaurants SET result=?,updated_at=?',(json.dumps({'observations':observations()}),now()));db.commit()
            self.assertEqual(export_finished(db,output)['complete_restaurants'],1)
            with (output/'restaurants.csv').open() as f:self.assertEqual(len(list(csv.DictReader(f))),1)
            db.close()

    def test_unchanged_export_reuses_serialized_rows_and_new_imports_appear(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary);db=connect(output/'pilot.sqlite');insert(db,'first')
            export_finished(db,output)
            with patch('exports.profile',side_effect=AssertionError('unchanged row recalculated')):export_finished(db,output)
            insert(db,'next',('cuisines',))
            self.assertEqual(export_finished(db,output)['catalog_restaurants'],2)
            with (output/'restaurants.csv').open() as f:rows=list(csv.DictReader(f))
            self.assertEqual(len(rows),2);self.assertEqual(len(HEADERS),len(set(HEADERS)));db.close()

    def test_updater_only_replaces_exports_and_preserves_database_usage_and_config(self):
        import catalog_upgrade,shutil
        with tempfile.TemporaryDirectory() as temporary:
            home=Path(temporary);service=home/'Library/Application Support/GoodEatsCollector';runtime=service/'runtime';runtime.mkdir(parents=True)
            data=service/'data';data.mkdir()
            # Real compatible runtime; launchd mocked, export child actually runs.
            for p in Path(__file__).parent.glob('*.py'):
                if not p.name.startswith('test_'):shutil.copy2(p,runtime/p.name)
            db=connect(data/'pilot.sqlite');insert(db,'saved',('cuisines',));db.close()
            with contextlib.closing(sqlite3.connect(data/'usage.sqlite')) as db,db:
                db.execute('CREATE TABLE daily_usage(day TEXT PRIMARY KEY, requests INTEGER)');db.execute("INSERT INTO daily_usage VALUES('2026-09-07',12345)")
            settings={'paused':False,'workers':32,'daily_requests':250000};(data/'control.json').write_text(json.dumps(settings))
            (data/'candidates.jsonl').write_text('source preserved')
            plist=home/'Library/LaunchAgents/com.goodeats.restaurant-collector.plist';plist.parent.mkdir(parents=True)
            plist.write_bytes(plistlib.dumps({'Label':'com.goodeats.restaurant-collector','ProgramArguments':[sys.executable,str(runtime/'worker.py')]}))
            prior={p.name:p.read_bytes() for p in runtime.glob('*.py') if p.name!='exports.py'}
            real_run=catalog_upgrade.subprocess.run
            def run(args,**kwargs):
                if args[0]=='/bin/launchctl': return SimpleNamespace(returncode=0,stderr='')
                return real_run(args,capture_output=True,**kwargs)
            with patch('catalog_upgrade.subprocess.run',side_effect=run),contextlib.redirect_stdout(io.StringIO()):catalog_upgrade.upgrade(home)
            self.assertEqual(json.loads((data/'control.json').read_text()),settings)
            self.assertEqual((data/'candidates.jsonl').read_text(),'source preserved')
            self.assertTrue(all((runtime/name).read_bytes()==body for name,body in prior.items()))
            with contextlib.closing(sqlite3.connect(data/'usage.sqlite')) as db:self.assertEqual(db.execute('SELECT requests FROM daily_usage').fetchone()[0],12345)
            with (data/'restaurants.csv').open() as f:self.assertEqual(next(csv.DictReader(f))['details_count'],'1')


if __name__=='__main__':unittest.main()
