#!/usr/bin/env python3
"""Install/control the user-owned macOS background collector. No administrator needed."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import sqlite3
import subprocess
import sys
import time

from worker import DEFAULT_CONFIG, THROUGHPUT_CONFIG, config_at, write_json

LABEL='com.goodeats.restaurant-collector'
SERVICE=Path.home()/'Library/Application Support/GoodEatsCollector'
DATA=SERVICE/'data'
PLIST=Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
TARGET=f'gui/{os.getuid()}/{LABEL}'


def launch(*args):
    return subprocess.run(['/bin/launchctl',*args],capture_output=True,text=True)


def install(source):
    source=source.resolve()
    if not (source/'pilot.sqlite').exists() or not (source/'candidates.jsonl').exists():
        raise SystemExit('The source directory must contain pilot.sqlite and candidates.jsonl.')
    runtime=SERVICE/'runtime';runtime.mkdir(parents=True,exist_ok=True)
    DATA.mkdir(parents=True,exist_ok=True)
    # This label and directory belong only to this collector.
    launch('bootout',TARGET)
    # launchd can return before the old process has drained in-flight requests.
    # Wait for the worker's own lock before replacing/rebootstrapping its runtime.
    with (DATA/'worker.lock').open('a') as handle:
        for attempt in range(60):
            try:
                fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
                fcntl.flock(handle,fcntl.LOCK_UN)
                break
            except BlockingIOError:
                if attempt==59: raise SystemExit('Previous worker has not stopped; retry the update shortly.')
                time.sleep(1)
    for path in Path(__file__).parent.glob('*.py'):
        if not path.name.startswith('test_'):
            if path.resolve() != (runtime/path.name).resolve():
                shutil.copy2(path,runtime/path.name)
    if not (DATA/'pilot.sqlite').exists():
        reader=sqlite3.connect((source/'pilot.sqlite').as_uri()+'?mode=ro',uri=True)
        writer=sqlite3.connect(DATA/'pilot.sqlite')
        try: reader.backup(writer)
        finally: writer.close();reader.close()
    for name in ('candidates.jsonl','source-manifest.json'):
        if (source/name).exists() and not (DATA/name).exists():
            shutil.copy2(source/name,DATA/name)
    if not (DATA/'control.json').exists():
        write_json(DATA/'control.json',DEFAULT_CONFIG)
    config_at(DATA)
    python=sys.executable
    if '/tmp/' in python or '/private/tmp/' in python:
        raise SystemExit('Install with a persistent Python 3.11+ interpreter, not a temporary virtual environment.')
    definition={'Label':LABEL,'ProgramArguments':[python,str(runtime/'worker.py'),'--output',str(DATA)],
                'WorkingDirectory':str(runtime),'RunAtLoad':True,'KeepAlive':True,
                'ProcessType':'Background','Nice':10,'LowPriorityIO':True,'ThrottleInterval':60,
                'ExitTimeOut':60,'StandardOutPath':str(DATA/'launchd.stdout.log'),
                'StandardErrorPath':str(DATA/'launchd.stderr.log'),
                'EnvironmentVariables':{'PYTHONUNBUFFERED':'1','PATH':'/opt/homebrew/bin:/usr/bin:/bin'}}
    PLIST.parent.mkdir(parents=True,exist_ok=True)
    temporary=PLIST.with_suffix('.plist.partial');temporary.write_bytes(plistlib.dumps(definition));temporary.replace(PLIST)
    for attempt in range(4):
        result=launch('bootstrap',f'gui/{os.getuid()}',str(PLIST))
        if result.returncode==0 or launch('print',TARGET).returncode==0:
            break
        if attempt<3: time.sleep(1)
    if result.returncode:
        raise SystemExit('LaunchAgent installation failed: '+result.stderr.strip())
    # Point to the live data without making the background process read Desktop.
    link=source/'live'
    if source != DATA.resolve() and not link.exists() and not link.is_symlink():
        link.symlink_to(DATA,target_is_directory=True)
    print(json.dumps({'installed':True,'label':LABEL,'data':str(DATA),'spreadsheet':str(DATA/'restaurants.csv')},indent=2))


def status():
    result=launch('print',TARGET)
    state={}
    for key in ('state','pid','last exit code'):
        match=re.search(r'^\s*'+re.escape(key)+r' = (.+)$',result.stdout,re.M)
        if match: state[key]=match[1]
    path=DATA/'service-status.json'
    return {'installed':PLIST.exists(),'loaded':result.returncode==0,'process':state,
            'worker':json.loads(path.read_text()) if path.exists() else None,
            'source':json.loads((DATA/'source-status.json').read_text()) if (DATA/'source-status.json').exists() else None,
            'data':str(DATA),'settings':config_at(DATA) if (DATA/'control.json').exists() else None}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    setup=sub.add_parser('install');setup.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[2]/'data/restaurant-pilot')
    for name in ('status','pause','resume','uninstall','throughput'): sub.add_parser(name)
    configure=sub.add_parser('configure');configure.add_argument('--daily-requests',type=int)
    configure.add_argument('--workers',type=int,choices=range(1,49))
    configure.add_argument('--keep-awake',choices=('on','off'))
    args=parser.parse_args()
    if args.command=='install': install(args.source)
    elif args.command=='status': print(json.dumps(status(),indent=2))
    elif args.command=='uninstall':
        launch('bootout',TARGET);PLIST.unlink(missing_ok=True)
        source_label='com.goodeats.restaurant-source'
        launch('bootout',TARGET.rsplit('/',1)[0]+'/'+source_label)
        (PLIST.parent/(source_label+'.plist')).unlink(missing_ok=True)
        print('Background agent removed. Collected data is retained at '+str(DATA))
    else:
        if not (DATA/'control.json').exists(): raise SystemExit('Install the background collector first.')
        config=config_at(DATA)
        if args.command=='configure':
            if args.daily_requests is not None:
                if not 1<=args.daily_requests<=1000000: parser.error('Daily requests must be 1–1000000')
                config['daily_requests']=args.daily_requests
            if args.workers: config['workers']=args.workers
            if args.keep_awake: config['keep_awake']=args.keep_awake=='on'
        elif args.command=='throughput': config.update(THROUGHPUT_CONFIG)
        else: config['paused']=args.command=='pause'
        write_json(DATA/'control.json',config)
        print(json.dumps(config,indent=2))


if __name__=='__main__': main()
