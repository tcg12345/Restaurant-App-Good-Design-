# GoodEats catalog update

This update changes only the CSV/JSON exporter on your Mac mini. It keeps the
installed crawler version, daily request allowance, worker settings, collected
data, candidate queue and nationwide source service. It does not install the PDF
enrichment update or any new Python dependencies.

Copy `GoodEats-Catalog-Update.zip` to your Mac mini's Desktop, then run:

```bash
cd "$HOME/Desktop"
unzip -o GoodEats-Catalog-Update.zip
bash "$HOME/Desktop/GoodEats-Catalog-Update/Catalog.command"
```

Press Return at the end. You can close Terminal afterward. The updater backs up
the existing database, usage ledger, export module and main outputs. It creates
the new catalog immediately without website requests, then restores your prior
pause state. If collection was running, it resumes; if it was paused, it stays paused.
Keep using your existing Pause.command and Resume.command.

## Live files

Open the main list:

```bash
open "$HOME/Library/Application Support/GoodEatsCollector/data/restaurants.csv"
```

This now includes **all selected/imported, named US records with valid coordinates**,
including records with zero, one, two or three usable detail fields. Records without
a website or with fetch errors stay in the list. Names/locations come from the
candidate source and are not necessarily verified by a website crawl.

The CSV includes the queue already imported into the database; it does not import
all remaining records from the separate source file. Normal source replenishment
and collection continue. Queued rows can appear before their first website visit.

| Column | Meaning |
| --- | --- |
| `fully_completed` | `true` only when usable cuisine, regular hours and price are all present |
| `details_count` | Number of those usable fields: 0, 1, 2 or 3 |
| `has_cuisine`, `has_hours`, `has_price` | Individual availability flags |
| `missing_fields` | Required fields without usable recent evidence |
| `conflicting_fields` | Required fields with unresolved conflicting evidence |
| `fallback_fields` | Missing or conflicting fields to resolve when needed |
| `crawl_status` | Current queue/crawl outcome |
| `collection_attempted` | Distinguishes records with recorded crawl attempts from unattempted ones |
| `last_checked_at` | Last recorded page/refresh check timestamp, when available |
| `identity_source`, `source_release`, `source_uri` | Origin of the name/location data |
| `field_observed_at`, `completeness_checked_at` | Field freshness and completeness assessment timestamps |

Unknown details stay blank. Conflicting or expired details are not marked present.
JSON arrays are used for lists of fields and sources; CSV booleans are `true`/`false`.
Coordinates are numeric, including negative longitudes. Unknown hotel status stays
`unknown`; it does not affect the three-detail completeness flag.

`restaurants-complete.csv` and `restaurants-complete.jsonl` retain the old
complete-only view. `restaurants.jsonl` now includes the full catalog with actual
JSON booleans, numeric counts and field evidence. `summary.json` reports catalog,
complete, partial and attempted counts separately. Some older service-status.json
versions only report complete/candidate counts; use summary.json for the split.

Files update after normal collection batches. An already-open spreadsheet viewer
may need to reload. Facts may expire and turn a complete profile into a partial one,
while its name/location remains in the catalog. Flags are assessed at the recorded
export time, not a guarantee of live holiday hours or currently open businesses.

## What improves

Previously, missing a single required detail excluded a restaurant from the main
CSV. Now the existing name/location and any verified details are usable immediately.
This increases catalog coverage, not website-fetch speed or completion yield.

Local validation on saved data produced 15,000 catalog rows, including 41 complete
and 14,959 partial/pending, without any additional website requests. Most of those
records had not yet been crawled. First export took about 1.1 seconds and an unchanged
refresh about 0.1 seconds on the development Mac; your counts and timings will differ.
The exporter caches row calculations, but still rewrites the output snapshots, so a
much larger catalog will take longer. 85 tests pass, and the update was also checked
against the actual version 0.6 nationwide package without modifying its crawler.

## App fallback design

The catalog update alone does not import records into the app or change production.
For a name/location-only map view, the app can use independent catalog data. For a
screen requiring details, check the specific required fields and their freshness,
then request external data only for missing or conflicting details. Avoid using the
single fully_completed flag to trigger calls for screens that need fewer fields.

Match the exact restaurant branch before associating a Google Place ID; initial
matching can incur API usage. Request narrow field masks, but hours/price remain
Enterprise-tier Place Details fields. The saving comes primarily from avoiding
entire calls, not a promise of proportionate per-field discounts. Regular schedules
also do not substitute for live/holiday hours, photos or reviews.

Keep independently collected and Google-provided facts distinguishable and apply
Google's attribution/storage rules to fallback data. Do not automatically treat
Google responses as permanent independently sourced CSV evidence.

Official references:
- https://developers.google.com/maps/documentation/places/web-service/data-fields
- https://developers.google.com/maps/documentation/places/web-service/policies
