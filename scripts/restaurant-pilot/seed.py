"""Select a reproducible US pilot from licensed Overture Places records."""
from __future__ import annotations

import json
import math
import re
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path
from collections import deque

from collector import distance, normalize, valid_url, now

# Editorial pilot coverage, not a claim that these are the largest cities in order.
# Overlapping metros assign records to their nearest center. Radii are kilometres.
MARKETS = [
    ("New York",40.713,-74.006,55), ("Los Angeles",34.052,-118.244,65),
    ("Chicago",41.878,-87.630,55), ("San Francisco Bay",37.775,-122.419,70),
    ("Washington DC",38.907,-77.037,45), ("Boston",42.360,-71.059,45),
    ("Philadelphia",39.953,-75.165,40), ("Miami",25.762,-80.192,55),
    ("Houston",29.760,-95.370,55), ("Dallas Fort Worth",32.777,-96.797,65),
    ("Atlanta",33.749,-84.388,50), ("Seattle",47.606,-122.332,45),
    ("San Diego",32.716,-117.161,45), ("Denver",39.739,-104.990,45),
    ("Portland",45.515,-122.678,40), ("Las Vegas",36.170,-115.140,35),
    ("Austin",30.267,-97.743,40), ("New Orleans",29.951,-90.072,35),
    ("Nashville",36.163,-86.782,35), ("Phoenix",33.449,-112.074,55),
    ("Minneapolis",44.978,-93.265,40), ("Detroit",42.331,-83.046,45),
    ("Charlotte",35.227,-80.843,40), ("Orlando",28.538,-81.379,40),
    ("Tampa",27.951,-82.457,45), ("San Antonio",29.424,-98.494,40),
    ("Baltimore",39.290,-76.612,30), ("Pittsburgh",40.441,-79.996,35),
    ("St Louis",38.627,-90.199,40), ("Kansas City",39.100,-94.579,40),
    ("Columbus",39.961,-82.999,35), ("Cleveland",41.499,-81.694,35),
    ("Cincinnati",39.103,-84.512,35), ("Raleigh Durham",35.780,-78.639,50),
    ("Charleston",32.777,-79.931,30), ("Savannah",32.084,-81.100,25),
    ("Indianapolis",39.768,-86.158,35), ("Salt Lake City",40.761,-111.891,40),
    ("Sacramento",38.582,-121.494,35), ("Honolulu",21.310,-157.858,35),
    ("Anchorage",61.218,-149.900,35), ("Napa Sonoma",38.298,-122.287,50),
]


def curated_index(path):
    """User-provided existing guide is used for priority only, not fact backfill."""
    result = defaultdict(list)
    if path and Path(path).exists():
        for row in json.loads(Path(path).read_text()):
            if row.get("co") not in ("USA", "United States", "United States of America"):
                continue
            if isinstance(row.get("la"), (float, int)) and isinstance(row.get("lng"), (float, int)):
                result[normalize(row["n"])].append(row)
    return result


def classify(row, curated, markets=None, nationwide=False):
    markets = MARKETS if markets is None else markets
    name, lat, lng = row.get("name"), row.get("lat"), row.get("lng")
    if not name or lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    ref = next((r for r in curated.get(normalize(name), []) if distance(lat, lng, r["la"], r["lng"]) <= 200), None)
    near = [] if nationwide else sorted((distance(lat,lng,m[1],m[2]),m) for m in markets)
    market = ', '.join(str(v) for v in (row.get('locality'),row.get('region')) if v) if nationwide else next((m[0] for d,m in near if d <= m[3]*1000), None)
    if nationwide and not market: market='US locality unspecified'
    if not ref and not market:
        return None
    website = None
    for candidate in row.get("websites") or []:
        try:
            website = valid_url(candidate)
            break
        except (ValueError, TypeError):
            continue
    award = "starred" if ref and ref.get("s", 0) else "bib_gourmand" if ref and ref.get("b") else "selected" if ref else None
    # Quality is source completeness/existence confidence, never a diner rating.
    quality = round(float(row.get("confidence") or 0)*100) + (20 if website else 0) + (10 if row.get("address") else 0)
    quality += 5 if row.get("phones") else 0
    quality -= 15 if row.get("brand") else 0
    return {**row, "website": website, "market": market or "Other US acclaimed", "selection_score": quality,
            "selection_reason": "existing_guide_match" if ref else "nationwide_us" if nationwide else "major_us_market",
            "guide_tier": award, "guide_stars": ref.get("s", 0) if ref else 0,
            "guide_reference": ref.get("u") if ref else None, "quality_rating": None}


def choose(rows, target, include_cafes=False):
    # Dedup same name + same address within a city. Without address, use precise coordinates.
    seen, unique = set(), []
    for r in sorted(rows, key=lambda r: (-r["selection_score"], r["id"])):
        category = r.get('category','restaurant')
        if not include_cafes and not r['guide_tier'] and not (category == 'restaurant' or category.endswith('_restaurant')):
            continue
        key = (normalize(r["name"]), normalize(r.get("address") or f'{r["lat"]:.4f},{r["lng"]:.4f}'),
               normalize(r.get("locality", "")), r.get("region"))
        if key not in seen:
            seen.add(key)
            unique.append(r)
    tiers = {"starred": 0, "bib_gourmand": 1, "selected": 2}
    acclaimed = sorted((r for r in unique if r["guide_tier"]),
                       key=lambda r: (tiers[r["guide_tier"]], -r["guide_stars"], -r["selection_score"],r["id"]))
    selected = acclaimed[:target]
    selected_ids = {r["id"] for r in selected}
    pools = defaultdict(list)
    for r in unique:
        if r["id"] not in selected_ids:
            pools[r["market"]].append(r)
    # Acclaimed first, then geographic round-robin; no one large city consumes the pilot.
    # At most three non-acclaimed locations per branded chain per market.
    chain_counts = Counter()
    markets = sorted(pools)
    pools = {key: deque(value) for key,value in pools.items()}
    while len(selected) < target:
        added = False
        for market in markets:
            while pools[market]:
                r = pools[market].popleft()
                chain = (market, normalize(r.get("brand") or ""))
                if chain[1] and chain_counts[chain] >= 3:
                    continue
                selected.append(r)
                chain_counts[chain] += 1
                added = True
                break
            if len(selected) == target:
                break
        if not added:
            break
    for rank,r in enumerate(selected,1):
        r["pilot_priority"] = rank
    return selected


def download_candidates(output, curated_path, release=None, min_confidence=.8, market_names=None, nationwide=False, progress=None):
    try:
        import duckdb
    except ImportError:
        raise SystemExit("Install scripts/restaurant-pilot/requirements.txt into an isolated Python environment first.")
    curated = curated_index(curated_path)
    markets = [m for m in MARKETS if not market_names or m[0] in market_names]
    if market_names:
        unknown = set(market_names) - {m[0] for m in markets}
        if unknown:
            raise ValueError('Unknown markets: '+', '.join(sorted(unknown)))
        curated = {key:[r for r in refs if any(distance(r['la'],r['lng'],m[1],m[2]) <= m[3]*1000 for m in markets)]
                   for key,refs in curated.items()}
    if not release:
        with urllib.request.urlopen("https://stac.overturemaps.org/catalog.json", timeout=30) as r:
            release = json.load(r)["latest"]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.\d+",release):
        raise ValueError("Invalid Overture release")
    output = Path(output)
    output.parent.mkdir(parents=True,exist_ok=True)
    connection = duckdb.connect()
    extensions = output.parent.resolve()/"duckdb-extensions"
    connection.execute("SET extension_directory = ?",[str(extensions)])
    connection.execute("INSTALL httpfs; LOAD httpfs;")
    connection.execute("SET s3_region='us-west-2'; SET threads=4; SET memory_limit='1GB'; SET enable_progress_bar=false;")
    connection.execute("SET temp_directory=?",[str(output.parent/"duckdb-tmp")])
    source = f"s3://overturemaps-us-west-2/release/{release}/theme=places/type=place/*"
    schema = {r[0] for r in connection.execute("DESCRIBE SELECT * FROM read_parquet(?)",[source]).fetchall()}
    if 'taxonomy' in schema:
        category = "CASE WHEN list_contains(taxonomy.hierarchy,'restaurant') THEN 'restaurant' ELSE basic_category END"
        food = "(list_contains(taxonomy.hierarchy,'restaurant') OR basic_category IN ('restaurant','cafe','coffee_shop','bakery'))"
        if nationwide: food="(list_contains(taxonomy.hierarchy,'restaurant') OR basic_category='restaurant')"
    elif "basic_category" in schema:
        category = "basic_category"
        food = "basic_category IN ('restaurant','cafe','coffee_shop','bakery')"
    else:
        category = "categories.primary"
        food = "(categories.primary LIKE '%restaurant%' OR categories.primary IN ('cafe','coffee_shop','bakery','pizza_restaurant'))"
    # Restrict remote row groups to pilot markets and small areas around guide
    # references. Avoid a costly national scan just to discard most rows later.
    boxes = []
    for _,lat,lng,radius in markets:
        dy = radius/111
        dx = dy/max(.1,math.cos(math.radians(lat)))
        boxes.append((lng-dx,lng+dx,lat-dy,lat+dy))
    for references in curated.values():
        for r in references:
            lat,lng = r['la'],r['lng']
            if not any(distance(lat,lng,m[1],m[2]) < m[3]*1000 for m in markets):
                boxes.append((lng-.01,lng+.01,lat-.01,lat+.01))
    spatial = ' OR '.join(f'(bbox.xmin BETWEEN {x1:.6f} AND {x2:.6f} AND bbox.ymin BETWEEN {y1:.6f} AND {y2:.6f})' for x1,x2,y1,y2 in boxes)
    # A simple outer envelope lets Parquet skip remote row groups using min/max
    # statistics. The disjunction of city boxes alone can force a global scan.
    envelope = (f'bbox.xmin BETWEEN {min(b[0] for b in boxes):.6f} AND {max(b[1] for b in boxes):.6f}'
                f' AND bbox.ymin BETWEEN {min(b[2] for b in boxes):.6f} AND {max(b[3] for b in boxes):.6f}')
    if nationwide: envelope,spatial='TRUE','TRUE'
    sql = f"""SELECT id, names.primary AS name, bbox.ymin AS lat, bbox.xmin AS lng,
        addresses[1].freeform AS address, addresses[1].locality AS locality,
        addresses[1].region AS region, addresses[1].postcode AS postcode,
        websites, phones, {category} AS category, confidence, brand.names.primary AS brand,
        to_json(sources) AS source_records, operating_status
        FROM read_parquet(?) WHERE addresses[1].country='US' AND {food}
        AND confidence>=? AND coalesce(operating_status,'') NOT IN ('permanently_closed','closed')
        AND {envelope} AND ({spatial})"""
    print(f"Reading Overture {release}: {'nationwide' if nationwide else 'market'} US restaurant candidates.",flush=True)
    parameters=[source,min_confidence]
    if nationwide:
        # Separate simple envelopes let remote Parquet statistics skip the rest
        # of the world. Together these cover the contiguous states, Alaska
        # (including both sides of the date line) and Hawaii, without city caps.
        national_boxes=[(-125,-66,24,50),(-180,-129,50,72),(170,180,50,72),(-161,-154,18,23)]
        pieces=[];parameters=[]
        for x1,x2,y1,y2 in national_boxes:
            pieces.append(sql+f' AND bbox.xmin BETWEEN {x1} AND {x2} AND bbox.ymin BETWEEN {y1} AND {y2}')
            parameters += [source,min_confidence]
        sql=' UNION ALL '.join(pieces)
    cursor = connection.execute(sql,parameters)
    keys = [d[0] for d in cursor.description]
    count, scanned = 0,0
    temporary = output.with_suffix(".partial")
    with temporary.open("w") as f:
        while batch := cursor.fetchmany(2000):
            for values in batch:
                scanned += 1
                row = dict(zip(keys,values))
                row["source_records"] = json.loads(row["source_records"] or "[]")
                row["address"], row["locality"] = row["address"] or "", row["locality"] or ""
                item = classify(row,curated,markets,nationwide=nationwide)
                if item:
                    item.update({"dataset":"Overture Places","release":release,"source_uri":source,"imported_at":now(),"country":"US"})
                    f.write(json.dumps(item,ensure_ascii=False)+"\n")
                    count += 1
            if scanned % 20000 == 0:
                print(f"Read {scanned:,}; retained {count:,} candidates",flush=True)
            if progress: progress(count)
    temporary.replace(output)
    connection.close()
    if nationwide:
        (output.parent/'source-manifest.json').write_text(json.dumps({'dataset':'Overture Places','release':release,
            'candidate_count':count,'scope':'Nationwide US country filter; no city, metro-radius, chain or guide restriction. Source coverage is not guaranteed exhaustive.',
            'minimum_confidence':min_confidence,'source_uri':source,'completed_at':now(),'complete_scan':True},indent=2)+'\n')
    print(f"Saved {count:,} candidates to {output}",flush=True)
