"""Atomic US restaurant catalog exports, including partial and queued records."""
import csv
import io
import json
import math
from datetime import datetime, timezone, timedelta
from contextlib import ExitStack
from collections import Counter
from collector import now, COLLECTOR_VERSION
from completeness import readiness, REQUIRED

EXPORT_VERSION='catalog-1'
BASE_HEADERS=['id','name','market','address','latitude','longitude','cuisines','hours','price_range',
              'in_hotel','hotel_name','hotel_location','hotel_status','website','field_sources','collected_at','reuse_status','price_basis']
DETAIL_HEADERS=['fully_completed','details_count','has_cuisine','has_hours','has_price','missing_fields',
                'conflicting_fields','fallback_fields','crawl_status','collection_attempted','last_checked_at',
                'country','locality','region','postcode','identity_source','source_release','source_uri','field_observed_at','completeness_checked_at']
HEADERS=BASE_HEADERS+DETAIL_HEADERS


def map_eligible(seed):
    if seed.get('country')!='US' or not isinstance(seed.get('name'),str) or not seed['name'].strip(): return False
    if seed.get('operating_status') in ('closed','permanently_closed'): return False
    try:
        lat,lng=float(seed['lat']),float(seed['lng'])
        return math.isfinite(lat) and math.isfinite(lng) and -90<=lat<=90 and -180<=lng<=180
    except (ValueError,TypeError,KeyError): return False


def price_basis(ready):
    return sorted({f.get('price_basis','published_category_or_range') for f in ready['evidence']['price_range']})


def safe_cell(value):
    if isinstance(value,bool): value=str(value).lower()
    elif isinstance(value,(int,float)): return str(value)
    value=json.dumps(value,ensure_ascii=False) if isinstance(value,(list,dict)) else '' if value is None else str(value)
    return "'"+value if value.lstrip().startswith(('=','+','-','@','\t','\r')) else value


def profile(row):
    seed=json.loads(row['seed']);result=json.loads(row['result'] or '{}')
    ready=readiness(seed,result.get('observations',[]))
    usable={f:f in ready['values'] for f in REQUIRED}
    fallback=[f for f in REQUIRED if not usable[f]]
    check_times=[p.get('observed_at') for p in result.get('pages',[])]+[result.get('last_check_at')]
    last_checked=max((t for t in check_times if isinstance(t,str)),default=None)
    return {'schema_version':3,'restaurant':seed,'crawl_status':row['status'],'attempts':row['attempts'],
            'collector_version':result.get('collector_version'),'website_observations':result.get('observations',[]),
            'last_check':result.get('last_check'),'last_check_at':result.get('last_check_at'),
            'last_checked_at':last_checked if row['attempts']>0 else None,
            'page_checks':result.get('pages',[]),'readiness':ready,'fully_completed':bool(ready['complete']),
            'details_count':sum(usable.values()),'fallback_fields':fallback,
            'collection_attempted':row['attempts']>0,'map_eligible':map_eligible(seed),'completeness_checked_at':now(),
            'publication_status':'research_only_not_app_verified'}


def csv_values(payload):
    seed=payload['restaurant'];ready=payload['readiness'];values=ready['values'];hotel=ready['hotel']
    sources={f:sorted({o['source_url'] for o in facts}) for f,facts in ready['evidence'].items()}
    stamps=[o['observed_at'] for f in REQUIRED for o in ready['evidence'][f]]
    lat,lng=seed.get('lat'),seed.get('lng')
    if payload['map_eligible']:lat,lng=float(lat),float(lng)
    return [seed['id'],seed['name'],seed.get('market'),seed.get('address'),lat,lng,
            values.get('cuisines'),values.get('hours'),values.get('price_range'),
            'unknown' if hotel['in_hotel'] is None else str(hotel['in_hotel']).lower(),
            hotel['hotel_name'],hotel['hotel_location'],hotel['status'],seed.get('website'),sources,
            min(stamps) if stamps else '', 'website_terms_unreviewed',price_basis(ready),
            payload['fully_completed'],payload['details_count'],'cuisines' in values,'hours' in values,'price_range' in values,
            ready['missing_fields'],ready['conflicting_fields'],payload['fallback_fields'],payload['crawl_status'],
            payload['collection_attempted'],payload['last_checked_at'],seed.get('country'),seed.get('locality'),
            seed.get('region'),seed.get('postcode'),seed.get('dataset'),seed.get('release'),seed.get('source_uri'),
            {f:min(o['observed_at'] for o in facts) for f,facts in ready['evidence'].items() if facts},payload['completeness_checked_at']]


def encoded_row(payload):
    handle=io.StringIO(newline='');csv.writer(handle).writerow([safe_cell(v) for v in csv_values(payload)])
    return handle.getvalue()


def next_expiry(payload):
    stamps=[o['observed_at'] for facts in payload['readiness']['evidence'].values() for o in facts]
    return (min(datetime.fromisoformat(s).astimezone(timezone.utc) for s in stamps)+timedelta(days=90)).isoformat() if stamps else '9999-12-31'


def export(db, output):
    """Full diagnostic export. The catalog/complete split is shared with live export."""
    output.mkdir(parents=True,exist_ok=True)
    filenames=['candidate-results.jsonl','review.csv','observations.jsonl']
    matched=websites=0;fields=Counter()
    with ExitStack() as stack:
        handles={name:stack.enter_context((output/(name+'.partial')).open('w',newline='')) for name in filenames}
        review=csv.writer(handles['review.csv']);review.writerow(HEADERS)
        for row in db.execute('SELECT * FROM restaurants ORDER BY priority'):
            payload=profile(row)
            found={o['field'] for o in payload['website_observations'] if o.get('branch_status')=='matched'}
            matched+=bool(found);fields.update(found);websites+=bool(payload['restaurant'].get('website'))
            handles['candidate-results.jsonl'].write(json.dumps(payload,ensure_ascii=False)+'\n')
            for fact in payload['website_observations']:
                handles['observations.jsonl'].write(json.dumps({'restaurant_id':row['id'],**fact},ensure_ascii=False)+'\n')
            if not payload['fully_completed']:
                review.writerow([safe_cell(v) for v in csv_values(payload)])
    for name in filenames: (output/(name+'.partial')).replace(output/name)
    # A manual full export also rebuilds indexes if a caller changed rows without
    # updating timestamps. Background export only processes changed/expired rows.
    summary=export_finished(db,output,force=True)
    summary.update(restaurants_with_branch_matched_website_facts=matched,restaurants_by_matched_field=dict(fields),with_website=websites)
    summary['interrupted_runs_recovered']=sum(bool(json.loads(r[0] or '{}').get('interrupted_run_recovered')) for r in db.execute('SELECT settings FROM runs'))
    (output/'summary.json.partial').write_text(json.dumps(summary,indent=2)+'\n');(output/'summary.json.partial').replace(output/'summary.json')
    print(json.dumps(summary,indent=2));return summary


def export_finished(db, output, force=False):
    """Refresh catalog and complete-only files; serialize only changed profiles."""
    output.mkdir(parents=True,exist_ok=True)
    db.execute('CREATE TABLE IF NOT EXISTS collector_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)')
    db.execute('CREATE INDEX IF NOT EXISTS restaurant_export_updated ON restaurants(updated_at)')
    db.execute('CREATE TABLE IF NOT EXISTS ready_restaurants(id TEXT PRIMARY KEY,priority INTEGER,payload TEXT,expires_at TEXT)')
    db.execute('CREATE TABLE IF NOT EXISTS catalog_restaurants(id TEXT PRIMARY KEY,priority INTEGER,payload TEXT,csv_row TEXT,expires_at TEXT,complete INTEGER)')
    db.execute('CREATE INDEX IF NOT EXISTS catalog_expiry ON catalog_restaurants(expires_at)')
    db.execute('CREATE INDEX IF NOT EXISTS catalog_priority ON catalog_restaurants(priority)')
    db.execute('CREATE TABLE IF NOT EXISTS menu_estimates(id TEXT PRIMARY KEY,payload TEXT,expires_at TEXT)')
    previous=db.execute("SELECT value FROM collector_state WHERE key='catalog_checkpoint'").fetchone()
    checkpoint=json.loads(previous[0]) if previous else {}
    since=checkpoint.get('at','') if not force and checkpoint.get('version')==[EXPORT_VERSION,COLLECTOR_VERSION] else ''
    started=now()
    with db:
        # Expiration changes field availability even when the crawler is idle.
        changed=db.execute('''SELECT * FROM restaurants WHERE updated_at>=? OR id IN
            (SELECT id FROM catalog_restaurants WHERE expires_at<=?) ORDER BY priority''',(since,started)).fetchall()
        for row in changed:
            payload=profile(row);ready=payload['readiness'];seed=payload['restaurant']
            db.execute('DELETE FROM menu_estimates WHERE id=?',(row['id'],))
            estimates=[o for o in payload['website_observations'] if o.get('field')=='menu_price_estimate' and o.get('branch_status')=='matched']
            if estimates and payload['map_eligible']:
                expires=min(datetime.fromisoformat(o['observed_at']).astimezone(timezone.utc) for o in estimates)+timedelta(days=90)
                db.execute('INSERT INTO menu_estimates VALUES(?,?,?)',(row['id'],json.dumps({'restaurant':seed,'estimates':estimates,'missing_fields':payload['fallback_fields']}),expires.isoformat()))
            if not payload['map_eligible']:
                db.execute('DELETE FROM catalog_restaurants WHERE id=?',(row['id'],))
                db.execute('DELETE FROM ready_restaurants WHERE id=?',(row['id'],));continue
            encoded=json.dumps(payload,ensure_ascii=False);expiry=next_expiry(payload)
            db.execute('INSERT OR REPLACE INTO catalog_restaurants VALUES(?,?,?,?,?,?)',
                       (row['id'],row['priority'],encoded,encoded_row(payload),expiry,int(ready['complete'])))
            if ready['complete']:
                db.execute('INSERT OR REPLACE INTO ready_restaurants VALUES(?,?,?,?)',(row['id'],row['priority'],encoded,expiry))
            else: db.execute('DELETE FROM ready_restaurants WHERE id=?',(row['id'],))
        for table in ('catalog_restaurants','ready_restaurants','menu_estimates'):
            db.execute(f'DELETE FROM {table} WHERE id NOT IN (SELECT id FROM restaurants)')
        db.execute('DELETE FROM menu_estimates WHERE expires_at<=?',(started,))
        db.execute("INSERT INTO collector_state VALUES('catalog_checkpoint',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   (json.dumps({'at':started,'version':[EXPORT_VERSION,COLLECTOR_VERSION]}),))
    complete=catalog=0
    names=['restaurants.csv','restaurants.jsonl','restaurants-complete.csv','restaurants-complete.jsonl']
    with ExitStack() as stack:
        handles={name:stack.enter_context((output/(name+'.partial')).open('w',newline='')) for name in names}
        for name in ('restaurants.csv','restaurants-complete.csv'): csv.writer(handles[name]).writerow(HEADERS)
        for row in db.execute('SELECT csv_row,payload,complete FROM catalog_restaurants ORDER BY priority'):
            catalog+=1;handles['restaurants.csv'].write(row['csv_row']);handles['restaurants.jsonl'].write(row['payload']+'\n')
            if row['complete']:
                complete+=1;handles['restaurants-complete.csv'].write(row['csv_row']);handles['restaurants-complete.jsonl'].write(row['payload']+'\n')
    for name in names: (output/(name+'.partial')).replace(output/name)
    with (output/'menu-estimates.csv.partial').open('w',newline='') as handle:
        writer=csv.writer(handle);writer.writerow(['id','name','address','menu_price_estimates','source_urls','observed_at','missing_fields','review_required'])
        for row in db.execute('SELECT payload FROM menu_estimates ORDER BY id'):
            item=json.loads(row[0]);seed=item['restaurant'];estimates=item['estimates']
            writer.writerow([safe_cell(v) for v in [seed['id'],seed['name'],seed.get('address'),[e['value'] for e in estimates],
                [e['source_url'] for e in estimates],min(e['observed_at'] for e in estimates),item['missing_fields'],'true']])
    (output/'menu-estimates.csv.partial').replace(output/'menu-estimates.csv')
    states=dict(db.execute('SELECT status,count(*) FROM restaurants GROUP BY status'));total=sum(states.values())
    summary={'generated_at':now(),'export_schema_version':3,'catalog_restaurants':catalog,'complete_restaurants':complete,
             'partial_restaurants':catalog-complete,'excluded_from_catalog':total-catalog,'candidate_restaurants':total,
             'selected_restaurants':total,'incomplete_restaurants':total-complete,'status':states,'required_fields':list(REQUIRED),
             'attempted_restaurants':db.execute('SELECT count(*) FROM restaurants WHERE attempts>0').fetchone()[0],
             'network_requests':db.execute('SELECT coalesce(sum(requests),0) FROM runs').fetchone()[0],'paid_api_requests':0,
             'review_snapshot_at':datetime.fromtimestamp((output/'review.csv').stat().st_mtime,timezone.utc).isoformat() if (output/'review.csv').exists() else None,
             'publication_status':'research_only_not_app_verified'}
    manifest=output/'source-manifest.json'
    imported=db.execute("SELECT value FROM collector_state WHERE key='catalog_import_last'").fetchone()
    if imported:summary['catalog_import']=json.loads(imported[0])
    if manifest.exists():
        source=json.loads(manifest.read_text());summary['candidate_pool']={k:source[k] for k in ('candidate_count','scope') if k in source}
    (output/'summary.json.partial').write_text(json.dumps(summary,indent=2)+'\n');(output/'summary.json.partial').replace(output/'summary.json')
    report=f'''# US restaurant catalog

**{catalog:,} named US restaurants with coordinates**, including {complete:,} fully completed and {catalog-complete:,} partial profiles.

`restaurants.csv` and `restaurants.jsonl` include usable catalog identities, even with zero detail fields or no website.
Queued records are explicitly marked as not yet attempted; a row is not proof of a successful scrape.
`restaurants-complete.csv` and `restaurants-complete.jsonl` contain only profiles with all three usable fields.

`fully_completed` means cuisine, regular hours and price have recent, branch-matched, nonconflicting evidence.
`details_count` ranges from 0 to 3. Blank fields remain unknown. `fallback_fields` includes missing and conflicting fields.
Unknown hotel status remains unknown. Menu-price estimates remain separate and do not count as verified prices.

Source dataset/release/URI identify the origin of name/location data. Rows are research records, not app-verified listings.
Fields can expire and become incomplete while the name/location stays in the catalog. Regular hours are not live open/closed status.
The collector still attempts detail enrichment. Catalog growth is distinct from scrape speed or completed-profile yield.
Full review snapshot: {summary['review_snapshot_at']}. These files alone do not connect the app or enable Google fallback calls.
'''
    (output/'report.md.partial').write_text(report);(output/'report.md.partial').replace(output/'report.md')
    return summary
