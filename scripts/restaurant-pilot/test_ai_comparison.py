import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import ai_comparison as comparison
import ai_comparison_model as model
import ai_comparison_ollama as ollama
from collector import Response, now
from completeness import readiness


def fixture():
    seed = {'id': 'test-1', 'name': 'Sample Bistro', 'country': 'US', 'address': '10 Main St',
            'locality': 'Boston', 'region': 'MA', 'postcode': '02110', 'website': 'https://example.com'}
    text = 'Sample Bistro, 10 Main St, Boston. We serve French cuisine. Price range: $20-$40. Hours: Mo-Fr 11:00-22:00.'
    return {'seed': seed, 'documents': [{'page_id': 'p1', 'url': seed['website'], 'text': text, 'observed_at': now()}],
            'baseline': {'status': 'no_facts', 'observations': [], 'pages': []},
            'baseline_readiness': readiness(seed, [])}


def proposal():
    return {'branch_status': 'matched',
        'identity_evidence': [{'page_id': 'p1', 'quote': 'Sample Bistro, 10 Main St, Boston'}],
        'facts': [{'field': 'cuisines', 'value': 'French', 'page_id': 'p1',
                   'quote': 'We serve French cuisine', 'basis': 'published'}]}


def prepared(folder):
    row = fixture()
    comparison.write_json(folder / 'sample.json', [row['seed']])
    comparison.write_json(folder / 'corpus' / (comparison.digest(row['seed']['id']) + '.json'), row)
    return row


class ComparisonTests(unittest.TestCase):
    def test_fabricated_quote_or_unknown_page_rejected(self):
        for change in ({'quote': 'Italian cuisine'}, {'page_id': 'p2'}):
            value = proposal()
            value['facts'][0].update(change)
            checked = comparison.validate_proposal(fixture(), value)
            self.assertFalse(checked['supported_candidates'])
            self.assertEqual(checked['rejected'][0]['reason'], 'quote_not_in_source')

    def test_source_backed_value_still_requires_accuracy_review(self):
        checked = comparison.validate_proposal(fixture(), proposal())
        self.assertEqual(len(checked['supported_candidates']), 1)
        self.assertTrue(checked['supported_candidates'][0]['review_required'])

    def test_uncertain_identity_and_unsourced_identity_rejected(self):
        for value in [dict(proposal(), branch_status='uncertain'), dict(proposal(), identity_evidence=[]),
                      dict(proposal(), identity_evidence=[{'page_id': 'p1', 'quote': 'Another branch'}])]:
            checked = comparison.validate_proposal(fixture(), value)
            self.assertFalse(checked['supported_candidates'])

    def test_estimate_never_counts_as_published_price(self):
        value = proposal()
        value['facts'][0].update(field='price_range', value='$$', basis='estimated')
        checked = comparison.validate_proposal(fixture(), value)
        self.assertFalse(checked['supported_candidates'])
        self.assertEqual(len(checked['estimates']), 1)

    def test_invalid_hours_are_rejected(self):
        value = proposal()
        value['facts'][0].update(field='hours', value='open late')
        checked = comparison.validate_proposal(fixture(), value)
        self.assertFalse(checked['supported_candidates'])

    def test_publisher_restrictions_prevent_corpus_storage(self):
        class Fake:
            def get(self, url):
                return Response(url, 200, {'content-type': 'text/html'},
                                b'<meta name="robots" content="noarchive"><p>Private content</p>')
        capture = comparison.Capture(Fake())
        capture.get('https://example.com')
        self.assertEqual(capture.documents, {})

    def test_sample_is_order_independent_and_excludes_non_us_and_missing_sites(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            rows = [dict(fixture()['seed'], id=str(i)) for i in range(12)]
            rows.extend([dict(rows[0], id='canada', country='CA'), dict(rows[0], id='missing', website=None)])
            source = folder / 'source.jsonl'
            source.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            first = comparison.sample(source, folder / 'a', 5)
            source.write_text(''.join(json.dumps(row) + '\n' for row in reversed(rows)))
            comparison.sample(source, folder / 'b', 5)
            self.assertEqual(comparison.read_json(folder / 'a/sample.json'), comparison.read_json(folder / 'b/sample.json'))
            self.assertEqual(first['counts']['eligible'], 12)
            self.assertEqual(first['counts']['no_website'], 1)

    def test_build_has_no_network_and_budget_prevents_submission(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            prepared(folder)
            with patch.object(model, 'api') as api:
                plan = model.build(folder)
                api.assert_not_called()
            self.assertEqual(plan['model_requests'], 1)
            self.assertGreater(plan['conservative_reserved_usd'], 0)
            with self.assertRaises(SystemExit):
                model.build(folder, budget=0)
            body = json.loads((folder / 'batch-input.jsonl').read_text())['body']
            self.assertEqual(body['max_completion_tokens'], model.MAX_OUTPUT)
            self.assertTrue(body['response_format']['json_schema']['strict'])

    def test_build_refuses_incomplete_cohort(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            comparison.write_json(folder / 'sample.json', [fixture()['seed']])
            with self.assertRaises(SystemExit):
                model.build(folder)

    def test_no_resubmission_after_ambiguous_network_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            prepared(folder)
            with patch.object(model, 'api_key', return_value='test-secret'), patch.object(model, 'api', side_effect=TimeoutError):
                with self.assertRaises(TimeoutError):
                    model.submit(folder)
                with self.assertRaises(SystemExit):
                    model.submit(folder)
            state = comparison.read_json(folder / 'batch-state.json')
            self.assertEqual(state['phase'], 'submission_uncertain')
            self.assertNotIn('test-secret', json.dumps(state))

    def test_unordered_response_reporting_and_truncation_handling(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            row = prepared(folder)
            response = {'custom_id': comparison.digest(row['seed']['id']), 'response': {'status_code': 200, 'body': {
                'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(proposal())}}],
                'usage': {'prompt_tokens': 100, 'completion_tokens': 50}}}}
            (folder / 'output_file.jsonl').write_text(json.dumps(response) + '\n')
            report = model.report(folder)
            self.assertEqual(report['candidate_field_gains'], {'cuisines': 1})
            self.assertFalse(report['data_written_to_collector'])
            self.assertEqual(report['counts']['new_candidate_complete'], 0)
            self.assertAlmostEqual(report['estimated_model_cost_usd_at_uncached_batch_rates'], 0.000015)
            response['response']['body']['choices'][0]['finish_reason'] = 'length'
            (folder / 'output_file.jsonl').write_text(json.dumps(response) + '\n')
            self.assertEqual(model.report(folder)['counts']['failed_or_invalid_responses'], 1)

    def test_local_comparison_reuses_exact_prompt_and_resumes(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            row = prepared(folder)
            response = {'done_reason': 'stop', 'message': {'content': json.dumps(proposal())}}
            with patch.object(ollama, 'local_api', side_effect=[{'models': [{'name': ollama.MODEL}]}, response]) as local, patch.object(model, 'api') as paid:
                result = ollama.run(folder, 1)
                self.assertEqual(local.call_args.args[1]['messages'], model.request_body(row)['messages'])
                self.assertFalse(local.call_args.args[1]['think'])
                self.assertEqual(result['model_api_fees_usd'], 0)
                paid.assert_not_called()
            with patch.object(ollama, 'local_api', return_value={'models': [{'name': ollama.MODEL}]}) as local:
                self.assertEqual(ollama.run(folder, 1)['completed_this_run'], 0)
                self.assertEqual(local.call_count, 1)

    def test_local_comparison_does_not_auto_download_missing_model(self):
        with tempfile.TemporaryDirectory() as temporary, patch.object(ollama, 'local_api', return_value={'models': []}) as local:
            with self.assertRaises(SystemExit):
                ollama.run(Path(temporary), 1)
            self.assertEqual(local.call_count, 1)


if __name__ == '__main__':
    unittest.main()
