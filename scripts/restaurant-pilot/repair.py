#!/usr/bin/env python3
"""Repair the installed Mac collector while retaining its data and allowance."""
import fcntl
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time

import background
from collector import now
from health import check_runtime
from transfer import backup
from worker import config_at,write_json

REPAIR_MARKER='python_tls_robots_2026_09_07'


def affected(result):
    if not isinstance(result,dict): return False
    checks=[result]
    if isinstance(result.get('last_check'),dict): checks.append(result['last_check'])
    return any('CERTIFICATE_VERIFY_FAILED' in str(page.get('error','')) or
               "'list' object has no attribute 'get'" in str(page.get('error',''))
               for check in checks for page in check.get('pages',[]) if isinstance(page,dict))


def requeue(db):
    count=0
    with db:
        for identifier,raw in db.execute('SELECT id,result FROM restaurants WHERE result IS NOT NULL').fetchall():
            result=json.loads(raw)
            if affected(result) and result.get('repair_retry') != REPAIR_MARKER:
                result['repair_retry']=REPAIR_MARKER
                db.execute("UPDATE restaurants SET status='pending',attempts=0,result=?,updated_at=? WHERE id=?",
                           (json.dumps(result),now(),identifier))
                count+=1
    return count


def repair(before_install=None):
    data=background.DATA
    if not (data/'pilot.sqlite').is_file() or not background.PLIST.is_file():
        raise SystemExit('Installed collector not found. Run this repair on the Mac mini with the existing installation.')
    write_json(data/'control.json',{**config_at(data),'paused':True})
    report=check_runtime()
    if not report['ok'] and ('CERTIFICATE_VERIFY_FAILED' in report.get('error','') or 'SSLCertVerificationError' in report.get('error','')):
        script=Path('/Applications')/f'Python {sys.version_info.major}.{sys.version_info.minor}'/'Install Certificates.command'
        if not script.exists():
            raise SystemExit('No matching Python certificate installer was found. Collector remains paused.\n'+json.dumps(report,indent=2))
        print('Running the official Python certificate installer: '+str(script),flush=True)
        subprocess.run(['/bin/sh',str(script)],check=True)
        report=check_runtime()
    write_json(data/'health.json',report)
    if not report['ok']:
        raise SystemExit('Runtime verification failed; collector remains paused.\n'+json.dumps(report,indent=2))
    print('HTTPS certificate verification and robots parser checks passed.',flush=True)
    background.launch('bootout',background.TARGET)
    with (data/'worker.lock').open('a') as worker_lock:
        for attempt in range(60):
            try:
                fcntl.flock(worker_lock,fcntl.LOCK_EX|fcntl.LOCK_NB);break
            except BlockingIOError:
                if attempt==59: raise SystemExit('Worker is still draining; keep it paused and rerun this repair shortly.')
                time.sleep(1)
        with (data/'pilot.lock').open('a') as pilot_lock:
            fcntl.flock(pilot_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            saved=data/'backups'/('before-repair-'+str(time.time_ns()));saved.mkdir(parents=True)
            for name in ('pilot.sqlite','usage.sqlite'):
                if (data/name).exists(): backup(data/name,saved/name)
            shutil.copy2(data/'control.json',saved/'control.json')
            shutil.copytree(background.SERVICE/'runtime',saved/'runtime')
            db=sqlite3.connect(data/'pilot.sqlite')
            try: count=requeue(db)
            finally: db.close()
            if before_install: before_install(data,saved)
    # The existing database, source pool and daily allowance stay in place.
    background.install(data)
    write_json(data/'control.json',{**config_at(data),'paused':False})
    print(json.dumps({'repair_complete':True,'requeued_restaurants':count,'backup':str(saved),
                      'resumed':True,'daily_allowance_preserved':True},indent=2))


if __name__=='__main__': repair()
