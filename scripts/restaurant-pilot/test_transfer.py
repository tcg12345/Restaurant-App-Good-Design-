import contextlib
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch
import zipfile

import background
from pilot import connect
from transfer import package, install, validate
from worker import DEFAULT_CONFIG, initialize, set_state, get_state, write_json


class TransferTests(unittest.TestCase):
    def source(self, root):
        data=root/'source';data.mkdir()
        (data/'candidates.jsonl').write_text('{}\n{}\n')
        db=connect(data/'pilot.sqlite');initialize(db)
        pool=data/'candidates.jsonl'
        with db:
            set_state(db,'pool_offset',3)
            set_state(db,'pool_signature',[str(pool.resolve()),pool.stat().st_size,pool.stat().st_mtime_ns])
        db.close()
        with sqlite3.connect(data/'usage.sqlite') as usage:
            usage.execute('CREATE TABLE daily_usage(day TEXT PRIMARY KEY, requests INTEGER NOT NULL)')
            usage.execute("INSERT INTO daily_usage VALUES('2026-09-07',1244)")
        write_json(data/'control.json',{**DEFAULT_CONFIG,'workers':4})
        return data

    def unpack(self,root):
        source=self.source(root);archive=root/'move.zip'
        with contextlib.redirect_stdout(io.StringIO()): package(source,archive)
        with zipfile.ZipFile(archive) as zipped: zipped.extractall(root/'unpacked')
        return source,root/'unpacked/GoodEats-Mac-Transfer/data'

    def test_roundtrip_preserves_cursor_budget_settings_and_starts_paused(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);source,data=self.unpack(root)
            self.assertFalse(json.loads((source/'control.json').read_text())['paused'])
            service=root/'other-mac/GoodEatsCollector';destination=service/'data'
            with patch.multiple(background,SERVICE=service,DATA=destination,PLIST=root/'collector.plist'),patch.object(background,'install') as start:
                with contextlib.redirect_stdout(io.StringIO()): install(data)
                start.assert_called_once_with(destination)
            self.assertTrue(json.loads((destination/'control.json').read_text())['paused'])
            self.assertEqual(json.loads((destination/'control.json').read_text())['workers'],4)
            with sqlite3.connect(destination/'pilot.sqlite') as db:
                self.assertEqual(get_state(db,'pool_offset'),3)
                self.assertEqual(get_state(db,'pool_signature')[0],str((destination/'candidates.jsonl').resolve()))
            with sqlite3.connect(destination/'usage.sqlite') as usage:
                self.assertEqual(usage.execute('SELECT requests FROM daily_usage').fetchone()[0],1244)

    def test_tampered_snapshot_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            _,data=self.unpack(Path(temporary))
            (data/'candidates.jsonl').write_text('changed\n')
            with self.assertRaisesRegex(ValueError,'integrity'): validate(data)

    def test_existing_mac_collector_is_never_overwritten(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);data=root/'existing';data.mkdir()
            with patch.multiple(background,DATA=data,PLIST=root/'agent.plist'),patch.object(background,'install') as start:
                with self.assertRaisesRegex(ValueError,'already exists'): install(root/'missing')
                start.assert_not_called()


if __name__=='__main__': unittest.main()
