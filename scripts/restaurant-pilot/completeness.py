"""Only sourced, usable cuisine + regular hours + price enter the finished list."""
import json
import re
from datetime import datetime, timezone, timedelta
from schedules import normalize_schedule

REQUIRED = ('cuisines', 'hours', 'price_range')
HOTEL = ('in_hotel','hotel_name','hotel_location')
UNKNOWN = {'unknown', 'n a', 'na', 'none', 'null', 'not available', 'varies', 'contact us'}
DAY = r'(?:Mo(?:n(?:day)?)?|Tu(?:e(?:sday)?)?|We(?:d(?:nesday)?)?|Th(?:u(?:rsday)?)?|Fr(?:i(?:day)?)?|Sa(?:t(?:urday)?)?|Su(?:n(?:day)?)?)'
CLOCK = r'(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?'


def useful(value):
    return isinstance(value, str) and bool(re.search('[A-Za-z]', value)) and re.sub('[^a-z ]', '', value.lower()).strip() not in UNKNOWN


def valid_value(field, value):
    if field=='in_hotel':
        return isinstance(value,bool)
    if field=='hotel_name':
        return useful(value) and len(value)<=300
    if field=='hotel_location':
        if not isinstance(value,dict): return False
        address=value.get('address')
        if isinstance(address,dict) and address.get('streetAddress') and (address.get('addressLocality') or address.get('postalCode')):
            return True
        if isinstance(address,str) and re.search(r'\d',address) and len(address)>10:
            return True
        geo=value.get('geo',{})
        try:
            return -90<=float(geo['latitude'])<=90 and -180<=float(geo['longitude'])<=180
        except (ValueError,KeyError,TypeError): return False
    if field == 'cuisines':
        values = value if isinstance(value, list) else [value]
        return bool(values) and all(useful(v) and len(v) <= 200 for v in values)
    if field == 'price_range':
        if not isinstance(value, str):
            return False
        return bool(re.fullmatch(r'\s*\${1,4}\s*', value) or
                    re.fullmatch(r'\s*(?:USD\s*|\$)\s*\d+(?:\.\d{1,2})?\s*(?:-|–|to)\s*(?:USD\s*|\$)?\s*\d+(?:\.\d{1,2})?(?:\s*(?:per person|per guest|/person))?\s*', value, re.I))
    if field == 'hours':
        value=normalize_schedule(value)
        if value is None: return False
        if isinstance(value, str):
            return bool(re.search(r'\b'+DAY+r'\b', value, re.I) and
                        re.search(CLOCK+r'\s*[-–]\s*'+CLOCK, value))
        values = value if isinstance(value, list) else [value]
        def valid_part(v):
            if isinstance(v,str):
                return valid_value('hours',v)
            if not isinstance(v,dict):
                return False
            days=v.get('dayOfWeek',[])
            days=days if isinstance(days,list) else [days]
            return bool(days) and all(re.fullmatch(DAY,str(d).split('/')[-1],re.I) for d in days) and bool(
                re.fullmatch(CLOCK,str(v.get('opens',''))) and re.fullmatch(CLOCK,str(v.get('closes',''))))
        return bool(values) and all(valid_part(v) for v in values) and any(v['opens']!=v['closes'] for v in values)
    return False


def readiness(seed, observations, max_age_days=90):
    accepted = {field: [] for field in REQUIRED+HOTEL}
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    for fact in observations:
        field = fact.get('field')
        if field not in accepted or fact.get('branch_status') != 'matched' or not valid_value(field, fact.get('value')):
            continue
        if not fact.get('source_url', '').startswith(('https://', 'http://')):
            continue
        try:
            stamp = datetime.fromisoformat(fact.get('observed_at', '')).astimezone(timezone.utc)
            if stamp < cutoff:
                continue
        except (ValueError, TypeError):
            continue
        accepted[field].append(fact)
    missing = [field for field in REQUIRED if not accepted[field]]
    conflicts = []
    values = {}
    for field, facts in accepted.items():
        distinct = {}
        for fact in facts:
            value = fact['value']
            if field=='hours': value=normalize_schedule(value)
            if field == 'cuisines':
                value = sorted({v.strip().lower() for v in (value if isinstance(value, list) else [value])})
            key = json.dumps(value, sort_keys=True)
            distinct[key] = value if field=='hours' else fact['value']
        if len(distinct) > 1:
            conflicts.append(field)
        elif distinct:
            values[field] = next(iter(distinct.values()))
    hotel={'in_hotel':None,'hotel_name':None,'hotel_location':None,'status':'unknown',
           'evidence':{f:accepted[f] for f in HOTEL}}
    if not any(f in conflicts for f in HOTEL):
        if values.get('in_hotel') is False:
            hotel.update(in_hotel=False,status='confirmed_not_in_hotel')
        elif values.get('in_hotel') is True and all(f in values for f in ('hotel_name','hotel_location')):
            hotel.update(in_hotel=True,hotel_name=values['hotel_name'],hotel_location=values['hotel_location'],status='confirmed_in_hotel')
            geo=values['hotel_location'].get('geo')
            if isinstance(geo,dict):
                try:
                    from collector import distance
                    if distance(float(geo['latitude']),float(geo['longitude']),seed['lat'],seed['lng'])>500:
                        hotel.update(in_hotel=None,status='hotel_location_needs_review')
                except (ValueError,KeyError,TypeError):
                    hotel.update(in_hotel=None,status='hotel_location_needs_review')
    core_conflicts=[f for f in conflicts if f in REQUIRED]
    return {'complete': seed.get('country') == 'US' and not missing and not core_conflicts,
            'missing_fields': missing, 'conflicting_fields': core_conflicts, 'values': values,'hotel':hotel,
            'evidence': accepted, 'scope': 'Published regular schedule and price category/range; unspecified days remain unknown.'}
