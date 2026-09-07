import contextlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from collector import now
from pilot import connect
from worker import initialize,get_state,set_state,write_json,DEFAULT_CONFIG,DailyBudget,run
from catalog_growth import grow_catalog
from test_pilot import SEED


def candidate(i,**changes):
    return {**SEED,'id':str(i),'name':f'Place {i}','address':f'{i+1} Main Street','category':'restaurant',**changes}


def save(path,rows):path.write_text(''.join(json.dumps(row)+'\n' for row in rows))


class GrowthTests(unittest.TestCase):
    def test_full_queue_grows_without_requests_or_discarding_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary);db=connect(output/'pilot.sqlite')
            for i in range(200):
                row=candidate(i)
                db.execute('INSERT INTO restaurants VALUES(?,?,?,?,?,?,?)',(row['id'],i,json.dumps(row),'pending',0,None,now()))
            db.commit();initialize(db)
            save(output/'candidates.jsonl',[candidate(i) for i in range(205)])
            self.assertEqual(grow_catalog(db,output,limit=3),3)
            self.assertEqual(grow_catalog(db,output,limit=3),2)
            self.assertEqual(grow_catalog(db,output),0)
            self.assertEqual(db.execute('SELECT count(*) FROM restaurants').fetchone()[0],205)
            self.assertEqual(db.execute('SELECT count(*) FROM runs').fetchone()[0],0)
            self.assertFalse((output/'usage.sqlite').exists());db.close()

    def test_no_website_deduplication_and_new_source_resume(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary);db=connect(output/'pilot.sqlite');initialize(db)
            source=output/'candidates.jsonl';row=candidate(1,website=None)
            save(source,[row,{**row,'id':'duplicate'},candidate(2,country='CA'),candidate(3,lat=None)])
            self.assertEqual(grow_catalog(db,output),1)
            self.assertEqual(db.execute('SELECT status FROM restaurants').fetchone()[0],'no_website')
            self.assertTrue(get_state(db,'catalog_pool_exhausted'))
            save(source,[row,candidate(4)])
            self.assertEqual(grow_catalog(db,output),1)
            self.assertEqual(db.execute('SELECT count(*) FROM restaurants').fetchone()[0],2);db.close()

    def test_scan_budget_advances_even_if_records_are_duplicates(self):
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary);db=connect(output/'pilot.sqlite');initialize(db)
            save(output/'candidates.jsonl',[candidate(1)]*4+[candidate(2)])
            self.assertEqual(grow_catalog(db,output,scan_limit=2),1)
            self.assertEqual(grow_catalog(db,output,scan_limit=2),0)
            self.assertGreater(get_state(db,'catalog_pool_offset'),0)
            self.assertEqual(grow_catalog(db,output,scan_limit=2),1);db.close()

    def test_pause_stops_import_and_daily_http_limit_does_not(self):
        import logging
        for paused,expected in [(True,0),(False,2)]:
            with tempfile.TemporaryDirectory() as temporary:
                output=Path(temporary);db=connect(output/'pilot.sqlite');initialize(db);db.close()
                save(output/'candidates.jsonl',[candidate(1),candidate(2,website=None)])
                write_json(output/'control.json',{**DEFAULT_CONFIG,'catalog_growth_enabled':True,'daily_requests':1,'paused':False})
                budget=DailyBudget(output,1);budget.reserve();budget.close()
                write_json(output/'control.json',{**DEFAULT_CONFIG,'catalog_growth_enabled':True,'daily_requests':1,'paused':paused})
                with patch('worker.check_runtime',side_effect=AssertionError('No website checks needed')):run(output,once=True)
                with contextlib.closing(connect(output/'pilot.sqlite')) as db:
                    self.assertEqual(db.execute('SELECT count(*) FROM restaurants').fetchone()[0],expected)
                budget=DailyBudget(output,1);self.assertEqual(budget.used(),1);budget.close()
                for handler in logging.getLogger('collector').handlers[:]:
                    handler.close();logging.getLogger('collector').removeHandler(handler)


if __name__=='__main__':unittest.main()
