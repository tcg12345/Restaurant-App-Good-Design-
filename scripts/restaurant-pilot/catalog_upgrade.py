"""Update only the installed collector's exports, preserving its crawl runtime."""
import fcntl
import hashlib
import json
from pathlib import Path
import plistlib
import shutil
import sqlite3
import subprocess
import sys
import time
from contextlib import closing


def atomic_json(path,value):
    temporary=path.with_suffix(path.suffix+'.partial')
    temporary.write_text(json.dumps(value,indent=2)+'\n');temporary.replace(path)


def snapshot(source,target):
    with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as reader,closing(sqlite3.connect(target)) as writer:
        reader.backup(writer)


def upgrade(home=None,runtime_updates=(),config_updates=None):
    home=Path(home) if home else Path.home()
    service=home/'Library/Application Support/GoodEatsCollector';data=service/'data';runtime=service/'runtime'
    plist=home/'Library/LaunchAgents/com.goodeats.restaurant-collector.plist'
    if not plist.exists() or not (data/'pilot.sqlite').exists() or not (runtime/'exports.py').exists():
        raise SystemExit('Installed collector not found. Run this on the Mac mini with the existing installation.')
    definition=plistlib.loads(plist.read_bytes());python=definition['ProgramArguments'][0]
    target=f'gui/{__import__("os").getuid()}/'+definition['Label']
    new_export=Path(__file__).with_name('exports.py')
    updates={name:Path(__file__).with_name(name) for name in ('exports.py',*runtime_updates)}
    for path in updates.values():compile(path.read_text(),str(path),'exec')
    control=data/'control.json';original=json.loads(control.read_text())
    updated={**original,**(config_updates or {})}
    atomic_json(control,{**original,'paused':True})
    launch=lambda *args: subprocess.run(['/bin/launchctl',*args],capture_output=True,text=True)
    launch('bootout',target)
    saved=None
    try:
        with (data/'worker.lock').open('a') as worker_lock:
            for attempt in range(60):
                try:
                    fcntl.flock(worker_lock,fcntl.LOCK_EX|fcntl.LOCK_NB);break
                except BlockingIOError:
                    if attempt==59: raise RuntimeError('Worker is still draining. Keep it paused and rerun the update shortly.')
                    time.sleep(1)
            with (data/'pilot.lock').open('a') as pilot_lock:
                fcntl.flock(pilot_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                saved=data/'backups'/('before-catalog-'+str(time.time_ns()));saved.mkdir(parents=True)
                snapshot(data/'pilot.sqlite',saved/'pilot.sqlite')
                if (data/'usage.sqlite').exists(): snapshot(data/'usage.sqlite',saved/'usage.sqlite')
                atomic_json(saved/'control.json',original)
                existed={name:(runtime/name).exists() for name in updates}
                for name in updates:
                    if existed[name]:shutil.copy2(runtime/name,saved/name)
                for name in ('restaurants.csv','restaurants.jsonl'):
                    if (data/name).exists(): shutil.copy2(data/name,saved/name)
                for name,path in updates.items():
                    temporary=runtime/(name+'.new');shutil.copy2(path,temporary);temporary.replace(runtime/name)
                script='''from pathlib import Path
from pilot import connect
from exports import export
output=Path(__import__('sys').argv[1]);db=connect(output/'pilot.sqlite')
try: export(db,output)
finally: db.close()
'''
                if config_updates and config_updates.get('catalog_growth_enabled') and not original.get('paused',False):
                    script=script.replace('try: export(db,output)',
                        'try:\n from worker import initialize\n from catalog_growth import grow_catalog\n initialize(db)\n grow_catalog(db,output)\n export(db,output)')
                try:
                    subprocess.run([python,'-c',script,str(data)],cwd=runtime,check=True)
                except Exception:
                    for name in updates:
                        if existed[name]:shutil.copy2(saved/name,runtime/name)
                        else:(runtime/name).unlink(missing_ok=True)
                    for name in ('restaurants.csv','restaurants.jsonl'):
                        if (saved/name).exists(): shutil.copy2(saved/name,data/name)
                    raise
        atomic_json(control,updated)
        result=launch('bootstrap',target.rsplit('/',1)[0],str(plist))
        if result.returncode: raise RuntimeError('Exports updated, but the collector could not restart: '+result.stderr.strip())
        summary=json.loads((data/'summary.json').read_text())
        print(json.dumps({'catalog_update_complete':True,'catalog_restaurants':summary['catalog_restaurants'],
                          'fully_completed':summary['complete_restaurants'],'partial_restaurants':summary['partial_restaurants'],
                          'paused':original.get('paused',False),'backup':str(saved),
                          'crawler_code_changed':bool(runtime_updates),'runtime_files_updated':list(updates),
                          'catalog_growth_enabled':updated.get('catalog_growth_enabled',False),
                          'export_module_sha256':hashlib.sha256(new_export.read_bytes()).hexdigest()},indent=2))
    except Exception as error:
        atomic_json(control,{**original,'paused':True})
        raise SystemExit('Catalog update did not finish; collector remains paused and existing records are retained. '+str(error)) from error


if __name__=='__main__': upgrade()
