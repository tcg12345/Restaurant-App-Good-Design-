"""Import local source identities independently of the website-scraping backlog."""
import json
from pathlib import Path

from collector import now
from exports import map_eligible
from worker import get_state,set_state,identity


def grow_catalog(db,output,limit=5000,scan_limit=25000):
    """Caller holds pilot.lock and handles pause. No network or usage-ledger writes."""
    source=Path(output)/'candidates.jsonl'
    if (Path(output)/'source-adoption.json').exists():
        raise ValueError('Finish source-adoption recovery before importing more catalog identities')
    if not source.exists():return 0
    signature=[str(source.resolve()),source.stat().st_size,source.stat().st_mtime_ns]
    same=get_state(db,'catalog_source_signature')==signature
    if same and get_state(db,'catalog_pool_exhausted',False):return 0
    offset=get_state(db,'catalog_pool_offset',0) if same else 0
    rank=db.execute('SELECT coalesce(max(priority),0) FROM restaurants').fetchone()[0]
    added=scanned=0;exhausted=False
    with source.open('rb') as handle,db:
        handle.seek(offset)
        while added<limit and scanned<scan_limit:
            line=handle.readline()
            if not line:exhausted=True;break
            scanned+=1;seed=json.loads(line);category=seed.get('category','')
            if not map_eligible(seed) or (not seed.get('guide_tier') and category!='restaurant' and not category.endswith('_restaurant')):continue
            if db.execute('SELECT 1 FROM restaurants WHERE id=?',(seed['id'],)).fetchone():continue
            if db.execute('INSERT OR IGNORE INTO candidate_keys VALUES(?,?)',(identity(seed),seed['id'])).rowcount!=1:continue
            rank+=1;seed['pilot_priority']=rank
            db.execute('INSERT INTO restaurants(id,priority,seed,status,updated_at) VALUES(?,?,?,?,?)',
                       (seed['id'],rank,json.dumps(seed),'pending' if seed.get('website') else 'no_website',now()))
            added+=1
        set_state(db,'catalog_source_signature',signature);set_state(db,'catalog_pool_offset',handle.tell())
        set_state(db,'catalog_pool_exhausted',exhausted)
        set_state(db,'catalog_import_last',{'at':now(),'added':added,'scanned':scanned,'source_exhausted':exhausted})
    return added
