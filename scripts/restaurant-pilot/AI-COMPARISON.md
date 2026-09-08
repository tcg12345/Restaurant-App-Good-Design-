# Restaurant AI extraction comparison

This is an isolated experiment. It does not modify the app, the collector database,
its CSV exports, its background services, or production resources.

The fixed sample contains 500 unique US restaurant candidates with a permitted website
in the source snapshot available on this computer. Sampling uses a reproducible hash,
not extraction success. Missing websites are excluded and counted in the manifest.
The current local source is a partial download covering a subset of states, so results
must not be presented as a nationally representative completion estimate.

Each restaurant is visited using the existing collector's robots, redirect, TLS,
publisher restriction and rate-limit rules. The rules-based parser and AI use the
same fetched pages. AI receives cleaned text and JSON-LD with a total 24,000-character
cap; it does not receive images, execute JavaScript, search the web or access outside
knowledge. This comparison measures extraction, not an autonomous browsing agent.
The baseline is the local collector version recorded in `manifest.json`; it may
differ from the version installed on the other Mac.

`ai_comparison.py` selects the sample, prepares a resumable corpus and reports the
baseline. `ai_comparison_model.py` builds, submits and retrieves one OpenAI Batch job
using GPT-4.1 nano. Model responses are associated by restaurant ID, not response order.
The API key is read from `OPENAI_API_KEY` or the owner-only `openai-api-key` file created
by `setup_comparison_key.py` in the ignored output directory. Never copy that key into
a transfer ZIP, commit, report, or chat.

From the repository root:

```bash
python3 scripts/restaurant-pilot/ai_comparison.py select --source PATH_TO_SOURCE_JSONL
python3 scripts/restaurant-pilot/ai_comparison.py prepare
python3 scripts/restaurant-pilot/ai_comparison_model.py build
python3 scripts/restaurant-pilot/ai_comparison_model.py submit
python3 scripts/restaurant-pilot/ai_comparison_model.py status
```

The `prepare` command needs a Python runtime with `pypdf` to include text PDF menus.
`--retry-missing-pdf` refreshes only incomplete records affected by that missing module.
Use the same `--output` directory for the corpus and model commands. Each command
defaults to `data/restaurant-pilot/ai-comparison`.

Submission uses a conservative maximum token reservation and a $5 default cap. It
never retries an ambiguous submission automatically. If submission is uncertain,
inspect the OpenAI Batch dashboard and reconcile the stored input file before retrying.
Batch processing may take up to 24 hours. Cost reports use returned token usage and
published uncached Batch rates; the provider's invoice is authoritative.

Read `baseline-summary.json` and, after completion, `comparison-summary.json`.
`proposals/` contains candidate facts, source quotes, rejected facts and separate
menu-price estimates. None of these are published into the collector.

## Accuracy audit and adoption decision

Literal quote checks and JSON validation do not establish factual correctness.
Review the fixed random sample in `audit-sample.json` against its source corpus,
including wrong-branch information, misread hours, wrong price scope, unsupported
cuisine and missed available facts. Separately inspect all proposed newly complete
profiles. Record verdicts and notes in a separate audit artifact; do not treat the
model's branch judgment as independent validation.

Report both the full 500-record denominator and the readable-document denominator,
per-field gains, candidate completion, audited correctness, failures and model cost.
Keep estimated menu prices separate from published restaurant price ranges.
Do not claim all candidates are verified based on a sample audit, or extrapolate
30,000 completed restaurants/day from a short extraction run.

If the audit shows a worthwhile gain, test a local Ollama model on this SAME frozen
corpus and compare accuracy and wall-clock throughput on the target Mac mini.
Cloud-model success does not establish local-model quality or hardware throughput.
No Ollama install, model download or background-service change is performed by this
experiment.

Official API references:
- https://developers.openai.com/api/docs/guides/batch
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/models/gpt-4.1-nano
