"""Conservative extraction from explicit official-site text and linked menus."""
import re
import statistics
from pathlib import Path
import subprocess
import sys
import threading

PDF_SLOTS = threading.BoundedSemaphore(2)


def pdf_text(body):
    """Parse untrusted documents in a bounded child; no files or network needed."""
    if not body.startswith(b'%PDF-') or len(body)>2_000_000:
        raise ValueError('invalid_or_oversize_pdf')
    runtime=Path(__file__).resolve().parent
    isolated=runtime.parent/'source-python/bin/python'
    python=str(isolated) if isolated.exists() else sys.executable
    with PDF_SLOTS:
        try:
            result=subprocess.run([python,str(runtime/'pdf_text.py')],input=body,
                                  capture_output=True,timeout=15,check=False)
        except subprocess.TimeoutExpired:
            raise ValueError('pdf_extraction_timeout') from None
    if result.returncode:
        raise ValueError('pdf_extraction_failed: '+result.stderr.decode('utf-8','replace')[-160:])
    text=result.stdout.decode('utf-8','replace')
    if not text.strip(): raise ValueError('pdf_needs_ocr')
    return text[:100_000]


def text_matches_branch(text,seed):
    from collector import normalize,street_key
    name=normalize(seed.get('name',''));street=street_key(seed.get('address',''))
    normalized=' '+normalize(text)+' ';address_text=' '+street_key(text)+' '
    if len(name)<5 or not re.match(r'^\d+\s+\w',street): return False
    if ' '+name+' ' not in normalized or ' '+street+' ' not in address_text: return False
    locality=normalize(seed.get('locality',''))
    postcode=str(seed.get('postcode') or '')[:5]
    area=(locality and ' '+locality+' ' in normalized) or (len(postcode)==5 and ' '+postcode+' ' in normalized)
    if not area: return False
    # A generic chain/location-directory page is not evidence for one branch.
    addresses=set(re.findall(r'\b\d{1,6}\s+(?:[a-z]+\s+){1,5}(?:st|rd|ave|blvd|dr|ln|hwy|pkwy|ct)\b',address_text))
    return not any(a.strip()!=street for a in addresses)


def text_facts(text,url,seed,matched=False,method='official_text'):
    from collector import now
    from schedules import labelled_schedule
    if not matched and not text_matches_branch(text,seed): return []
    # Retain line breaks for labels/menu sections; only schedule parsing flattens.
    facts=[]
    def add(field,value,evidence,basis=None):
        fact={'field':field,'value':value,'source_url':url,'source_type':'official_website_candidate',
              'method':method,'evidence_path':evidence[:500],'branch_status':'matched',
              'observed_at':now(),'reuse_status':'website_terms_unreviewed'}
        if basis: fact['price_basis']=basis
        facts.append(fact)
    cuisine=re.search(r'\bCuisines?\s*:\s*([A-Za-z][A-Za-z &,/\-]{1,70}?)(?=[.!;\n]|\s+(?:Hours|Price|Address|Phone|Menu)\b|$)',text,re.I)
    if cuisine: add('cuisines',cuisine[1].strip(),cuisine[0])
    else:
        # Explicit self-description only, not dish names or a reviewer's opinion.
        cuisines=r'Italian|French|Mexican|Chinese|Japanese|Thai|Indian|Korean|Vietnamese|Greek|Spanish|Turkish|Lebanese|Ethiopian|Peruvian|Brazilian|American|Mediterranean|Caribbean|Cajun|Creole'
        description=re.search(r'\b(?:we (?:serve|offer)|specializ(?:e|ing) in)\s+(?:authentic |traditional |modern |contemporary )?('+cuisines+r')\s+cuisine\b',text,re.I)
        if description: add('cuisines',[description[1].title()],description[0])
    price=re.search(r'\bPrice(?:\s+range)?\s*:\s*(\$\s*\d+(?:\.\d{1,2})?\s*[-–]\s*\$?\s*\d+(?:\.\d{1,2})?|\${1,4}(?![\d$]))',text,re.I)
    if price: add('price_range',price[1].strip(),price[0],'published_range')
    if not price:
        fixed=re.search(r'\b(?:prix[ -]fixe|tasting menu|set menu)\s*[:–-]?\s*\$\s*(\d{1,3}(?:\.\d{1,2})?)\s*(?:per (?:person|guest)|/person)\b',text,re.I)
        if fixed and 5<=float(fixed[1])<=999:
            add('price_range',f'${fixed[1]}-${fixed[1]} per person',fixed[0],'published_fixed_menu_per_person')
    schedule,evidence=labelled_schedule(' '.join(text.split()))
    if schedule: add('hours',schedule,evidence)
    estimate=menu_estimate(text)
    if estimate: add('menu_price_estimate',estimate,'Explicitly priced items under an entrees/main courses heading','estimated_entree_prices')
    return facts


def menu_estimate(text):
    """Review-only sample; never a dollar rating or assumed total meal cost."""
    active=False;prices=[]
    for raw in text.splitlines():
        line=' '.join(raw.split())
        if re.fullmatch(r'(?:entr[eé]es|main courses|mains)',line,re.I): active=True;continue
        if active and re.fullmatch(r'(?:desserts|sides|appetizers|starters|drinks|cocktails|wine|beer|kids(?: menu)?|lunch|brunch|breakfast)',line,re.I): break
        if not active or not re.search('[A-Za-z]',line): continue
        values=re.findall(r'\$(\d{1,3}(?:\.\d{1,2})?)(?!\d)',line)
        if len(values)==1 and not re.search(r'\b(?:add|supplement|extra|upgrade|per|market price)\b|\+',line,re.I):
            price=float(values[0])
            if 5<=price<=250: prices.append(price)
    if len(prices)<3: return None
    return {'currency':'USD','sample_count':len(prices),'minimum':min(prices),'maximum':max(prices),
            'median':statistics.median(prices),'basis':'estimated_from_explicit_entree_prices',
            'not_total_meal_cost':True,'review_required':True}
