"""Low-priority local worker. No cloud account or AI service is used."""
import argparse
import contextlib
import hashlib
import io
import json
import logging
from logging.handlers import RotatingFileHandler
import signal
import sqlite3
import threading
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

from collector import COLLECTOR_VERSION, normalize, now
from completeness import readiness
from pilot import connect, crawl, exclusive, export
from exports import export_finished
from power import active_awake
from health import check_runtime

DEFAULT_CONFIG = {'paused':False,'daily_requests':20000,'workers':8,'batch_size':20,
                  'max_pages':5,'delay':2,'timeout':12,'refresh_days':30,'retry_days':30,'require_hotel_status':False,
                  'keep_awake':True,'catalog_growth_enabled':False}
THROUGHPUT_CONFIG={'daily_requests':250000,'workers':32,'batch_size':128,'keep_awake':True}
NATIONAL_CONFIG={'daily_requests':500000,'workers':48,'batch_size':192,'max_pages':3,'keep_awake':True}


def write_json(path, value):
    temporary=path.with_suffix(path.suffix+'.partial')
    temporary.write_text(json.dumps(value,indent=2)+'\n')
    temporary.replace(path)


def config_at(output):
    path=output/'control.json'
    config={**DEFAULT_CONFIG,**(json.loads(path.read_text()) if path.exists() else {})}
    if not (1<=config['workers']<=48 and 1<=config['daily_requests']<=1000000 and
            1<=config['batch_size']<=256 and 1<=config['max_pages']<=5 and
            2<=config['delay']<=30 and 1<=config['timeout']<=30 and
            7<=config['refresh_days']<=60 and config['retry_days']>=7 and isinstance(config['keep_awake'],bool) and isinstance(config['catalog_growth_enabled'],bool)):
        raise ValueError('Invalid background collector limits')
    return config


class DailyBudget:
    """Persist BEFORE every HTTP attempt; a crash cannot reset the daily limit."""
    def __init__(self, output, limit, stopped=None):
        self.output,self.limit,self.stopped=output,limit,stopped or threading.Event()
        self.db=sqlite3.connect(output/'usage.sqlite',check_same_thread=False)
        self.db.execute('CREATE TABLE IF NOT EXISTS daily_usage(day TEXT PRIMARY KEY, requests INTEGER NOT NULL)')
        self.db.commit();self.lock=threading.Lock()

    def used(self):
        with self.lock:
            row=self.db.execute('SELECT requests FROM daily_usage WHERE day=?',(now()[:10],)).fetchone()
            return row[0] if row else 0

    def reserve(self):
        config=config_at(self.output)
        if self.stopped.is_set() or config['paused']:
            raise ValueError('request_budget_exhausted')
        with self.lock, self.db:
            cursor=self.db.execute('''INSERT INTO daily_usage(day,requests) VALUES(?,1)
                ON CONFLICT(day) DO UPDATE SET requests=requests+1 WHERE requests<?''',(now()[:10],min(self.limit,config['daily_requests'])))
            if cursor.rowcount != 1:
                raise ValueError('request_budget_exhausted')

    def close(self):
        self.db.close()


def get_state(db, key, default=None):
    row=db.execute('SELECT value FROM collector_state WHERE key=?',(key,)).fetchone()
    return json.loads(row[0]) if row else default


def set_state(db,key,value):
    db.execute('INSERT INTO collector_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',(key,json.dumps(value)))


def identity(seed):
    address=normalize(seed.get('address') or f"{seed['lat']:.4f},{seed['lng']:.4f}")
    return hashlib.sha256(json.dumps([normalize(seed['name']),address,normalize(seed.get('locality','')),seed.get('region')]).encode()).hexdigest()


def initialize(db):
    db.executescript('''CREATE TABLE IF NOT EXISTS collector_state(key TEXT PRIMARY KEY,value TEXT);
                       CREATE TABLE IF NOT EXISTS candidate_keys(identity TEXT PRIMARY KEY,restaurant_id TEXT);''')
    if not get_state(db,'keys_initialized',False):
        with db:
            for row in db.execute('SELECT id,seed FROM restaurants'):
                db.execute('INSERT OR IGNORE INTO candidate_keys VALUES(?,?)',(identity(json.loads(row['seed'])),row['id']))
            set_state(db,'keys_initialized',True)


def replenish(db, source, limit=500):
    """A byte checkpoint streams the existing US pool without rescanning it."""
    if not source.exists() or get_state(db,'pool_exhausted',False):
        return 0
    signature=[str(source.resolve()),source.stat().st_size,source.stat().st_mtime_ns]
    prior=get_state(db,'pool_signature')
    if prior and prior != signature:
        raise ValueError('Candidate source changed; reset its checkpoint explicitly before continuing')
    added=0;rank=db.execute('SELECT coalesce(max(priority),0) FROM restaurants').fetchone()[0]
    with source.open('rb') as handle, db:
        handle.seek(get_state(db,'pool_offset',0))
        while added<limit:
            line=handle.readline()
            if not line:
                set_state(db,'pool_exhausted',True);break
            row=json.loads(line)
            category=row.get('category','')
            if row.get('country')!='US' or not row.get('website') or (not row.get('guide_tier') and category!='restaurant' and not category.endswith('_restaurant')):
                continue
            if db.execute('SELECT 1 FROM restaurants WHERE id=?',(row['id'],)).fetchone():
                continue
            if db.execute('INSERT OR IGNORE INTO candidate_keys VALUES(?,?)',(identity(row),row['id'])).rowcount != 1:
                continue
            rank+=1;row['pilot_priority']=rank
            db.execute('INSERT INTO restaurants(id,priority,seed,status,updated_at) VALUES(?,?,?,?,?)',
                       (row['id'],rank,json.dumps(row),'pending',now()))
            added+=1
        set_state(db,'pool_offset',handle.tell());set_state(db,'pool_signature',signature)
    return added


def schedule_rechecks(db, config):
    today=now()[:10];upgrade=get_state(db,'collector_version') != COLLECTOR_VERSION
    if not upgrade and get_state(db,'last_recheck_day')==today:
        return
    with db:
        for row in db.execute("SELECT * FROM restaurants WHERE result IS NOT NULL AND status NOT IN ('pending','running','no_website')").fetchall():
            result=json.loads(row['result']);ready=readiness(json.loads(row['seed']),result.get('observations',[]))
            age=datetime.now(timezone.utc)-datetime.fromisoformat(row['updated_at'])
            successful_page=any(page.get('status')==200 and page.get('skip')!='publisher_restriction' for page in result.get('pages',[]))
            old_parser=upgrade and result.get('collector_version')!=COLLECTOR_VERSION and not ready['complete'] and (len(ready['missing_fields'])==1 or successful_page)
            result['missing_fields']=ready['missing_fields']
            if upgrade:
                db.execute('UPDATE restaurants SET result=?,updated_at=? WHERE id=?',(json.dumps(result),now(),row['id']))
            if old_parser or age>=timedelta(days=config['refresh_days'] if ready['complete'] else config['retry_days']):
                result['refresh_due']=ready['complete']
                db.execute("UPDATE restaurants SET status='pending',result=? WHERE id=?",(json.dumps(result),row['id']))
        set_state(db,'collector_version',COLLECTOR_VERSION);set_state(db,'last_recheck_day',today)


def run(output, once=False):
    output.mkdir(parents=True,exist_ok=True)
    log=logging.getLogger('collector');log.setLevel(logging.INFO)
    if not log.handlers:
        handler=RotatingFileHandler(output/'service.log',maxBytes=2_000_000,backupCount=3)
        handler.setFormatter(logging.Formatter('%(asctime)s %(message)s'));log.addHandler(handler)
    stopped=threading.Event()
    for number in (signal.SIGTERM,signal.SIGINT):
        signal.signal(number,lambda *_:stopped.set())
    status={'pid':__import__('os').getpid(),'started_at':now()}
    def publish(phase, **extra):
        status.update(phase=phase,updated_at=now(),**extra)
        write_json(output/'service-status.json',status)
    with exclusive(output/'worker'):
        cycle=0;fetch_session={};health_checked=False
        while not stopped.is_set():
            budget=None
            try:
                config=config_at(output)
                if config['paused']:
                    publish('paused')
                    if once: break
                    stopped.wait(15);continue
                budget=DailyBudget(output,config['daily_requests'],stopped)
                remaining=config['daily_requests']-budget.used()
                if remaining<=0:
                    # Local candidate imports do not consume the HTTP allowance.
                    if config['catalog_growth_enabled']:
                        with exclusive(output/'pilot.sqlite'):
                            offline=connect(output/'pilot.sqlite')
                            try:
                                initialize(offline)
                                from catalog_growth import grow_catalog
                                if grow_catalog(offline,output):
                                    local_summary=export_finished(offline,output)
                                    status.update(catalog_restaurants=local_summary['catalog_restaurants'],
                                                  candidate_restaurants=local_summary['candidate_restaurants'],
                                                  complete_restaurants=local_summary['complete_restaurants'])
                            finally:offline.close()
                    publish('daily_limit_reached',daily_requests_used=budget.used(),daily_request_limit=config['daily_requests'])
                    if once: break
                    stopped.wait(60);continue
                if not health_checked:
                    publish('checking_runtime',preventing_idle_sleep=False)
                    health=check_runtime();write_json(output/'health.json',health)
                    if not health['ok']:
                        write_json(output/'control.json',{**config_at(output),'paused':True})
                        publish('attention_required',last_error=health['error'],preventing_idle_sleep=False)
                        log.error('Collection paused before crawling: %s',health['error'])
                        if once: break
                        stopped.wait(15);continue
                    health_checked=True
                with exclusive(output/'pilot.sqlite'):
                    db=connect(output/'pilot.sqlite')
                    try:
                        initialize(db);schedule_rechecks(db,config)
                        from national_source import adopt
                        try:
                            adopt(db,output)
                        except Exception as error:
                            write_json(output/'source-status.json',{'phase':'adoption_error','updated_at':now(),'error':str(error)[:500]})
                            if (output/'source-adoption.json').exists(): raise
                            log.warning('National source deferred; existing queue continues: %s',error)
                        catalog_added=0
                        if config['catalog_growth_enabled']:
                            from catalog_growth import grow_catalog
                            catalog_added=grow_catalog(db,output)
                        if cycle%5==4:
                            db.execute("UPDATE restaurants SET status='pending' WHERE status NOT IN ('pending','running','no_website') AND json_extract(result,'$.deeper_due') AND updated_at>?",
                                       ((datetime.now(timezone.utc)-timedelta(days=7)).isoformat(),));db.commit()
                        pending=db.execute("SELECT count(*) FROM restaurants WHERE status='pending'").fetchone()[0]
                        national_pending=db.execute("SELECT count(*) FROM restaurants WHERE status='pending' AND json_extract(seed,'$.selection_reason')='nationwide_us'").fetchone()[0] if get_state(db,'national_source_sha256') else None
                        if pending<100 or (national_pending is not None and national_pending<100):
                            replenish(db,output/'candidates.jsonl',500)
                        pending=db.execute("SELECT count(*) FROM restaurants WHERE status='pending'").fetchone()[0]
                        if not pending:
                            publish('waiting_for_recheck_or_candidates',pool_exhausted=get_state(db,'pool_exhausted',False))
                        else:
                            batch_began=time.monotonic()
                            before_ready={r[0] for r in db.execute('SELECT id FROM ready_restaurants')} if db.execute("SELECT 1 FROM sqlite_master WHERE name='ready_restaurants'").fetchone() else set()
                            args=argparse.Namespace(contact='https://github.com/tcg12345/Restaurant-App-Good-Design-',
                                delay=config['delay'],timeout=config['timeout'],max_requests=min(config['batch_size']*12,remaining),
                                workers=config['workers'],max_pages=config['max_pages'],retry_errors=False,
                                limit=config['batch_size'],request_guard=budget.reserve,prioritize_retries=(cycle%10==9),
                                prioritize_national=(cycle%2==1),fetch_session=fetch_session)
                            with active_awake(output,stopped,config['keep_awake']) as awake, contextlib.redirect_stdout(io.StringIO()) as buffer:
                                publish('collecting',daily_requests_used=budget.used(),daily_request_limit=config['daily_requests'],preventing_idle_sleep=awake)
                                crawl(db,args)
                            status['preventing_idle_sleep']=False
                            log.info(buffer.getvalue().strip())
                        with contextlib.redirect_stdout(io.StringIO()):
                            review=output/'review.csv'
                            if not review.exists() or time.time()-review.stat().st_mtime>86400:
                                export(db,output)
                            summary=export_finished(db,output)
                        if pending:
                            elapsed=time.monotonic()-batch_began
                            last_run=db.execute('SELECT attempted,requests FROM runs ORDER BY id DESC LIMIT 1').fetchone()
                            after_ready={r[0] for r in db.execute('SELECT id FROM ready_restaurants')}
                            new_complete=len(after_ready-before_ready)
                            # Single-batch extrapolations, not promised daily output.
                            request_per_check=last_run['requests']/max(1,last_run['attempted'])
                            checks_per_day=min(last_run['attempted']/max(1,elapsed+5)*86400,
                                               config['daily_requests']/max(1,request_per_check))
                            write_json(output/'throughput.json',{'measured_at':now(),'batch_seconds':round(elapsed,2),
                                'checked':last_run['attempted'],'requests':last_run['requests'],'new_complete':new_complete,
                                'complete_yield':round(new_complete/max(1,last_run['attempted']),4),
                                'extrapolated_checks_per_day':round(checks_per_day),
                                'extrapolated_new_complete_per_day':round(checks_per_day*new_complete/max(1,last_run['attempted'])),
                                'daily_request_limit':config['daily_requests'],
                                'caution':'Single batch extrapolation, not a guarantee; source mix, site restrictions, network, and sleep affect yield.'})
                        publish('batch_complete' if pending else 'waiting_for_recheck_or_candidates',
                                complete_restaurants=summary['complete_restaurants'],candidate_restaurants=summary['candidate_restaurants'],
                                catalog_restaurants=summary.get('catalog_restaurants'),catalog_added=catalog_added,
                                daily_requests_used=budget.used(),daily_request_limit=config['daily_requests'],last_error=None)
                        cycle+=1
                    finally:
                        db.close()
                if once: break
                stopped.wait(5 if pending else 60)
            except Exception as error:
                log.exception('Background collection deferred')
                publish('error',last_error=str(error)[:300])
                if once: raise
                stopped.wait(60)
            finally:
                if budget:
                    budget.close()
        publish('stopped')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--once',action='store_true')
    args=parser.parse_args();run(args.output.resolve(),args.once)
