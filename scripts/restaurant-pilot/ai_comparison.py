"""Isolated, reproducible restaurant extraction benchmark. Never writes pilot.sqlite."""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import heapq
import json
from pathlib import Path
import re
import time

from collector import AGENT, COLLECTOR_VERSION, Fetcher, PageParser, collect, now, valid_url
from completeness import REQUIRED, readiness, valid_value
from enrichment import pdf_text

ROOT = Path(__file__).resolve().parents[2]
DEFAULT = ROOT / 'data/restaurant-pilot/ai-comparison'
MAX_TEXT = 24000


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + '\n')
    temporary.replace(path)


def read_json(path):
    return json.loads(path.read_text())


def sample(source, output, count=500):
    """Deterministic bottom-hash sample of unique US candidates with permitted URLs."""
    if (output / 'sample.json').exists():
        raise SystemExit('Sample already exists. Reuse it, or select a new output folder.')
    selected, seen, counts, regions = [], set(), Counter(), Counter()
    fingerprint = hashlib.sha256()
    with source.open('rb') as handle:
        for line in handle:
            fingerprint.update(line)
            row = json.loads(line)
            counts['source_rows'] += 1
            if row.get('country') != 'US' or row.get('id') in seen:
                continue
            seen.add(row['id'])
            counts['unique_us_candidates'] += 1
            if not row.get('website'):
                counts['no_website'] += 1
                continue
            try:
                valid_url(row['website'])
            except ValueError:
                counts['unsupported_or_directory_url'] += 1
                continue
            counts['eligible'] += 1
            score = int(digest('restaurant-ai-comparison-v1:' + row['id']), 16)
            item = (-score, row['id'], row)
            if len(selected) < count:
                heapq.heappush(selected, item)
            elif score < -selected[0][0]:
                heapq.heapreplace(selected, item)
    if len(selected) != count:
        raise SystemExit(f'Only {len(selected)} eligible rows; requested {count}.')
    rows = [item[2] for item in sorted(selected, reverse=True)]
    for row in rows:
        regions[row.get('region', '')] += 1
    manifest = {'created_at': now(), 'source': str(source.resolve()),
                'source_sha256': fingerprint.hexdigest(), 'sample_size': len(rows),
                'counts': dict(counts), 'sample_regions': dict(sorted(regions.items())),
                'sampling': 'Fixed bottom-SHA256 sample of unique US candidates with a syntactically permitted website.',
                'scope': 'Available source snapshot only; excludes missing/unsupported websites. Not a representative survey of all US restaurants.',
                'source_was_partial_file': source.suffix == '.partial',
                'baseline_collector_version': COLLECTOR_VERSION}
    write_json(output / 'sample.json', rows)
    write_json(output / 'manifest.json', manifest)
    return manifest


class Capture:
    """Share publisher limits while retaining only pages the existing crawler permits."""
    def __init__(self, fetcher):
        self.fetcher = fetcher
        self.documents = {}

    def get(self, url):
        response = self.fetcher.get(url)
        if response.status != 200:
            return response
        if re.search(r'\b(?:noindex|noarchive|none)\b', response.headers.get('x-robots-tag', ''), re.I):
            return response
        content_type = response.headers.get('content-type', '').lower()
        try:
            if 'application/pdf' in content_type or response.body.startswith(b'%PDF-'):
                text = pdf_text(response.body)
            elif 'text/html' in content_type:
                parser = PageParser()
                parser.feed(response.body.decode('utf-8', 'replace'))
                if re.search(r'\b(?:noindex|noarchive|none)\b', parser.robots, re.I):
                    return response
                visible = '\n'.join(' '.join(line.split()) for line in ' '.join(parser.text).splitlines())
                structured = '\n'.join(json.dumps(doc, ensure_ascii=False) for doc in parser.jsonld)
                text = visible + ('\nStructured website data:\n' + structured if structured else '')
            else:
                return response
            if text.strip():
                self.documents[response.url] = {'url': response.url, 'text': text[:100000],
                    'download_sha256': hashlib.sha256(response.body).hexdigest(), 'observed_at': now()}
        except Exception:
            # The baseline still receives the response and reports extraction errors.
            pass
        return response


def prepare_one(seed, fetcher, max_pages):
    capture = Capture(fetcher)
    started = time.monotonic()
    baseline = collect(seed, capture, max_pages)
    allowed = {p.get('url') for p in baseline['pages'] if p.get('status') == 200 and not p.get('skip')}
    documents = [doc for url, doc in capture.documents.items() if url in allowed]
    quota = MAX_TEXT // max(1, len(documents))
    for index, doc in enumerate(documents):
        doc['page_id'] = f'p{index + 1}'
        doc['original_text_characters'] = len(doc['text'])
        doc['text'] = doc['text'][:quota]
        doc['truncated'] = doc['original_text_characters'] > quota
    return {'seed': seed, 'baseline': baseline, 'baseline_readiness': readiness(seed, baseline['observations']),
            'documents': documents, 'seconds': round(time.monotonic() - started, 3), 'prepared_at': now()}


def prepare(output, workers=16, max_pages=5, retry_missing_pdf=False):
    seeds = read_json(output / 'sample.json')
    folder = output / 'corpus'
    folder.mkdir(exist_ok=True)
    fetcher = Fetcher(f'{AGENT}/{COLLECTOR_VERSION} (local extraction comparison)',
                      delay=2, timeout=12, max_requests=len(seeds) * (max_pages * 5 + 5))
    pending = []
    for seed in seeds:
        path = folder / (digest(seed['id']) + '.json')
        dependency_failed = False
        if retry_missing_pdf and path.exists():
            saved = path.read_text()
            dependency_failed = "No module named 'pypdf'" in saved or "cannot import name 'overwrite_configuration'" in saved
        if not path.exists() or dependency_failed:
            pending.append(seed)
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        jobs = {pool.submit(prepare_one, seed, fetcher, max_pages): seed for seed in pending}
        for index, future in enumerate(as_completed(jobs), 1):
            seed = jobs[future]
            try:
                result = future.result()
            except Exception as error:
                result = {'seed': seed, 'documents': [], 'prepared_at': now(),
                    'baseline': {'status': 'fetch_error', 'observations': [], 'pages': [{'error': str(error)[:180]}]},
                    'baseline_readiness': readiness(seed, []), 'preparation_error': str(error)[:180]}
            write_json(folder / (digest(seed['id']) + '.json'), result)
            if index % 20 == 0 or index == len(pending):
                print(json.dumps({'prepared_this_run': index, 'pending_at_start': len(pending),
                                  'requests': fetcher.request_count, 'seconds': round(time.monotonic() - started)}), flush=True)
    return summarize(output)


def corpus(output):
    for seed in read_json(output / 'sample.json'):
        path = output / 'corpus' / (digest(seed['id']) + '.json')
        if path.exists():
            yield read_json(path)


def validate_proposal(row, proposal):
    """Evidence/shape checks only. Passing these checks is NOT an accuracy verdict."""
    documents = {doc['page_id']: doc for doc in row['documents']}
    def grounded(page_id, quote):
        doc = documents.get(page_id)
        return bool(doc and isinstance(quote, str) and len(quote.strip()) >= 4 and
                    ' '.join(quote.split()) in ' '.join(doc['text'].split()))
    supported, rejected, estimates = [], [], []
    if not isinstance(proposal, dict):
        return {'supported_candidates': [], 'estimates': [], 'rejected': ['invalid_response']}
    identity = proposal.get('identity_evidence', [])
    identity_ok = (proposal.get('branch_status') == 'matched' and isinstance(identity, list) and bool(identity)
                   and all(isinstance(item, dict) and grounded(item.get('page_id'), item.get('quote')) for item in identity))
    facts = proposal.get('facts', [])
    if not isinstance(facts, list):
        facts = []
        rejected.append('invalid_facts')
    for fact in facts:
        if not isinstance(fact, dict):
            rejected.append('invalid_fact')
            continue
        field, value = fact.get('field'), fact.get('value')
        reason = None
        if not identity_ok:
            reason = 'unverified_branch'
        elif not grounded(fact.get('page_id'), fact.get('quote')):
            reason = 'quote_not_in_source'
        elif field not in REQUIRED and field != 'menu_price_estimate':
            reason = 'unsupported_field'
        elif fact.get('basis') == 'estimated' or field == 'menu_price_estimate':
            estimates.append(fact)
            continue
        elif fact.get('basis') != 'published' or not valid_value(field, value):
            reason = 'invalid_or_unpublished_value'
        if reason:
            rejected.append({'fact': fact, 'reason': reason})
        else:
            doc = documents[fact['page_id']]
            supported.append({'field': field, 'value': value, 'source_url': doc['url'],
                'quote': fact['quote'], 'observed_at': doc['observed_at'], 'branch_status': 'matched',
                'method': 'ai_candidate_unreviewed', 'review_required': True})
    return {'supported_candidates': supported, 'estimates': estimates, 'rejected': rejected}


def summarize(output):
    rows = list(corpus(output))
    counts, fields, errors = Counter(), Counter(), Counter()
    for row in rows:
        counts[row['baseline']['status']] += 1
        counts['prepared'] += 1
        counts['readable_for_ai'] += bool(row['documents'])
        counts['baseline_complete'] += row['baseline_readiness']['complete']
        for field in REQUIRED:
            fields[field] += field in row['baseline_readiness']['values'] and field not in row['baseline_readiness']['conflicting_fields']
        for page in row['baseline']['pages']:
            if page.get('error'):
                errors[page['error']] += 1
    result = {'generated_at': now(), 'sample_size': len(read_json(output / 'sample.json')),
              'counts': dict(counts), 'baseline_usable_fields': dict(fields),
              'top_fetch_errors': errors.most_common(12), 'ai_status': 'not_run',
              'accuracy_status': 'requires independent review of source evidence; quote matching alone does not establish correctness',
              'comparison': 'Existing parser on downloaded pages versus AI on cleaned text from those same pages (24,000-character total AI cap).',
              'production_resources_changed': False}
    write_json(output / 'baseline-summary.json', result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT)
    sub = parser.add_subparsers(dest='command', required=True)
    select = sub.add_parser('select')
    select.add_argument('--source', type=Path, required=True)
    select.add_argument('--count', type=int, default=500)
    fetch = sub.add_parser('prepare')
    fetch.add_argument('--workers', type=int, default=16)
    fetch.add_argument('--max-pages', type=int, default=5)
    fetch.add_argument('--retry-missing-pdf', action='store_true')
    sub.add_parser('report')
    args = parser.parse_args()
    if args.command == 'select':
        result = sample(args.source, args.output, args.count)
    elif args.command == 'prepare':
        result = prepare(args.output, args.workers, args.max_pages, args.retry_missing_pdf)
    else:
        result = summarize(args.output)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
