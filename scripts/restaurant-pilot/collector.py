"""Bounded website fact collection. No Google, AI, browser or production access."""
from __future__ import annotations

import hashlib
import fnmatch
import http.client
import ipaddress
import json
import math
import re
import socket
import threading
import time
import unicodedata
import urllib.parse
import urllib.robotparser
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from html.parser import HTMLParser
from email.utils import parsedate_to_datetime

AGENT = "GoodEatsResearchBot"
COLLECTOR_VERSION = "0.7"
BLOCKED_DOMAINS = (
    "google.com", "googleapis.com", "goo.gl", "g.page", "maps.app.goo.gl",
    "yelp.com", "tripadvisor.com", "opentable.com", "resy.com", "doordash.com",
    "ubereats.com", "grubhub.com", "facebook.com", "instagram.com", "tiktok.com",
    "x.com", "twitter.com", "foursquare.com", "guide.michelin.com",
)
FOOD_TYPES = {"Restaurant", "CafeOrCoffeeShop", "Bakery", "FoodEstablishment", "BarOrPub", "FastFoodRestaurant", "LocalBusiness"}
HOTEL_TYPES = {'Hotel','Resort','LodgingBusiness','Motel'}


def now():
    return datetime.now(timezone.utc).isoformat()


def normalize(value):
    value = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode().lower()
    return " ".join(re.findall(r"[a-z0-9]+", value))


def street_key(value):
    abbreviations = {'street':'st','road':'rd','avenue':'ave','boulevard':'blvd','drive':'dr',
                     'lane':'ln','court':'ct','highway':'hwy','parkway':'pkwy','place':'pl',
                     'north':'n','south':'s','east':'e','west':'w','mill':'ml'}
    return ' '.join(abbreviations.get(word,word) for word in normalize(value).split())


def host_key(host):
    return (host or "").lower().removeprefix("www.").rstrip(".")


def valid_url(url):
    """Syntactic check. Every network hop also pins a public DNS result."""
    p = urllib.parse.urlsplit(str(url).strip())
    host = host_key(p.hostname)
    if p.scheme not in ("http", "https") or not host or p.username or p.password:
        raise ValueError("invalid_url")
    if p.port not in (None, 80, 443) or any(ord(c) < 32 for c in url):
        raise ValueError("invalid_url")
    if "." not in host or host.endswith((".local", ".internal", ".localhost")):
        raise ValueError("private_host")
    if any(host == d or host.endswith("." + d) for d in BLOCKED_DOMAINS):
        raise ValueError("third_party_directory")
    try:
        if not ipaddress.ip_address(host).is_global:
            raise ValueError("private_host")
    except ValueError as error:
        if str(error) == "private_host":
            raise
    return urllib.parse.urlunsplit((p.scheme, p.netloc, p.path or "/", p.query, ""))


def public_addresses(host, port):
    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("private_dns_target")
    return addresses


def pinned_connection(addresses, timeout):
    last = None
    for family, socktype, proto, _, address in addresses:
        sock = socket.socket(family, socktype, proto)
        sock.settimeout(timeout)
        try:
            sock.connect(address)
            return sock
        except OSError as error:
            last = error
            sock.close()
    raise last or OSError("No public address")


@dataclass
class Response:
    url: str
    status: int
    headers: dict
    body: bytes


def robot_path(value):
    """Compare escaped URL octets while decoding only ASCII unreserved octets."""
    value = urllib.parse.quote(value, safe="/%:*?$&=+;,@!()[]~-._")
    def decode(match):
        char = chr(int(match.group(1), 16))
        return char if char.isascii() and (char.isalnum() or char in "-._~") else match.group(0).upper()
    return re.sub(r"%([0-9a-fA-F]{2})", decode, value)


class RobotsPolicy(urllib.robotparser.RobotFileParser):
    """Add wildcard/end-anchor and longest-rule matching missing in stdlib."""
    def parse(self, lines):
        super().parse(lines)
        # Newer CPython versions use `groups` as an internal dictionary.
        # Keep our wildcard-rule index separate from the stdlib's state.
        self._goodeats_groups = []
        agents, rules, directives = [], [], False
        for line in lines:
            line = line.split("#", 1)[0].strip()
            if ":" not in line:
                continue
            key, value = (part.strip() for part in line.split(":", 1))
            key = key.lower()
            if key == "user-agent":
                if directives:
                    self._goodeats_groups.append((agents, rules))
                    agents, rules, directives = [], [], False
                agents.append(value.lower())
            elif agents:
                directives = True
                if key in ("allow", "disallow") and value:
                    rules.append((robot_path(value), key == "allow"))
        if agents:
            self._goodeats_groups.append((agents, rules))

    def can_fetch(self, useragent, url):
        if self.allow_all:
            return True
        target = urllib.parse.urlsplit(url)
        path = robot_path((target.path or "/") + ("?" + target.query if target.query else ""))
        applicable = []
        for agents, rules in self._goodeats_groups:
            specificity = max((0 if a == "*" else len(a) for a in agents if a == "*" or a in useragent.lower()), default=-1)
            if specificity >= 0:
                applicable.append((specificity, rules))
        best = max((s for s, _ in applicable), default=-1)
        matched = []
        for specificity, rules in applicable:
            if specificity != best:
                continue
            for pattern, allowed in rules:
                anchored = pattern.endswith("$")
                glob = pattern[:-1] if anchored else pattern + "*"
                # fnmatch's atomic star handling avoids regex backtracking; only
                # robots '*' is special. Question marks/brackets are literal.
                glob = glob.replace("[", "[[]").replace("?", "[?]")
                if fnmatch.fnmatchcase(path, glob):
                    matched.append((len(pattern.replace("*", "").rstrip("$").encode()), allowed))
        return max(matched, default=(0, True))[1]


class Fetcher:
    """Each host has a shared lock/delay; robots and pages use the same budget."""
    def __init__(self, user_agent, delay=2.0, timeout=12.0, max_requests=1000, request_guard=None):
        self.user_agent, self.delay, self.timeout = user_agent, delay, timeout
        self.max_requests, self.request_count = max_requests, 0
        self.locks, self.last, self.robots = {}, {}, {}
        self.cooldowns={}
        self.mutex = threading.Lock()
        self.request_guard = request_guard

    def _single(self, url, max_bytes):
        p = urllib.parse.urlsplit(valid_url(url))
        port = p.port or (443 if p.scheme == "https" else 80)
        addresses = public_addresses(p.hostname, port)
        with self.mutex:
            if self.request_count >= self.max_requests:
                raise ValueError("request_budget_exhausted")
            if self.request_guard:
                self.request_guard()
            self.request_count += 1
        cls = http.client.HTTPSConnection if p.scheme == "https" else http.client.HTTPConnection
        conn = cls(p.hostname, port=port, timeout=self.timeout)
        # Connect to the already-validated IP while preserving Host and TLS SNI.
        conn._create_connection = lambda *args, **kwargs: pinned_connection(addresses, self.timeout)
        try:
            conn.request("GET", urllib.parse.urlunsplit(("", "", p.path or "/", p.query, "")),
                         headers={"User-Agent": self.user_agent, "Accept": "text/html,application/ld+json,text/plain;q=0.8", "Accept-Encoding": "gzip"})
            r = conn.getresponse()
            if r.getheader("Content-Length") and int(r.getheader("Content-Length")) > max_bytes:
                raise ValueError("response_too_large")
            body = read_body(r, max_bytes)
            return Response(url, r.status, {k.lower(): v for k, v in r.getheaders()}, body)
        finally:
            conn.close()

    def _delayed(self, url, max_bytes, delay=None):
        host = host_key(urllib.parse.urlsplit(url).hostname)
        with self.mutex:
            lock = self.locks.setdefault(host, threading.Lock())
        with lock:
            if self.cooldowns.get(host,0)>time.monotonic():
                raise ValueError('host_backoff_deferred')
            remaining = self.last.get(host, 0) + max(self.delay, delay or 0) - time.monotonic()
            if remaining > 0:
                time.sleep(remaining)
            try:
                response=self._single(url, max_bytes)
                if response.status in (429,503):
                    retry=response.headers.get('retry-after','');seconds=900 if response.status==429 else 120
                    try:
                        seconds=max(seconds,int(retry) if retry.isdigit() else (parsedate_to_datetime(retry)-datetime.now(timezone.utc)).total_seconds())
                    except (ValueError,TypeError,OverflowError): pass
                    self.cooldowns[host]=time.monotonic()+seconds
                return response
            finally:
                self.last[host] = time.monotonic()

    def _policy(self, url):
        p = urllib.parse.urlsplit(url)
        origin = urllib.parse.urlunsplit((p.scheme, p.netloc, "", "", ""))
        with self.mutex:
            cached = self.robots.get(origin)
        if cached is not None:
            return cached
        robot_url = origin + "/robots.txt"
        result = None
        for _ in range(4):
            result = self._delayed(robot_url, 512_000)
            if result.status in (301, 302, 303, 307, 308):
                target = valid_url(urllib.parse.urljoin(robot_url, result.headers.get("location", "")))
                if host_key(urllib.parse.urlsplit(target).hostname) != host_key(p.hostname):
                    raise ValueError("robots_external_redirect")
                robot_url = target
            else:
                break
        if result.status not in (200, 404, 410):
            raise ValueError("robots_unavailable_" + str(result.status))
        if result.status == 200 and "text/html" in result.headers.get("content-type", "").lower():
            raise ValueError("robots_invalid_html")
        parser = RobotsPolicy()
        parser.parse(result.body.decode("utf-8", "replace").splitlines() if result.status == 200 else [])
        if result.status in (404, 410):
            parser.allow_all = True
        delay = parser.crawl_delay(AGENT) or parser.crawl_delay("*") or self.delay
        rate = parser.request_rate(AGENT) or parser.request_rate("*")
        if rate and rate.requests:
            delay = max(delay, rate.seconds / rate.requests)
        if delay > 30:
            raise ValueError("crawl_delay_deferred")
        cached = (parser, delay, result.status, robot_url)
        with self.mutex:
            self.robots[origin] = cached
        return cached

    def get(self, url):
        original = host_key(urllib.parse.urlsplit(valid_url(url)).hostname)
        for _ in range(4):
            url = valid_url(url)
            if host_key(urllib.parse.urlsplit(url).hostname) != original:
                raise ValueError("external_redirect_review")
            parser, delay, _, _ = self._policy(url)
            if not parser.can_fetch(AGENT, url):
                raise ValueError("robots_disallowed")
            result = self._delayed(url, 2_000_000, delay)
            if result.status in (301, 302, 303, 307, 308):
                url = urllib.parse.urljoin(url, result.headers.get("location", ""))
                continue
            return result
        raise ValueError("redirect_limit")


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.jsonld, self.links, self.text = [], [], []
        self.script = None
        self.hidden = 0
        self.anchor = None
        self.robots = ""

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('p','div','section','h1','h2','h3','li','tr','br') and not self.hidden:
            self.text.append('\n')
        if tag == "script":
            self.script = [] if a.get("type", "").split(";")[0].strip().lower() == "application/ld+json" else None
            self.hidden += 1
        elif tag in ("style", "noscript"):
            self.hidden += 1
        elif tag == "a":
            self.anchor = [a.get("href", ""), ""]
        elif tag == "meta" and a.get("name", "").lower() in ("robots", AGENT.lower()):
            self.robots += " " + a.get("content", "")

    def handle_endtag(self, tag):
        if tag == "script":
            if self.script is not None:
                try:
                    self.jsonld.append(json.loads("".join(self.script)))
                except (ValueError, RecursionError):
                    pass
            self.script = None
        if tag in ("script", "style", "noscript"):
            self.hidden = max(0, self.hidden - 1)
        if tag == "a" and self.anchor:
            self.links.append(tuple(self.anchor))
            self.anchor = None

    def handle_data(self, data):
        if self.script is not None:
            self.script.append(data)
        if not self.hidden:
            if self.anchor:
                self.anchor[1] += data
            self.text.append(data)


class MicrodataParser(HTMLParser):
    """Read explicitly labelled Schema.org microdata without executing page code."""
    VOID = {'meta','link','img','br','hr','input','source','area','base','embed','param','wbr'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.items = [], []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        item = {'@type': attrs.get('itemtype','').split('/')[-1]} if 'itemscope' in attrs else None
        frame = {'tag':tag, 'props':attrs.get('itemprop','').split(), 'item':item, 'text':[],
                 'value':attrs.get('content',attrs.get('datetime',attrs.get('href') if tag in ('a','link') else None))}
        self.stack.append(frame)
        if tag in self.VOID:
            self.handle_endtag(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag,attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_data(self, data):
        for frame in self.stack:
            if frame['props'] and frame['item'] is None:
                frame['text'].append(data)

    def handle_endtag(self, tag):
        index = next((i for i in range(len(self.stack)-1,-1,-1) if self.stack[i]['tag']==tag),None)
        if index is None:
            return
        while len(self.stack)>index:
            frame=self.stack.pop()
            value=frame['item'] if frame['item'] is not None else frame['value']
            if value is None:
                value=' '.join(' '.join(frame['text']).split())
            parent=next((f['item'] for f in reversed(self.stack) if f['item'] is not None),None)
            if parent is not None and frame['props']:
                for prop in frame['props']:
                    if prop not in parent:
                        parent[prop]=value
                    elif isinstance(parent[prop],list):
                        parent[prop].append(value)
                    else:
                        parent[prop]=[parent[prop],value]
            elif frame['item'] is not None:
                self.items.append(value)


def nodes(value, depth=0):
    if depth > 20:
        return
    if isinstance(value, list):
        for item in value:
            yield from nodes(item, depth + 1)
    elif isinstance(value, dict):
        types = value.get("@type", [])
        if isinstance(types, str):
            types = [types]
        if any(str(t).split("/")[-1] in FOOD_TYPES for t in types):
            yield value
        if any(str(t).split('/')[-1] in HOTEL_TYPES for t in types):
            children=value.get('containsPlace',[])
            for child in children if isinstance(children,list) else [children]:
                if isinstance(child,dict):
                    hotel={k:value[k] for k in ('@type','name','address','geo') if k in value}
                    yield from nodes({**child,'containedInPlace':hotel},depth+1)
        for key in ("@graph", "mainEntity", "department", "subOrganization", "itemListElement", "item"):
            if key in value:
                yield from nodes(value[key], depth + 1)


def distance(lat1, lng1, lat2, lng2):
    a, b = math.radians(lat1), math.radians(lat2)
    h = math.sin((b-a)/2)**2 + math.cos(a)*math.cos(b)*math.sin(math.radians(lng2-lng1)/2)**2
    return 6371000 * 2 * math.asin(min(1, math.sqrt(h)))


def match_branch(node, seed):
    name = normalize(node.get("name", ""))
    reference = normalize(seed["name"])
    if not name or SequenceMatcher(None, name, reference).ratio() < .72:
        return "unmatched"
    geo = node.get("geo") or {}
    geo_match = False
    if isinstance(geo, dict):
        try:
            lat, lng = float(geo["latitude"]), float(geo["longitude"])
            if not (-90 <= lat <= 90 and -180 <= lng <= 180):
                return "conflicting_location"
            dist = distance(lat, lng, seed["lat"], seed["lng"])
            if dist > 500:
                return "conflicting_location"
            geo_match = dist <= 200
        except (KeyError, ValueError, TypeError):
            pass
    address = node.get("address") or {}
    if not isinstance(address, dict):
        # Common Squarespace JSON-LD is a newline-delimited postal address.
        # Infer area evidence only from the portion after the street line.
        parts = re.split(r"[\n,]+",str(address),maxsplit=1)
        remainder = parts[1] if len(parts)>1 else ''
        locality = normalize(seed.get('locality',''))
        postal = re.search(r'\b([A-Za-z]{2})[,\s]+(\d{5})(?:-\d{4})?\b',remainder)
        address = {'streetAddress':parts[0],
                   'addressLocality':seed.get('locality','') if locality and f' {locality} ' in f' {normalize(remainder)} ' else '',
                   'addressRegion':postal[1] if postal else '', 'postalCode':postal[2] if postal else ''}
    street, expected = street_key(address.get("streetAddress", "")), street_key(seed.get("address", ""))
    numbers = re.findall(r"\b\d+\b", street)
    expected_numbers = re.findall(r"\b\d+\b", expected)
    if numbers and expected_numbers and numbers[0] != expected_numbers[0]:
        return "conflicting_location"
    state = str(address.get("addressRegion", "")).upper()
    if len(state) == 2 and seed.get("region") and state != seed["region"]:
        return "conflicting_location"
    locality = normalize(address.get("addressLocality", ""))
    postcode = re.match(r"\d{5}", str(address.get("postalCode", "")))
    expected_postcode = re.match(r"\d{5}", str(seed.get("postcode", "")))
    area_match = bool((locality and locality == normalize(seed.get("locality", "")))
                      or (postcode and expected_postcode and postcode[0] == expected_postcode[0]))
    address_match = bool(numbers and expected_numbers and numbers[0] == expected_numbers[0]
                         and SequenceMatcher(None, street, expected).ratio() >= .85 and area_match)
    return "matched" if geo_match or address_match else "needs_branch_review"


def extract(html, url, seed):
    page = PageParser()
    page.feed(html)
    microdata = MicrodataParser()
    microdata.feed(html)
    observations = []
    subjects = []
    documents = [(doc,'jsonld') for doc in page.jsonld] + [(doc,'microdata') for doc in microdata.items]
    for document,method in documents:
        entries=document.get('@graph',[]) if isinstance(document,dict) else document if isinstance(document,list) else []
        references={v['@id']:v for v in entries if isinstance(v,dict) and '@id' in v}
        for node in nodes(document):
            subjects.append(node)
            branch = match_branch(node, seed)
            if branch in ("unmatched", "conflicting_location"):
                continue
            hotel=node.get('containedInPlace') or {}
            if isinstance(hotel,dict) and hotel.get('@id') in references:
                hotel=references[hotel['@id']]
            hotel_type=hotel.get('@type',[]) if isinstance(hotel,dict) else []
            hotel_type=[hotel_type] if isinstance(hotel_type,str) else hotel_type
            if any(str(t).split('/')[-1] in HOTEL_TYPES for t in hotel_type):
                hotel_fields={'in_hotel':True}
                if isinstance(hotel.get('name'),str) and hotel['name'].strip():
                    hotel_fields['hotel_name']=hotel['name']
                location={k:hotel[k] for k in ('address','geo') if hotel.get(k)}
                if location: hotel_fields['hotel_location']=location
                for field,value in hotel_fields.items():
                    if len(json.dumps(value))<=16000:
                        observations.append({'field':field,'value':value,'source_url':url,'source_type':'official_website_candidate',
                            'method':method,'evidence_path':'containedInPlace','branch_status':branch,
                            'observed_at':now(),'reuse_status':'website_terms_unreviewed'})
            fields = {"cuisines": "servesCuisine", "price_range": "priceRange", "hours": "openingHoursSpecification",
                      "special_hours": "specialOpeningHoursSpecification", "phone": "telephone", "address": "address",
                      "coordinates": "geo", "menu_url": "hasMenu"}
            for field, prop in fields.items():
                value = node.get(prop)
                if field == "hours" and not value:
                    value, prop = node.get("openingHours"), "openingHours"
                if field == "menu_url" and not value:
                    value, prop = node.get("menu"), "menu"
                if value in (None, "", [], {}):
                    continue
                if field in ('hours','special_hours'):
                    # Several live sites emit ', , , , , , ' for unknown hours.
                    serialized = json.dumps(value)
                    if not re.search(r'\b\d{1,2}:\d{2}\b|\b(?:closed|24/7)\b',serialized,re.I):
                        continue
                if len(json.dumps(value)) > 16_000:
                    continue
                observations.append({"field": field, "value": value, "source_url": url, "source_type": "official_website_candidate",
                                     "method": method, "evidence_path": prop, "branch_status": branch,
                                     "observed_at": now(), "reuse_status": "website_terms_unreviewed"})
    # Visible prose is retained only as a small review candidate, never auto-promoted.
    visible = re.sub(r"\s+", " ", " ".join(page.text))
    # Explicit labels only, and only on a page describing one corroborated branch.
    # A menu item name is not cuisine evidence; individual dish prices are not a range.
    if subjects and all(match_branch(subject,seed)=='matched' for subject in subjects):
        from schedules import labelled_schedule
        from completeness import valid_value
        if not any(o['field']=='hours' and valid_value('hours',o['value']) for o in observations):
            schedule,evidence=labelled_schedule(visible)
            if schedule:
                observations.append({'field':'hours','value':schedule,'source_url':url,
                    'source_type':'official_website_candidate','method':'explicit_hours_with_branch_evidence',
                    'evidence_path':evidence,'branch_status':'matched','observed_at':now(),
                    'reuse_status':'website_terms_unreviewed'})
        negative=re.search(r'\b(?:not (?:located |situated )?(?:in|inside|within) (?:a|any) hotel|(?:in|inside) (?:a )?hotel\s*:\s*(?:no|false))\b',visible,re.I)
        if negative:
            observations.append({'field':'in_hotel','value':False,'source_url':url,'source_type':'official_website_candidate',
                'method':'explicit_label_with_branch_evidence','evidence_path':negative[0],'branch_status':'matched',
                'observed_at':now(),'reuse_status':'website_terms_unreviewed'})
        labels = {
            'cuisines': r'\bCuisines?\s*:\s*([A-Za-z][A-Za-z &,/\-]{1,70}?)(?=[.!;\n]|\s+(?:Hours|Price|Address|Phone|Menu)\b|$)',
            'price_range': r'\bPrice(?:\s+range)?\s*:\s*(\${1,4}(?!\d)|\$\s*\d+(?:\.\d{2})?\s*[-–]\s*\$?\s*\d+(?:\.\d{2})?)',
        }
        for field,pattern in labels.items():
            match=re.search(pattern,visible,re.I)
            if match and not any(o['field']==field for o in observations):
                observations.append({'field':field,'value':match[1].strip(),'source_url':url,
                    'source_type':'official_website_candidate','method':'explicit_label_with_branch_evidence',
                    'evidence_path':match[0],'branch_status':'matched','observed_at':now(),'reuse_status':'website_terms_unreviewed'})
    hours = re.search(r"\b(?:Hours|Opening hours)\s*[:\-]?\s*(.{10,180})", visible, re.I)
    has_schedule = bool(hours and re.search(r"\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\b", hours.group(0), re.I)
                        and re.search(r"\b(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)|\d{1,2}:\d{2}|closed)\b",hours.group(0),re.I))
    if has_schedule and not any(o["field"] == "hours" for o in observations):
        observations.append({"field": "hours_text", "value": hours.group(0), "source_url": url,
                             "source_type": "website_text_candidate", "method": "labelled_text", "evidence_path": "visible_text",
                             "branch_status": "needs_branch_review", "observed_at": now(), "reuse_status": "website_terms_unreviewed"})
    # Sites without JSON-LD can still explicitly identify their branch in text.
    # Never override a structured subject that identifies another location.
    from enrichment import text_facts
    if not subjects or all(match_branch(subject,seed)=='matched' for subject in subjects):
        extra=text_facts(' '.join(page.text),url,seed,
                         matched=bool(subjects))
        present={o['field'] for o in observations}
        observations.extend(f for f in extra if f['field'] not in present)
    return observations, page


def collect(seed, fetcher, max_pages=3, prior=None):
    observations, pages = (list(prior.get('observations',[])),list(prior.get('pages',[]))) if prior else ([],[])
    start = seed.get("website")
    if not start:
        return {"status": "no_website", "observations": [], "pages": [], "collector_version": COLLECTOR_VERSION}
    queue = list(prior.get('remaining_urls',[])) if prior else [start]
    visited = {p['url'] for p in pages if 'url' in p}
    domain = host_key(urllib.parse.urlsplit(start).hostname)
    for _ in range(max_pages):
        if not queue:
            break
        url = queue.pop(0)
        if url in visited:
            continue
        visited.add(url)
        try:
            response = fetcher.get(url)
            record = {"url": response.url, "status": response.status, "observed_at": now(),
                      "sha256": hashlib.sha256(response.body).hexdigest()}
            pages.append(record)
            if response.status in (429,503):
                record['skip']='host_backoff'
                break
            if response.status != 200:
                continue
            content_type = response.headers.get("content-type", "").lower()
            if re.search(r"\b(?:noindex|noarchive|none)\b",response.headers.get('x-robots-tag',''),re.I):
                record['skip']='publisher_restriction'
                continue
            if 'application/pdf' in content_type or response.body.startswith(b'%PDF-'):
                from enrichment import pdf_text,text_facts
                text=pdf_text(response.body)
                facts=text_facts(text,response.url,seed,method='official_pdf_text')
                record['document_type']='pdf'
                observations.extend(facts)
                from completeness import readiness
                if readiness(seed,observations)['complete']:
                    record['collection_complete']=True
                    break
                continue
            if "text/html" not in content_type:
                record["skip"] = "not_html"
                continue
            facts, page = extract(response.body.decode("utf-8", "replace"), response.url, seed)
            directives = (page.robots + " " + response.headers.get("x-robots-tag", "")).lower()
            if re.search(r"\b(?:noindex|noarchive|none)\b", directives):
                record["skip"] = "publisher_restriction"
                continue
            observations.extend(facts)
            from completeness import readiness
            if readiness(seed,observations)['complete']:
                record['collection_complete']=True
                break
            missing=set(readiness(seed,observations)['missing_fields'])
            def relevance(link):
                text=' '.join(link).lower()
                score=0
                if 'hours' in missing and re.search(r'hours|contact|location|visit',text): score+=5
                if 'price_range' in missing and re.search(r'menu|pricing|prices|dinner|lunch|brunch|breakfast',text): score+=5
                if 'cuisines' in missing and re.search(r'about|story|cuisine',text): score+=3
                return -score
            # JSON-LD often links a real menu absent from normal navigation.
            menu_links=[]
            for fact in facts:
                if fact['field']=='menu_url' and fact['branch_status']=='matched':
                    values=fact['value'] if isinstance(fact['value'],list) else [fact['value']]
                    for value in values:
                        href=value if isinstance(value,str) else value.get('url') if isinstance(value,dict) else None
                        if isinstance(href,str): menu_links.append((href,'menu'))
            for href, label in sorted(page.links+menu_links,key=relevance):
                if not re.search(r"hours|contact|about|location|menu|dinner|lunch|brunch|breakfast", label + " " + href, re.I):
                    continue
                try:
                    candidate = valid_url(urllib.parse.urljoin(response.url, href))
                except ValueError:
                    continue
                p = urllib.parse.urlsplit(candidate)
                # External PDF assets must be explicitly linked by an official
                # page; their contents must independently identify this branch.
                is_pdf=p.path.lower().endswith('.pdf')
                if (host_key(p.hostname) != domain and not is_pdf) or (p.query and not is_pdf) or re.search(r"\.(jpg|png|zip)$", p.path, re.I):
                    continue
                if is_pdf and not ('price_range' in missing or 'hours' in missing):
                    continue
                if candidate not in visited and candidate not in queue:
                    queue.append(candidate)
        except Exception as error:
            pages.append({"url": url, "error": str(error)[:180], "observed_at": now()})
            if str(error) == "request_budget_exhausted":
                break
    matched = any(o["branch_status"] == "matched" for o in observations)
    status = "facts_found" if matched else "needs_review" if observations else "no_facts"
    if pages and all("error" in p or p.get("status") != 200 for p in pages):
        status = "fetch_error"
    from completeness import readiness
    ready=readiness(seed,observations)
    return {"status": status, "observations": observations, "pages": pages, "collector_version": COLLECTOR_VERSION,
            'missing_fields':ready['missing_fields'],'remaining_urls':queue[:50],
            'deeper_due':bool(not prior and queue and max_pages<=3 and 0<len(ready['missing_fields'])<=2)}


def read_body(response, limit):
    """Bound both compressed download size and decompressed HTML size."""
    encoding=(response.getheader('Content-Encoding') or 'identity').lower().strip()
    if encoding not in ('identity','gzip'):
        raise ValueError('unsupported_content_encoding')
    inflater=zlib.decompressobj(16+zlib.MAX_WBITS) if encoding=='gzip' else None
    chunks=[];downloaded=expanded=0
    while True:
        chunk=response.read(min(65536,limit+1-downloaded))
        if not chunk: break
        downloaded+=len(chunk)
        if downloaded>limit: raise ValueError('response_too_large')
        part=inflater.decompress(chunk,limit+1-expanded) if inflater else chunk
        expanded+=len(part)
        if expanded>limit or (inflater and inflater.unconsumed_tail):
            raise ValueError('response_too_large')
        chunks.append(part)
    if inflater and (not inflater.eof or inflater.unused_data):
        raise ValueError('invalid_gzip_response')
    return b''.join(chunks)
