# US restaurant collector

A local collector that exports **all named US restaurant records with coordinates**,
including partial records, and enriches them with cuisine, regular hours and price.
Only records with all three usable details are marked `fully_completed=true`.
It uses public Overture candidates and restaurant websites, with no paid Google,
AI or other provider APIs. No production database connection is used.

## Include partial restaurants in the main CSV

The export-only `GoodEats-Catalog-Update.zip` preserves the installed crawler,
its settings, source pool and any nationwide source service. It replaces only
`runtime/exports.py`, backs up the database/usage ledger/old outputs, immediately
rebuilds the exports without website requests, then restores the previous pause
state and restarts the existing collector service. It requires no new dependency.
It works with the nationwide collector without installing PDF enrichment.

```sh
cd "$HOME/Desktop"
unzip -o GoodEats-Catalog-Update.zip
bash "$HOME/Desktop/GoodEats-Catalog-Update/Catalog.command"
```

The live path remains `~/Library/Application Support/GoodEatsCollector/data/restaurants.csv`.
All selected/imported records with a name, finite valid coordinates and US country
are included, even if they have 0, 1 or 2 detail fields, no website, or a failed
fetch. Queued records appear immediately as `collection_attempted=false` and
`crawl_status=pending`. The CSV contains the database's imported queue, not yet
unimported records in the separate nationwide source file. It does not claim
that every exported restaurant was successfully scraped or recently verified open.

Added columns include:

- `fully_completed`: true only for three recent, branch-matched, nonconflicting details.
- `details_count`: usable cuisine/hours/price fields, 0–3.
- `has_cuisine`, `has_hours`, `has_price`: individual availability flags.
- `missing_fields`, `conflicting_fields`, `fallback_fields`: JSON arrays; fallback includes both missing and conflicting fields.
- `crawl_status`, `collection_attempted`, `last_checked_at`: distinguish queued/failed/checked records.
- `identity_source`, `source_release`, `source_uri`: provenance for name/location.
- `field_observed_at`, `completeness_checked_at`: freshness needed by an app importer.

Unknown details are blank rather than fabricated. Expiring facts can downgrade a
profile from complete to partial while its identity stays in the catalog. The
complete-only files retain the old filtering behavior. Coordinates remain numeric,
including negative longitudes, and 0 remains a valid detail count. JSON uses real
booleans/numbers; CSV uses `true`/`false` and ordinary numeric values.

The exporter caches normalized rows in SQLite, recalculates changed/expired rows,
and atomically replaces the CSV/JSON snapshots each batch. This still rewrites
snapshot files; export time will grow with a much larger catalog. Actual crawl
limits and detail-enrichment behavior do not change. Increased row count is not
an increase in completed-profile yield.

Local validation on a saved 15,000-record dataset produced 15,000 catalog rows,
41 complete and 14,959 partial/pending, without website requests. First export was
about 1.1 seconds and an unchanged refresh about 0.1 seconds on this development
Mac. Counts and timings on the Mac mini will differ.

### App integration design (not deployed by the CSV updater)

Use a stable internal restaurant ID and import independent identity data plus
field-level evidence. A name/location-only map view can use the local catalog.
When a screen needs details, compute its required fields minus the local usable,
fresh fields; resolve conflicts instead of presenting one as verified. Only then
request a Google fallback for those missing fields. Even a fully completed row may
need other features (photos/reviews or current holiday hours) not covered by these
three flags. A regular published schedule is not a live open-now guarantee.

Match the exact Google restaurant/branch before using a Place ID; initial matching
may itself incur API usage. Request a narrow field mask, but do not assume pricing
is per field: hours and price trigger the Place Details Enterprise tier. The major
saving comes from avoiding entire requests on map views and locally satisfied
screens. Keep Google-origin data separate, with its own attribution/storage rules;
do not silently turn a fallback response into permanently owned CSV evidence.

Official references:
https://developers.google.com/maps/documentation/places/web-service/data-fields
https://developers.google.com/maps/documentation/places/web-service/policies

The updater does not import anything into the production app or activate Google
API calls. Those are separate app integration changes.

## Keep the catalog growing independently

The separate `GoodEats-Catalog-Growth.zip` update removes the low-backlog requirement
for catalog imports. See [GROWTH.md](GROWTH.md) for installation and validation. It
adds up to 5,000 eligible source records per batch, including records without a
website, while preserving detail collection and existing records.

## Background service on this Mac

The installed service is `com.goodeats.restaurant-collector`. It runs as your user
while the Mac is awake and you are logged in, starts again at login, and resumes
its saved queue after interruptions. The updated worker prevents idle system sleep
only during an active crawl. Screen locking and display sleep remain enabled.
Pause, completion, errors, and request-limit waits release the sleep assertion.
Use a power adapter and leave a laptop lid open for unattended collection;
this does not override lid-close sleep, manual sleep, shutdown, or logout.

The selected settings are **20,000 HTTP attempts per UTC day**, eight workers,
a minimum two-second delay per host, and at most five pages per restaurant.
Robots requests and redirects count toward the limit. The counter is committed
before each request, so restarting the service does not reset its allowance.
There are no API fees; electricity and any metered internet usage still apply.

The new **throughput mode** uses up to 250,000 HTTP attempts/day, 32 workers across
different hosts, and 128-candidate batches. It is a request allowance, not a promise
of 30,000 complete restaurants/day. The worker refills free slots immediately,
serializes restaurants sharing a host, retains per-host delays across batches,
accepts size-bounded gzip responses, and stops when a profile becomes complete.
HTTP 429/503 responses trigger host backoff, respecting a longer Retry-After header.
Missing cuisine/hours/price are never invented to meet a count.

The **nationwide upgrade** adds a 500,000-attempt daily allowance, up to 48
different-host workers, and 192-candidate batches. Initial visits use up to three
pages. Promising incomplete profiles get a later two-page continuation from saved
links; earlier pages and their original evidence timestamps are retained. Candidates
missing only one required field get priority. Published AM/PM schedules and explicit
general hours text on a corroborated branch page are supported, including split
service intervals and closed days. Ambiguous AM/PM and service-specific schedules
remain excluded. No price/cuisine/hours facts are fabricated to improve yield.

The nationwide live trial checked 192 candidates in 88.86 seconds using 1,006
requests and added 11 profiles. It included some nearly-complete candidates and
is not a controlled comparison or guaranteed daily rate. Two additional profiles
became usable by normalizing previously saved hours, with no new restaurant calls.

The September 7 live trial checked 128 candidates in 90.79 seconds using 738 HTTP
attempts, adding 12 complete profiles. At that sample's 9.38% completion yield,
250,000 requests/day would support about 43,360 checks and 4,065 new complete
profiles/day. These are single-batch extrapolations, not measured 24-hour results;
the source mix changes. 30,000 complete profiles/day was **not** demonstrated.

Live output directory:

`~/Library/Application Support/GoodEatsCollector/data/`

A convenience link is also available at `data/restaurant-pilot/live/` in this repo.
The original development dataset is separate; use the **live** directory for progress.
The service has its own runtime copy outside Desktop so it does not need background
access to macOS-protected Desktop files. After changing the collector's code, rerun
`install` to update that runtime; existing collected data and settings are preserved.

Run these commands from the repository:

```sh
python3 scripts/restaurant-pilot/background.py status
python3 scripts/restaurant-pilot/background.py pause
python3 scripts/restaurant-pilot/background.py resume
python3 scripts/restaurant-pilot/background.py configure --daily-requests 20000 --workers 8
python3 scripts/restaurant-pilot/background.py throughput
python3 scripts/restaurant-pilot/background.py configure --keep-awake off

# Install/update the user-owned service. No administrator/root account is needed.
python3 scripts/restaurant-pilot/background.py install --source data/restaurant-pilot

# Remove the login/background service; retain collected data.
python3 scripts/restaurant-pilot/background.py uninstall
```

The service prioritizes the initial 15,000 US candidates, then adds further US
restaurants from the saved 413,807-candidate source pool as the queue gets low.
Completed profiles are checked again after 30 days. Incomplete candidates become
eligible for another check after 30 days, with some batches reserved for retries.
The worker waits when it reaches its daily request limit or exhausts available work.
It does not automatically download a new worldwide source release. Source changes
require an explicit checkpoint reset/import; existing progress is never silently reset.

## Move to another Mac

Create a portable ZIP from the **installed live data**:

```sh
python3 scripts/restaurant-pilot/transfer.py export --output /tmp/GoodEats-Mac-Transfer.zip
```

The source keeps running. This is a point-in-time snapshot, not ongoing sync.
For a final cutover, first pause the old collector and wait until `status` reports
the worker phase as `paused`, then create a fresh ZIP with a new filename.

AirDrop/copy the ZIP to the new Mac and unzip it. With Python 3.11+ installed,
open `Install.command` (or run `bash` followed by its dragged-in path in Terminal).
The installer checks file hashes, preserves the SQLite queue and daily allowance,
adjusts the candidate checkpoint's local path, and installs the service **paused**.
It refuses to overwrite an existing collector. Pause the old Mac before opening
`Resume.command` on the new Mac. `Pause.command` and `Status.command` are included.
No Codex or app repository is required. The installation has its own copy of the
runtime/data; keep the ZIP as a backup, and remove the unpacked folder if desired.

## Repair certificate or Python compatibility failures

Python.org's macOS installer has a separate `Install Certificates.command` step.
Without those roots, HTTPS requests can fail with `CERTIFICATE_VERIFY_FAILED`.
The repair utility uses the installed service's Python interpreter, runs that
interpreter version's official certificate installer only when needed, and checks
verified TLS connections to Python's official hosts. It never disables verification.
The updated robots parser also avoids overwriting the `groups` dictionary used by
newer Python standard libraries for crawl delays and request rates.

The small `GoodEats-Collector-Repair.zip` is an in-place update, not a replacement
dataset. Put it on the Mac mini's Desktop, unzip it, and run its `Repair.command`.
It pauses collection, verifies the runtime, stops the old service, backs up its
database/runtime, updates the code, requeues only certificate/parser-affected
restaurants, and resumes. Existing facts, candidate progress and daily usage are
retained. If verification fails, collection remains paused and prints the reason.

The worker now checks TLS trust and robots-parser compatibility before starting a
crawl queue. A failed check pauses it and writes `health.json` instead of silently
turning thousands of candidates into errors. Host-specific errors can still occur;
they remain subject to ordinary site restrictions and retry intervals.

Python's official certificate setup instructions:
https://docs.python.org/3/using/mac.html

## Nationwide cities, suburbs and small towns

Copy `GoodEats-Nationwide-Upgrade.zip` to the Mac mini Desktop, unzip it and run
`bash "$HOME/Desktop/GoodEats-Nationwide-Upgrade/Upgrade.command"`. The updater backs
up the existing database/runtime, applies the faster configuration, and preserves
the live restaurants and request counter. It installs DuckDB only in the collector's
isolated `source-python` environment for downloading the free Overture source.

A separate user LaunchAgent, `com.goodeats.restaurant-source`, downloads the
2026-08-19.0 source with a US country filter and geographic envelopes covering
the contiguous states, Alaska (both sides of the date line), and Hawaii. This
includes cities and suburbs outside the original 42 markets. All restaurant
taxonomy descendants are eligible, including categories missed by the old filter.
The existence-confidence floor is 0.6; each finished profile still needs its own
corroborated, usable website evidence. Source data omissions remain possible.
There is no guarantee of every restaurant or every named municipality.

Existing crawling continues during the download, which can take a substantial
amount of time and disk/bandwidth. `source-status.json` shows its current phase and
retained count; errors appear there and in `source-download.stderr.log`. It runs
independently of Terminal/Codex. It retries at the next login if a download failed.
An already-complete download is reused. The importer does not silently switch to
future Overture releases.

The existing Pause/Resume controls also pause/resume the importer. An interrupted
download restarts its source scan when resumed; already completed downloads are
reused. Collected restaurant records are retained in either case.

On completion, `national-coverage.json` reports actual candidates, candidates with
websites, named localities and per-region counts. The collector checks its checksum,
backs up the old source, swaps at a batch boundary, preserves queue/results and
deduplicates imports. An adoption journal handles interruptions. Locality round-robin
ordering includes one candidate from each available locality per round; alternating
batches favor the national additions so the original cohort need not finish first.

The catalog and complete-only CSV/JSON refresh each batch. Large review/all-candidate exports now
refresh at most once daily, or on an explicit `pilot.py export`, to avoid spending
increasing amounts of crawl time rewriting the entire database.

## Official-page and menu enrichment (version 0.7)

Copy `GoodEats-Enrichment-Update.zip` to the Mac mini Desktop and run:

```sh
cd "$HOME/Desktop"
unzip -o GoodEats-Enrichment-Update.zip
bash "$HOME/Desktop/GoodEats-Enrichment-Update/Enrichment.command"
```

The updater installs pypdf 6.18.0 in the existing isolated source/document Python
(or creates that environment), backs up the live database/runtime, then resumes
collection. It retains the daily allowance, worker settings, existing source pool
and nationwide download service. Previously readable incomplete sites get a
one-time retry; complete restaurants keep their normal refresh schedule.

The crawler now accepts explicitly labelled cuisine, regular hours and published
prices from branch-matched HTML without requiring JSON-LD. Name, street and
locality/postcode must match; pages identifying another structured branch or
multiple street addresses are excluded from this text fallback. Explicit cuisine
self-descriptions are supported; dish names are not used to guess cuisine.

Menus linked in Schema.org `hasMenu`/`menu` or ordinary dinner/lunch/menu links are
followed within the existing page budget. PDF assets may be hosted elsewhere when
linked directly from an official page, but their text must independently match the
restaurant's name/address. All network requests still use the same request counter,
TLS/public-address checks, robots policy and host delays. No unlinked directory or
search-engine scraping is enabled.

Text PDFs are decoded in at most two child processes at a time, with a 15-second
wall timeout, 10-second CPU cap, 2 MB input limit, 12-page limit, decompression
limits and 100,000-character text limit. Full PDFs/text are not persisted. Image-only
PDFs are marked as needing OCR; OCR and JavaScript rendering are not enabled.
The website source and evidence snippets remain attached to every accepted fact.

Published fixed-menu prices explicitly stated per person are preserved as fixed
ranges, with `price_basis` identifying the meaning. A separate `menu-estimates.csv`
updates each batch with review-only minimum/median/maximum prices from at least
three explicitly dollar-priced items under an entrees/main-courses heading.
Estimates are neither dollar-sign ratings nor total-meal costs, and do not satisfy
the finished-list price requirement. Missing/conflicting mandatory fields still
keep `fully_completed=false`; the candidate remains in the main catalog.

Validation: 79 tests including actual PDF decoding, wrong-branch rejection,
separate estimate exports, retry scheduling and updater preservation. A bounded
64-candidate live retry recovered a missing field for four restaurants (one cuisine,
three hours), but produced zero newly complete profiles. This is evidence of some
field recovery, not evidence of a higher completion rate or a 30,000/day capacity.

## What counts as collected

`restaurants.csv` and `restaurants.jsonl` include partial and queued records.
`restaurants-complete.csv` and `restaurants-complete.jsonl` contain only profiles with:

- Usable cuisine, regular hours, and price category/range.
- Branch-matched website evidence for every required field, observed within 90 days.
- No conflicting accepted values for those three fields.
- An explicitly US source record.

Price is a published `$`–`$$$$` category, explicit dollar range, or explicitly priced fixed menu per person. It is not an
invented spend per person or an average guessed from unrelated menu items.
Schedules retain their published form; unlisted opening days are unknown, and
regular hours do not guarantee holiday opening. Missing or invalid fields remain
missing. The number of finished profiles depends on what websites actually publish;
10,000–20,000 complete profiles are not guaranteed by a candidate count.

Hotel fields are included for every finished restaurant:

- `in_hotel`: `true`, `false`, or `unknown`.
- `hotel_name` and `hotel_location`: supplied for a confirmed hotel relationship.
- `hotel_status` and field source URLs: explain the evidence/review state.

Explicit Schema.org hotel containment can establish a hotel relationship. The
collector also recognizes an explicit statement that a restaurant is not in a
hotel. Absence of a hotel mention is **never** treated as false. Incomplete hotel
identity/location or conflicting evidence remains unknown. Unknown hotel status
is allowed in the finished list, as requested, provided the three core fields are complete.

## Files

| File | Contents |
|---|---|
| `restaurants.csv` | Main catalog, including partial/queued records with completeness flags |
| `restaurants-complete.csv` | Only records with all three usable detail fields |
| `restaurants.jsonl` | All catalog profiles with field evidence and provenance |
| `restaurants-complete.jsonl` | Complete-only profiles with evidence |
| `review.csv` | Incomplete candidates, missing/conflicting fields and available values |
| `candidate-results.jsonl` | All candidate records and crawl outcomes |
| `observations.jsonl` | Sourced website observations, including review candidates |
| `summary.json` / `report.md` | Finished count, candidate count and progress |
| `service-status.json` | Current worker activity, daily allowance and last error |
| `service.log` | Rotating diagnostic logs, limited to four 2 MB files |
| `pilot.sqlite` | Durable queue, results, candidate checkpoint and finished-profile index |
| `usage.sqlite` | Daily HTTP allowance, persisted before each attempt |
| `control.json` | Pause, resource limits and refresh settings |
| `throughput.json` | Last batch's requests, checks, new complete profiles, and explicitly labelled daily extrapolations |

Catalog and complete-only CSV/JSON files update atomically after each batch (20 normally, 128 in throughput mode,
192 after the nationwide upgrade). Large review/candidate exports refresh daily; their snapshot timestamp appears
in the summary. CSV files saved to disk update automatically; an already-open
spreadsheet application may need to reload the file to display those changes.

## Extraction and boundaries

The parser handles JSON-LD and HTML microdata, including nested postal addresses,
multiple cuisine values and structured schedules. Explicit cuisine/price labels can
be used when the same page identifies one corroborated branch. Explicit general
hours schedules on a corroborated page are also supported; ambiguous prose remains
in review. Photos, reviews, full page copies, image-only menus and
JavaScript-rendered content are not downloaded or interpreted as facts.

The bot identifies itself, respects robots rules (including wildcards, longest
rules, crawl delays and request rates), and stops on publisher noindex/noarchive
restrictions. It does not bypass logins, CAPTCHAs, denied robots rules or blocked
sites. Cross-domain redirects require review. Google, review directories, social
and delivery platforms are excluded. Every network hop validates public DNS
addresses and pins the connection to them while preserving TLS verification.

The response limit is 2 MB per HTML page, with a 12-second socket timeout by default.
A single process owns the queue; multiple workers share per-host delays. A stopped
batch remains resumable. Existing finished evidence is preserved when an in-progress
attempt stops because of a request limit or pause.

Website facts retain URLs, dates, methods and branch checks. Website terms remain
unreviewed; robots permission is not a reuse license. Finished means the required
data was collected, not that publication rights or every fact's accuracy was verified.
All outputs remain `research_only_not_app_verified`.

## Fresh source setup / manual commands

Python 3.11+ is required. Only source downloads need DuckDB; website collection
and the background worker use the Python standard library.

```sh
python3 -m venv /tmp/goodeats-collector-venv
/tmp/goodeats-collector-venv/bin/python -m pip install -r scripts/restaurant-pilot/requirements.txt
/tmp/goodeats-collector-venv/bin/python scripts/restaurant-pilot/pilot.py seed
python3 scripts/restaurant-pilot/pilot.py select --target 15000
python3 scripts/restaurant-pilot/pilot.py crawl --limit 100 --max-requests 600
python3 scripts/restaurant-pilot/pilot.py export
```

Use `--output /absolute/directory` before a subcommand for a different dataset.
`seed --release YYYY-MM-DD.N` pins the release. Repeat `--market "New York" --market Boston`
for regional downloads. Simple outer bounds let Parquet skip unrelated geographic
row groups. `select --include-cafes` also permits non-guide café/coffee/bakery candidates.
The default fills non-guide slots with restaurant-category records. Existing guide
matches are prioritized, followed by balanced coverage of 42 configured US markets.
Overture confidence describes record existence, not restaurant quality.

The initial pilot source used release `2026-08-19.0` and included 1,175 matches to
existing app guide references. `source-manifest.json` documents a bounded broad
scan plus a completed Northeast scan; this is not an exhaustive US business inventory.
Only two profiles in the original 95-website validation had all three required fields.
Those 15,000 initial base records were candidates, not 15,000 completed profiles.

## Verification

```sh
python3 -m unittest discover -s scripts/restaurant-pilot -p 'test_*.py' -v
```

Tests cover completeness, missing/stale/conflicting values, branch identity,
JSON-LD/microdata, hotel evidence and unknowns, network restrictions, budget
persistence under concurrency, pause, resume, US-only replenishment, deduplication,
CSV safety and incremental finished exports. They make no network requests.

References:

- https://docs.overturemaps.org/guides/places/
- https://docs.overturemaps.org/attribution/
- https://schema.org/Restaurant
- https://schema.org/Hotel
- https://www.rfc-editor.org/rfc/rfc9309.html
- https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html
