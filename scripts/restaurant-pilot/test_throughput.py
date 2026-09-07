import argparse
import contextlib
import gzip
import io
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch, MagicMock

from collector import collect, Fetcher, Response, read_body, now, COLLECTOR_VERSION
from pilot import connect, crawl
from power import active_awake
from worker import write_json, DEFAULT_CONFIG
from test_pilot import SEED, document, html


class ThroughputTests(unittest.TestCase):
    def test_completed_profile_does_not_fetch_extra_pages(self):
        fetcher=Fetcher('test')
        body=(html(document())+'<a href="/menu">Menu</a><a href="/hours">Hours</a>').encode()
        with patch.object(fetcher,'get',return_value=Response(SEED['website'],200,{'content-type':'text/html'},body)) as get:
            result=collect(SEED,fetcher,5)
            self.assertEqual(get.call_count,1)
            self.assertTrue(result['pages'][0]['collection_complete'])

    def test_gzip_limit_applies_to_expansion_and_truncated_streams(self):
        class Stream(io.BytesIO):
            def getheader(self,name): return 'gzip'
        self.assertEqual(read_body(Stream(gzip.compress(b'hello')),100),b'hello')
        with self.assertRaisesRegex(ValueError,'too_large'):
            read_body(Stream(gzip.compress(b'x'*10000)),1000)
        with self.assertRaisesRegex(ValueError,'invalid_gzip'):
            read_body(Stream(gzip.compress(b'hello')[:-3]),100)

    def test_fast_worker_refills_before_slow_worker_finishes(self):
        with tempfile.TemporaryDirectory() as temporary:
            db=connect(Path(temporary)/'pilot.sqlite')
            for i in range(3):
                seed={**SEED,'id':str(i),'website':f'https://site{i}.example.com'}
                db.execute('INSERT INTO restaurants(id,priority,seed,updated_at) VALUES(?,?,?,?)',(str(i),i,json.dumps(seed),now()))
            db.commit();third_started=threading.Event();outcomes=[]
            def fake(seed,*_):
                if seed['id']=='0': outcomes.append(third_started.wait(2))
                elif seed['id']=='2': third_started.set()
                return {'status':'no_facts','observations':[],'pages':[],'collector_version':COLLECTOR_VERSION}
            args=argparse.Namespace(contact='https://example.com',delay=2,timeout=12,max_requests=100,workers=2,max_pages=5,limit=3,retry_errors=False)
            with patch('pilot.collect',side_effect=fake),contextlib.redirect_stdout(io.StringIO()): crawl(db,args)
            self.assertEqual(outcomes,[True])
            self.assertEqual(db.execute("SELECT count(*) FROM restaurants WHERE status='no_facts'").fetchone()[0],3)
            db.close()

    def test_awake_assertion_released_after_work_and_exception(self):
        process=MagicMock();process.poll.return_value=None
        with tempfile.TemporaryDirectory() as temporary:
            output=Path(temporary);write_json(output/'control.json',DEFAULT_CONFIG)
            with patch('power.subprocess.Popen',return_value=process) as start:
                with self.assertRaises(RuntimeError),active_awake(output,threading.Event(),True):
                    raise RuntimeError('test')
                self.assertEqual(start.call_args.args[0][1],'-i')
                process.terminate.assert_called_once();process.wait.assert_called_once()
            with patch('power.subprocess.Popen') as start:
                with active_awake(output,threading.Event(),False): pass
                start.assert_not_called()

    def test_rate_limited_host_is_deferred_without_another_request(self):
        fetcher=Fetcher('test')
        response=Response(SEED['website'],429,{'retry-after':'3600'},b'')
        with patch.object(fetcher,'_single',return_value=response) as single:
            fetcher._delayed(SEED['website'],100)
            with self.assertRaisesRegex(ValueError,'backoff'):
                fetcher._delayed(SEED['website'],100)
            self.assertEqual(single.call_count,1)

    def test_restaurants_sharing_host_are_serialized(self):
        with tempfile.TemporaryDirectory() as temporary:
            db=connect(Path(temporary)/'pilot.sqlite')
            for i in range(4):
                db.execute('INSERT INTO restaurants(id,priority,seed,updated_at) VALUES(?,?,?,?)',
                           (str(i),i,json.dumps({**SEED,'id':str(i)}),now()))
            db.commit();active=0;peak=0;mutex=threading.Lock()
            def fake(*_):
                nonlocal active,peak
                with mutex: active+=1;peak=max(peak,active)
                time.sleep(.005)
                with mutex: active-=1
                return {'status':'no_facts','observations':[],'pages':[],'collector_version':COLLECTOR_VERSION}
            args=argparse.Namespace(contact='https://example.com',delay=2,timeout=12,max_requests=100,workers=4,max_pages=5,limit=4,retry_errors=False)
            with patch('pilot.collect',side_effect=fake),contextlib.redirect_stdout(io.StringIO()): crawl(db,args)
            self.assertEqual(peak,1);db.close()


if __name__=='__main__': unittest.main()
