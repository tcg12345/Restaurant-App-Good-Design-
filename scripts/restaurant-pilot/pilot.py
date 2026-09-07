#!/usr/bin/env python3
"""Local restaurant pilot: seed -> select -> crawl -> export. See README.md."""
from __future__ import annotations

import argparse
import csv
import fcntl
import json
import sqlite3
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from collector import Fetcher, collect, now, AGENT, COLLECTOR_VERSION, host_key
from seed import choose, download_candidates
from exports import export, safe_cell
from completeness import readiness

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / "data/restaurant-pilot"


def connect(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.row_factory = sqlite3.Row
    db.executescript("""
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS restaurants (
        id TEXT PRIMARY KEY, priority INTEGER NOT NULL, seed TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
        result TEXT, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS queue ON restaurants(status,priority);
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT,
        attempted INTEGER DEFAULT 0, requests INTEGER DEFAULT 0, settings TEXT
      );
    """)
    return db


@contextmanager
def exclusive(path):
    """One importer/crawler per dataset. Interrupted jobs are recovered on resume."""
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.with_suffix(".lock").open("a") as handle:
        try:
            fcntl.flock(handle,fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Another writer is using this pilot database.")
        try:
            yield
        finally:
            fcntl.flock(handle,fcntl.LOCK_UN)


def import_selection(db, candidates, target, include_cafes=False):
    if db.execute("SELECT count(*) FROM restaurants").fetchone()[0]:
        raise SystemExit("Pilot already selected. Reuse it for resume, or choose a new --output directory for a new cohort.")
    with candidates.open() as source:
        rows = [json.loads(line) for line in source if line.strip()]
    selected = choose(rows,target,include_cafes=include_cafes)
    if any(r.get('country') != 'US' for r in selected):
        raise SystemExit('Only explicitly US candidates can enter this collector.')
    if len(selected) < target:
        raise SystemExit(f"Only {len(selected):,} eligible candidates; requested {target:,}. No partial cohort was imported.")
    with db:
        db.executemany("INSERT INTO restaurants(id,priority,seed,status,updated_at) VALUES(?,?,?,?,?)",
                       [(r["id"],r["pilot_priority"],json.dumps(r),"pending" if r.get("website") else "no_website",now()) for r in selected])
    print(json.dumps({"selected":len(selected),"guide_matches":sum(bool(r["guide_tier"]) for r in selected),
                      "with_website":sum(bool(r.get("website")) for r in selected),"markets":dict(Counter(r["market"] for r in selected))},indent=2))


def crawl(db, args):
    user_agent = f"{AGENT}/{COLLECTOR_VERSION} (+{args.contact})"
    fetcher = Fetcher(user_agent,delay=args.delay,timeout=args.timeout,max_requests=args.max_requests,
                      request_guard=getattr(args,'request_guard',None))
    session=getattr(args,'fetch_session',None)
    if session is not None:
        # Calls are sequential at the batch level. Preserve publisher delays
        # between batches; discard host state only after every supported delay.
        cutoff=time.monotonic()-300
        for host in list(session.get('last',{})):
            if session['last'][host]<cutoff:
                session['last'].pop(host,None);session['locks'].pop(host,None)
        for host in list(session.get('cooldowns',{})):
            if session['cooldowns'][host]<=time.monotonic(): session['cooldowns'].pop(host,None)
        for name in ('last','locks','cooldowns'):
            setattr(fetcher,name,session.setdefault(name,{}))
    with db:
        db.execute("UPDATE restaurants SET status='pending',attempts=max(0,attempts-1) WHERE status='running'")
        for previous in db.execute("SELECT id,settings FROM runs WHERE finished_at IS NULL").fetchall():
            settings = json.loads(previous['settings'] or '{}')
            settings['interrupted_run_recovered'] = True
            db.execute("UPDATE runs SET finished_at=?,settings=? WHERE id=?",(now(),json.dumps(settings),previous['id']))
        if args.retry_errors:
            db.execute("UPDATE restaurants SET status='pending' WHERE status='fetch_error' AND attempts<2")
        run_id = db.execute("INSERT INTO runs(started_at,settings) VALUES(?,?)",(now(),json.dumps({
            "limit":args.limit,"max_requests":args.max_requests,"workers":args.workers,"max_pages":args.max_pages,
            "delay":args.delay,"user_agent":user_agent}))).lastrowid
    attempted = 0
    began = time.monotonic()
    try:
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            ordering = "CASE WHEN json_extract(result,'$.refresh_due') THEN 0 ELSE 1 END, attempts, priority"
            if getattr(args,'prioritize_retries',False):
                ordering = "CASE WHEN json_extract(result,'$.refresh_due') THEN 0 WHEN attempts>0 THEN 1 ELSE 2 END, priority"
            if getattr(args,'prioritize_national',False):
                ordering="CASE WHEN json_extract(seed,'$.selection_reason')='nationwide_us' THEN 0 ELSE 1 END, "+ordering
            ordering="CASE WHEN json_array_length(result,'$.missing_fields')=1 THEN 0 ELSE 1 END, "+ordering
            rows = list(db.execute("SELECT * FROM restaurants WHERE status='pending' AND json_extract(seed,'$.country')='US' ORDER BY "+ordering+" LIMIT ?",
                                   (args.limit,)).fetchall())
            jobs={};active_hosts=set()
            while rows or jobs:
                while rows and len(jobs)<args.workers and fetcher.request_count<args.max_requests:
                    available=next((i for i,r in enumerate(rows) if host_key(urlsplit(json.loads(r['seed']).get('website','')).hostname) not in active_hosts),None)
                    if available is None: break
                    row=rows.pop(available);seed=json.loads(row['seed']);host=host_key(urlsplit(seed.get('website','')).hostname)
                    with db:
                        db.execute("UPDATE restaurants SET status='running',attempts=attempts+1 WHERE id=?",(row['id'],))
                    previous=json.loads(row['result'] or '{}')
                    prior=previous if previous.get('deeper_due') and previous.get('collector_version')==COLLECTOR_VERSION else None
                    jobs[pool.submit(collect,seed,fetcher,2 if prior else args.max_pages,prior)]=(row,host);active_hosts.add(host)
                if not jobs: break
                completed,_=wait(jobs,return_when=FIRST_COMPLETED)
                for future in completed:
                    row,host=jobs.pop(future);active_hosts.remove(host)
                    try:
                        result = future.result()
                    except Exception as error:
                        result = {"status":"fetch_error","pages":[{"error":str(error)[:180]}],"observations":[],"collector_version":COLLECTOR_VERSION}
                    # Request exhaustion leaves an incomplete restaurant resumable, even if
                    # an earlier page yielded facts. Completed results are never repeated.
                    exhausted = any(p.get("error") == "request_budget_exhausted" for p in result["pages"])
                    status = "pending" if exhausted else result["status"]
                    saved = json.loads(row['result']) if exhausted and row['result'] else result
                    if not exhausted and result['status']=='fetch_error' and row['result']:
                        prior=json.loads(row['result'])
                        if readiness(json.loads(row['seed']),prior.get('observations',[]))['complete']:
                            saved={**prior,'last_check':result,'last_check_at':now(),'refresh_due':False,
                                   'last_attempt_collector_version':COLLECTOR_VERSION}
                    with db:
                        db.execute("UPDATE restaurants SET status=?,result=?,updated_at=?,attempts=attempts-? WHERE id=?",
                                   (status,json.dumps(saved),now(),int(exhausted),row["id"]))
                        db.execute("UPDATE runs SET attempted=?,requests=? WHERE id=?",(attempted+1,fetcher.request_count,run_id))
                    attempted += 1
                    print(json.dumps({"attempted":attempted,"requests":fetcher.request_count,"name":json.loads(row["seed"])["name"],
                                      "status":status,"facts":len(result["observations"]),"seconds":round(time.monotonic()-began)}),flush=True)
    finally:
        with db:
            db.execute("UPDATE runs SET finished_at=?,attempted=?,requests=? WHERE id=?",(now(),attempted,fetcher.request_count,run_id))



def reuse_results(db, source_directory):
    """Reuse completed validation work only for identical branch/source identities."""
    path = source_directory.resolve()/"pilot.sqlite"
    source = sqlite3.connect(path.as_uri()+"?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    copied = 0
    try:
        source.execute("BEGIN")
        if source.execute("SELECT count(*) FROM runs WHERE finished_at IS NULL").fetchone()[0]:
            raise SystemExit("Finish or resume the source validation run before reusing its results.")
        with db:
            for prior in source.execute("SELECT * FROM restaurants WHERE status NOT IN ('pending','running','no_website')"):
                current = db.execute("SELECT seed,status FROM restaurants WHERE id=?",(prior['id'],)).fetchone()
                if not current or current['status'] != 'pending':
                    continue
                old_seed, new_seed = json.loads(prior['seed']), json.loads(current['seed'])
                if any(old_seed.get(k) != new_seed.get(k) for k in ('id','name','lat','lng','address','locality','region','postcode','website','release')):
                    continue
                result = json.loads(prior['result'] or '{}')
                if result.get('collector_version') != COLLECTOR_VERSION:
                    continue
                result['reused_from'] = str(path)
                db.execute("UPDATE restaurants SET status=?,result=?,attempts=?,updated_at=? WHERE id=?",
                           (prior['status'],json.dumps(result),prior['attempts'],prior['updated_at'],prior['id']))
                copied += 1
            if copied:
                requests = source.execute("SELECT coalesce(sum(requests),0) FROM runs").fetchone()[0]
                already_counted = max((s.get('source_requests',0) for (settings,) in db.execute("SELECT settings FROM runs")
                                       if (s := json.loads(settings or '{}')).get('reused_from') == str(path)), default=0)
                db.execute("INSERT INTO runs(started_at,finished_at,attempted,requests,settings) VALUES(?,?,?,?,?)",
                           (now(),now(),copied,max(0,requests-already_counted),json.dumps({'reused_from':str(path),'source_requests':requests,
                            'note':'Includes complete source validation request budget.'})))
    finally:
        source.close()
    print(json.dumps({'reused_restaurants':copied}))
    return copied



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,default=DEFAULT)
    sub = parser.add_subparsers(dest="command",required=True)
    seed = sub.add_parser("seed",help="Download licensed Overture US candidates; can take several minutes")
    seed.add_argument("--release")
    seed.add_argument("--min-confidence",type=float,default=.8)
    seed.add_argument("--guide",type=Path,default=ROOT/"src/data/michelin.json")
    seed.add_argument("--market",action="append",help="Limit source import to a named configured market; repeat for several markets")
    seed.add_argument('--nationwide',action='store_true',help='All US localities; no metro-radius restriction')
    select = sub.add_parser("select",help="Choose a fixed cohort; refuses to overwrite an existing pilot")
    select.add_argument("--target",type=int,default=15000)
    select.add_argument("--candidates",type=Path)
    select.add_argument("--include-cafes",action="store_true",help="Also fill non-guide slots with cafes, coffee shops and bakeries")
    run = sub.add_parser("crawl",help="Collect facts from public website HTML; resumes pending restaurants")
    run.add_argument("--limit",type=int,default=100)
    run.add_argument("--max-requests",type=int,default=500)
    run.add_argument("--workers",type=int,default=8)
    run.add_argument("--max-pages",type=int,default=3)
    run.add_argument("--delay",type=float,default=2)
    run.add_argument("--timeout",type=float,default=12)
    run.add_argument("--retry-errors",action="store_true")
    run.add_argument("--contact",default="https://github.com/tcg12345/Restaurant-App-Good-Design-",help="Operator contact URL or mailto included in the User-Agent")
    reuse = sub.add_parser("reuse",help="Reuse completed website checks from a validation cohort with identical branch identities")
    reuse.add_argument("--from-output",type=Path,required=True)
    sub.add_parser("export",help="Write JSONL, review CSV, summary and report")
    sub.add_parser("status",help="Show queue counts without making network calls")
    args = parser.parse_args()
    args.output = args.output.resolve()
    if args.command == "seed":
        if not 0 <= args.min_confidence <= 1:
            parser.error("--min-confidence must be between 0 and 1")
        if (args.output/"candidates.jsonl").exists():
            parser.error("Candidates already exist. Use a new --output directory to retain release provenance.")
        with exclusive(args.output/"pilot.sqlite"):
            if args.nationwide and args.market: parser.error('--nationwide cannot be combined with --market')
            download_candidates(args.output/"candidates.jsonl",args.guide,args.release,args.min_confidence,args.market,args.nationwide)
        return
    if args.command == "select" and not 1 <= args.target <= 20000:
        parser.error("--target must be between 1 and 20000")
    if args.command == "crawl":
        if not (1<=args.workers<=48 and 1<=args.max_pages<=5 and args.delay>=2 and 1<=args.timeout<=30 and args.limit>0 and args.max_requests>0):
            parser.error("Positive budgets required; workers 1–48, pages 1–5, delay >=2s, timeout 1–30s")
        if not args.contact.startswith(("https://","mailto:")) or any(ord(c)<32 for c in args.contact):
            parser.error("--contact must be a valid HTTPS or mailto operator contact")
    db_path = args.output/"pilot.sqlite"
    if args.command == "status":
        if not db_path.exists():
            raise SystemExit("No selected cohort yet; run seed and select first.")
        reader = sqlite3.connect(db_path.as_uri()+"?mode=ro",uri=True)
        try:
            print(json.dumps(dict(reader.execute("SELECT status,count(*) FROM restaurants GROUP BY status").fetchall()),indent=2))
        finally:
            reader.close()
        return
    with exclusive(db_path):
        db = connect(db_path)
        try:
            if args.command == "select":
                import_selection(db,args.candidates or args.output/"candidates.jsonl",args.target,args.include_cafes)
                export(db,args.output)
            elif args.command == "crawl":
                try:
                    crawl(db,args)
                finally:
                    export(db,args.output)
            elif args.command == "export":
                export(db,args.output)
            elif args.command == "reuse":
                reuse_results(db,args.from_output)
                export(db,args.output)
        finally:
            db.close()


if __name__ == "__main__":
    main()
