"""Build and safely adopt a nationwide, locality-balanced candidate pool."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3
import os
import signal
import threading
import time

from collector import now
from seed import download_candidates
from worker import write_json,get_state,set_state,replenish,config_at
from power import active_awake

RELEASE='2026-08-19.0'


def sha256(path):
    with path.open('rb') as handle: return hashlib.file_digest(handle,'sha256').hexdigest()


def balance(source,output,coverage_path):
    """One candidate per locality per round; all named localities stay eligible."""
    index=output.with_suffix('.index.sqlite');index.unlink(missing_ok=True)
    db=sqlite3.connect(index)
    try:
        db.execute('CREATE TABLE candidates(id TEXT PRIMARY KEY,region TEXT,locality TEXT,score REAL,seed TEXT,website INTEGER)')
        with source.open() as handle,db:
            for line in handle:
                row=json.loads(line)
                if row.get('country')!='US': continue
                db.execute('INSERT OR IGNORE INTO candidates VALUES(?,?,?,?,?,?)',
                    (row['id'],row.get('region') or '',row.get('locality') or '',row.get('selection_score',0),line.strip(),bool(row.get('website'))))
        db.execute('CREATE INDEX area_priority ON candidates(region,locality,score DESC,id)')
        temporary=output.with_suffix('.partial')
        with temporary.open('w') as handle:
            for (seed,) in db.execute('''SELECT seed FROM (
                SELECT seed,id,region,locality,ROW_NUMBER() OVER (PARTITION BY region,locality ORDER BY website DESC,score DESC,id) AS locality_round,
                DENSE_RANK() OVER (PARTITION BY region ORDER BY locality) AS locality_rank
                FROM candidates) ORDER BY locality_round,locality_rank,region,locality,id'''):
                handle.write(seed+'\n')
        temporary.replace(output)
        states={r[0]:r[1] for r in db.execute('SELECT region,count(*) FROM candidates GROUP BY region')}
        localities=db.execute("SELECT count(*) FROM (SELECT DISTINCT region,locality FROM candidates WHERE locality!='')").fetchone()[0]
        count,websites=db.execute('SELECT count(*),sum(website) FROM candidates').fetchone()
        report={'release':RELEASE,'candidate_count':count,'candidates_with_website':websites,'named_localities':localities,
                'regions':states,'completed_at':now(),'scope':'All eligible US restaurants in the scanned source, covering the 50 states and DC. No metro-radius restriction. Source omissions remain possible.',
                'sha256':sha256(output),'file':str(output.resolve()),'bytes':output.stat().st_size}
        write_json(coverage_path,report);return report
    finally:
        db.close();index.unlink(missing_ok=True)


def run(output):
    source_dir=output/'nationwide-source'/RELEASE;source_dir.mkdir(parents=True,exist_ok=True)
    state=output/'source-status.json'
    def publish(phase,**values): write_json(state,{'phase':phase,'updated_at':now(),'release':RELEASE,**values})
    try:
        raw=source_dir/'candidates.jsonl';ready=source_dir/'balanced-candidates.jsonl'
        report_file=output/'national-coverage.json'
        if ready.exists() and report_file.exists():
            report=json.loads(report_file.read_text())
            if report.get('release')==RELEASE and sha256(ready)==report.get('sha256'):
                write_json(output/'nationwide-ready.json',report)
                return
        if not raw.exists():
            publish('downloading',candidates_downloaded=0)
            download_candidates(raw,None,RELEASE,.6,nationwide=True,
                                progress=lambda count:publish('downloading',candidates_downloaded=count))
        publish('balancing_localities')
        report=balance(raw,ready,output/'national-coverage.json')
        write_json(output/'nationwide-ready.json',report)
        publish('ready_for_collector',candidate_count=report['candidate_count'],named_localities=report['named_localities'])
    except Exception as error:
        publish('error',error=str(error)[:500]);raise


def adopt(db,output):
    """Called by the collector at a batch boundary under its existing DB lock."""
    marker=output/'nationwide-ready.json'
    if not marker.exists(): return False
    report=json.loads(marker.read_text());fingerprint=report['sha256']
    journal=output/'source-adoption.json'
    applied=get_state(db,'national_source_sha256')==fingerprint
    if applied and not journal.exists(): return False
    incoming=Path(report['file']).resolve()
    if not incoming.is_relative_to((output/'nationwide-source').resolve()):
        raise ValueError('National source path is outside the collector source directory')
    if sha256(incoming)!=fingerprint: raise ValueError('National source checksum mismatch')
    target=output/'candidates.jsonl';staged=output/'candidates.national-new'
    if not applied:
        if shutil.disk_usage(output).free < incoming.stat().st_size*2+256_000_000:
            raise ValueError('Free additional disk space before adopting the nationwide source')
        shutil.copy2(incoming,staged)
    # Back up the old immutable source, then atomically replace its file. A
    # pending journal makes interruption between file/DB commits recoverable.
    write_json(journal,report)
    if target.exists() and not applied:
        saved=output/'source-backups';saved.mkdir(exist_ok=True)
        previous=saved/'pre-national-candidates.jsonl'
        if not previous.exists(): shutil.copy2(target,previous)
    if not applied:
        staged.replace(target)
        with db:
            set_state(db,'pool_offset',0);set_state(db,'pool_exhausted',False)
            set_state(db,'pool_signature',[str(target.resolve()),target.stat().st_size,target.stat().st_mtime_ns])
            set_state(db,'national_source_sha256',fingerprint)
    write_json(output/'source-manifest.json',report)
    replenish(db,target,5000)
    journal.unlink(missing_ok=True)
    write_json(output/'source-status.json',{'phase':'active','updated_at':now(),
        'candidate_count':report['candidate_count'],'named_localities':report['named_localities']})
    return True


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    output=parser.parse_args().output.resolve()
    downloading=threading.Event();finished=threading.Event()
    def watch_pause():
        while not finished.wait(2):
            if downloading.is_set() and config_at(output)['paused']:
                downloading.clear();os.kill(os.getpid(),signal.SIGINT)
    threading.Thread(target=watch_pause,daemon=True).start()
    try:
        while True:
            if config_at(output)['paused']:
                write_json(output/'source-status.json',{'phase':'paused','updated_at':now()})
                time.sleep(15);continue
            downloading.set()
            try:
                with active_awake(output,finished,config_at(output)['keep_awake']): run(output)
                break
            except KeyboardInterrupt:
                if not config_at(output)['paused']: raise
            finally: downloading.clear()
    finally: finished.set()
