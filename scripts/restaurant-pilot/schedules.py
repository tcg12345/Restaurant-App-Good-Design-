"""Normalize explicit published schedules; never infer an omitted AM/PM."""
import re

DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
DAY=r'(?:Mo(?:n(?:day)?)?|Tu(?:e(?:sday)?)?|We(?:d(?:nesday)?)?|Th(?:u(?:rsday)?)?|Fr(?:i(?:day)?)?|Sa(?:t(?:urday)?)?|Su(?:n(?:day)?)?)'
DAYSET=DAY+r'(?:\s*(?:[-–]|through|to|,|&|and)\s*'+DAY+r')*'
TIME=r'(?:\d{1,2}(?::\d{2})?\s*[ap]\.?m\.?|(?:[01]?\d|2[0-3]):[0-5]\d)'
PERIOD=TIME+r'\s*[-–]\s*'+TIME
ENTRY=re.compile(r'(?P<days>'+DAYSET+r')\s*:?\s*(?P<times>closed|'+PERIOD+r'(?:(?:\s*(?:,|&|and)\s*|\s+)'+PERIOD+r')*)',re.I)


def clock(value):
    text=str(value).strip().lower().replace('.','')
    match=re.fullmatch(r'(\d{1,2})(?::([0-5]\d))?\s*([ap]m)',text)
    if match and 1<=int(match[1])<=12:
        return f'{int(match[1])%12+(12 if match[3]=="pm" else 0):02}:{int(match[2] or 0):02}'
    match=re.fullmatch(r'([01]?\d|2[0-3]):([0-5]\d)(?::00)?',text)
    return f'{int(match[1]):02}:{match[2]}' if match else None


def day(value):
    value=str(value).split('/')[-1]
    if not re.fullmatch(DAY,value,re.I): return None
    return next((i for i,name in enumerate(DAYS) if name[:2].lower()==value[:2].lower()),None)


def expand_days(text):
    parts=re.split(r'\s*(?:,|&|and)\s*',text,flags=re.I);result=[]
    for part in parts:
        span=re.split(r'\s*(?:[-–]|through|to)\s*',part,flags=re.I)
        indices=[day(v.strip()) for v in span]
        if None in indices or len(indices)>2: return []
        if len(indices)==1: result+=indices
        else:
            start,end=indices;result += [(start+i)%7 for i in range((end-start)%7+1)]
    return sorted(set(result))


def text_entries(text, full=True):
    matches=list(ENTRY.finditer(text));result=[];remainder=text
    for match in reversed(matches): remainder=remainder[:match.start()]+remainder[match.end():]
    if not matches or (full and remainder.strip(' \t\r\n;,|')): return None
    for match in matches:
        days=expand_days(match['days'])
        if not days: return None
        times=match['times']
        periods=[('00:00','00:00')] if times.lower()=='closed' else []
        if not periods:
            for period in re.finditer('('+TIME+r')\s*[-–]\s*('+TIME+')',times,re.I):
                opens,closes=clock(period[1]),clock(period[2])
                if not opens or not closes: return None
                periods.append((opens,closes))
        for index in days:
            for opens,closes in periods:
                result.append({'dayOfWeek':DAYS[index],'opens':opens,'closes':closes})
    return result


def normalize_schedule(value):
    values=value if isinstance(value,list) else [value];result=[]
    for item in values:
        if isinstance(item,str):
            entries=text_entries(item)
            if entries is None: return None
            result+=entries
        elif isinstance(item,dict):
            days=item.get('dayOfWeek',[]);days=days if isinstance(days,list) else [days]
            indices=[day(v) for v in days];opens,closes=clock(item.get('opens','')),clock(item.get('closes',''))
            if not days or None in indices or opens is None or closes is None: return None
            for index in indices: result.append({'dayOfWeek':DAYS[index],'opens':opens,'closes':closes})
        else: return None
    unique={(v['dayOfWeek'],v['opens'],v['closes']):v for v in result}
    return sorted(unique.values(),key=lambda v:(DAYS.index(v['dayOfWeek']),v['opens'],v['closes'])) or None


def labelled_schedule(text):
    """Only under a general hours heading; service-specific schedules stay in review."""
    for heading in re.finditer(r'\b(?:opening|business|operating|restaurant)?\s*hours\b',text,re.I):
        before=text[max(0,heading.start()-20):heading.start()]
        if re.search(r'\b(?:happy|bar|brunch|lunch|dinner|kitchen)\s*$',before,re.I): continue
        block=text[heading.end():heading.end()+800]
        block=re.split(r'\b(?:reservations?|newsletter|contact us|private dining|follow us)\b',block,flags=re.I)[0]
        if re.search(r'\b(?:happy hour|brunch|lunch|dinner|bar hours)\b',block,re.I): continue
        # Skip introductory text, then require one coherent schedule. Leave any
        # unparsed schedule-like text for review instead of silently dropping it.
        first=re.search(r'\b'+DAY+r'\b',block,re.I)
        if not first: continue
        block=block[first.start():]
        entries=list(ENTRY.finditer(block))
        if not entries: continue
        end=entries[-1].end();schedule=block[:end]
        parsed=text_entries(schedule,full=True)
        if parsed and any(v['opens']!=v['closes'] for v in parsed):
            tail=block[end:]
            if re.match(r'\s*(?:,|&|and)\s*\d',tail,re.I): continue
            return normalize_schedule(parsed),schedule
    return None,None
