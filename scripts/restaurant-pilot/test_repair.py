import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch,MagicMock
import urllib.robotparser
import contextlib
import io

from collector import RobotsPolicy,now
from health import check_runtime
from pilot import connect
from repair import requeue,repair
import background
from worker import DEFAULT_CONFIG,write_json,config_at
from test_pilot import SEED


class RepairTests(unittest.TestCase):
    def test_repair_preserves_daily_usage_backs_up_and_resumes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);service=root/'service';data=service/'data';data.mkdir(parents=True)
            runtime=service/'runtime';runtime.mkdir();(runtime/'old.py').write_text('# original runtime\n')
            plist=root/'agent.plist';plist.touch();write_json(data/'control.json',DEFAULT_CONFIG)
            db=connect(data/'pilot.sqlite')
            result={'pages':[{'error':'CERTIFICATE_VERIFY_FAILED'}],'observations':[]}
            db.execute('INSERT INTO restaurants(id,priority,seed,status,result,updated_at) VALUES(?,?,?,?,?,?)',
                       ('tls',0,json.dumps(SEED),'fetch_error',json.dumps(result),now()));db.commit();db.close()
            with contextlib.closing(sqlite3.connect(data/'usage.sqlite')) as usage, usage:
                usage.execute('CREATE TABLE daily_usage(day TEXT PRIMARY KEY, requests INTEGER)')
                usage.execute("INSERT INTO daily_usage VALUES('2026-09-07',11037)")
            with patch.multiple(background,DATA=data,SERVICE=service,PLIST=plist),patch.object(background,'launch'),patch.object(background,'install') as update,patch('repair.check_runtime',return_value={'ok':True}),contextlib.redirect_stdout(io.StringIO()):
                repair();update.assert_called_once_with(data)
            self.assertFalse(config_at(data)['paused'])
            with contextlib.closing(sqlite3.connect(data/'usage.sqlite')) as usage, usage:
                self.assertEqual(usage.execute('SELECT requests FROM daily_usage').fetchone()[0],11037)
            saved=next((data/'backups').iterdir())
            self.assertTrue((saved/'runtime/old.py').exists())
            with contextlib.closing(sqlite3.connect(saved/'pilot.sqlite')) as prior:
                self.assertEqual(prior.execute('SELECT status FROM restaurants').fetchone()[0],'fetch_error')
            with contextlib.closing(sqlite3.connect(data/'pilot.sqlite')) as current:
                self.assertEqual(current.execute('SELECT status FROM restaurants').fetchone()[0],'pending')

    def test_custom_rules_leave_modern_stdlib_groups_dictionary_intact(self):
        # Recent CPython crawl_delay/request_rate call self.groups.get().
        sentinel=object()
        def modern_parse(parser,lines):
            parser.groups={'*':sentinel};parser.modified()
        with patch.object(urllib.robotparser.RobotFileParser,'parse',modern_parse):
            policy=RobotsPolicy();policy.parse(['User-agent: *','Disallow: /private'])
        self.assertIs(policy.groups.get('*'),sentinel)
        self.assertFalse(policy.can_fetch('GoodEatsResearchBot','https://example.com/private'))
        self.assertTrue(policy.can_fetch('GoodEatsResearchBot','https://example.com/public'))

    def test_empty_ca_store_fails_before_any_network_connection(self):
        context=MagicMock();context.get_ca_certs.return_value=[]
        with patch('health.ssl.create_default_context',return_value=context),patch('health.public_addresses') as lookup:
            report=check_runtime()
        self.assertFalse(report['ok']);self.assertIn('root certificates',report['error']);lookup.assert_not_called()

    def test_only_affected_rows_requeued_without_losing_facts_or_repeating(self):
        with tempfile.TemporaryDirectory() as temporary:
            db=connect(Path(temporary)/'pilot.sqlite')
            for identifier,error in [('tls','[SSL: CERTIFICATE_VERIFY_FAILED] unable to get local issuer'),
                                     ('parser',"'list' object has no attribute 'get'"),('denied','robots_disallowed'),('dns','DNS failed')]:
                result={'pages':[{'error':error}],'observations':[{'field':'test','value':'preserved'}]}
                db.execute('INSERT INTO restaurants(id,priority,seed,status,attempts,result,updated_at) VALUES(?,?,?,?,?,?,?)',
                           (identifier,0,json.dumps(SEED),'fetch_error',3,json.dumps(result),now()))
            db.commit()
            self.assertEqual(requeue(db),2)
            self.assertEqual(requeue(db),0)
            self.assertEqual({r[0] for r in db.execute("SELECT id FROM restaurants WHERE status='pending'")},{'tls','parser'})
            result=json.loads(db.execute("SELECT result FROM restaurants WHERE id='tls'").fetchone()[0])
            self.assertEqual(result['observations'][0]['value'],'preserved')
            self.assertIn('CERTIFICATE_VERIFY_FAILED',result['pages'][0]['error']);db.close()


if __name__=='__main__': unittest.main()
