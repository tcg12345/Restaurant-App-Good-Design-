"""Optional local-only model comparison on the frozen website corpus. No installation."""
import argparse
import json
from pathlib import Path
import time
import urllib.request

from ai_comparison import DEFAULT, corpus, digest, read_json, validate_proposal, write_json
from ai_comparison_model import MAX_OUTPUT, NoRedirect, SCHEMA, request_body
from collector import now
from pilot import exclusive

MODEL = 'qwen3:4b'


def local_api(path, body=None):
    if path not in ('/api/tags', '/api/chat'):
        raise ValueError('Unsupported local endpoint')
    request = urllib.request.Request('http://127.0.0.1:11434' + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Content-Type': 'application/json'})
    # Never forward localhost requests or restaurant pages through an HTTP proxy.
    with urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect).open(request, timeout=240) as response:
        return json.load(response)


def run(output, limit=50):
    folder = output / 'ollama-qwen3-4b'
    models = local_api('/api/tags').get('models', [])
    if not any(item.get('name') == MODEL for item in models):
        raise SystemExit('Install and start local Ollama, then pull qwen3:4b. This benchmark does not download models.')
    with exclusive(folder / 'run'):
        documents = list(corpus(output))
        selected = [row for row in documents if row['documents']][:limit]
        started = time.monotonic()
        checked = 0
        for row in selected:
            path = folder / (digest(row['seed']['id']) + '.json')
            fingerprint = digest(json.dumps(row['documents'], sort_keys=True))
            if path.exists():
                if read_json(path)['corpus_sha256'] != fingerprint:
                    raise SystemExit('The frozen corpus changed. Use a new comparison directory.')
                continue
            body = {'model': MODEL, 'messages': request_body(row)['messages'], 'format': SCHEMA,
                    'stream': False, 'think': False, 'keep_alive': '5m',
                    'options': {'temperature': 0, 'num_ctx': 16384, 'num_predict': MAX_OUTPUT}}
            began = time.monotonic()
            response = local_api('/api/chat', body)
            saved = {'model': MODEL, 'restaurant_id': row['seed']['id'], 'name': row['seed']['name'],
                     'corpus_sha256': fingerprint, 'checked_at': now(), 'seconds': time.monotonic() - began,
                     'prompt_eval_count': response.get('prompt_eval_count'), 'eval_count': response.get('eval_count'),
                     'done_reason': response.get('done_reason'), 'api_fee_usd': 0,
                     'raw_response': response.get('message', {}).get('content'), 'accuracy_review': 'pending'}
            try:
                if response.get('done_reason') != 'stop':
                    raise ValueError('Incomplete model output')
                proposal = json.loads(saved['raw_response'])
                saved['proposal'] = proposal
                saved['validation'] = validate_proposal(row, proposal)
            except (TypeError, ValueError):
                saved['error'] = 'Invalid or incomplete JSON output'
            write_json(path, saved)
            checked += 1
            print(json.dumps({'completed_this_run': checked, 'model': MODEL, 'seconds': round(time.monotonic() - started)}), flush=True)
        return {'model': MODEL, 'selected_readable_restaurants': len(selected), 'completed_this_run': checked,
                'seconds_this_run': round(time.monotonic() - started, 3), 'model_api_fees_usd': 0,
                'accuracy_status': 'Independent source review required; cloud-model results do not validate this local model.',
                'collector_changed': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=DEFAULT)
    parser.add_argument('--limit', type=int, default=50)
    args = parser.parse_args()
    if not 1 <= args.limit <= 500:
        parser.error('--limit must be between 1 and 500')
    print(json.dumps(run(args.output, args.limit), indent=2))
