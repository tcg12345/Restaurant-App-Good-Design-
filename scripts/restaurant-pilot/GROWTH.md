# GoodEats catalog growth update

The old importer waited for the website-scraping queue to get low. Because the
main CSV already included that queue, its row count could stay at 20,000 for a
long time while details changed. 20,001 spreadsheet rows means 20,000 restaurants
plus the header. The export-only update did not change this queue rule.

This update imports up to 5,000 additional eligible identities per collector batch,
regardless of the number of restaurants waiting to be scraped. It reads the already
downloaded source file; importing identities makes no website/Places requests.
It includes records without websites and deduplicates by source ID and branch
identity. At most 25,000 source lines are scanned per pass, so additions may be less
than 5,000 when many entries are duplicates or ineligible. It continues until the
local source is exhausted. A separate checkpoint handles resume and source changes.

Copy GoodEats-Catalog-Growth.zip to the Mac mini Desktop, then run:

```bash
cd "$HOME/Desktop"
unzip -o GoodEats-Catalog-Growth.zip
bash "$HOME/Desktop/GoodEats-Catalog-Growth/Growth.command"
```

The installed nationwide collector is required. This updates the worker, catalog
import helper and exporter. It preserves the installed website parser, request
allowance, worker/page limits, source service, existing records and completed
profiles. It does not install PDF enrichment or change the app.

The updater backs up the database, usage ledger, replaced runtime modules and
existing main exports. If the collector was running, it imports an initial batch,
refreshes the files, and resumes. If it was paused, it stays paused; imports start
when you use your existing Resume.command. A failed update leaves it paused with
an error message so progress can be recovered safely.

Open the catalog:

```bash
open "$HOME/Library/Application Support/GoodEatsCollector/data/restaurants.csv"
```

The complete-only file remains:

```bash
open "$HOME/Library/Application Support/GoodEatsCollector/data/restaurants-complete.csv"
```

Close/reopen an already-open spreadsheet to see the new snapshot. You can also run:

```bash
cat "$HOME/Library/Application Support/GoodEatsCollector/data/summary.json"
```

Look at catalog_restaurants and catalog_import (added, scanned, source_exhausted).
service-status.json reports catalog_added for the last collection batch. At the
daily HTTP limit, local imports continue once per minute; Pause stops both imports
and website collection. Import and export speeds depend on batch durations, source
mix and disk size. Larger CSV/JSON snapshots take longer to write.

New identities initially have fully_completed=false and collection_attempted=false.
The website queue still attempts cuisine/hours/price enrichment later. This is faster
catalog population, not a claim of faster detail extraction or newly verified open
businesses. The final row count can be below the source's 814,307 candidates because
of deduplication and eligibility checks.

Validation: 89 tests passed, including backlog-independent imports, website-less
records, duplicate handling, resumable scans, source replacement, pause, and HTTP
budget exhaustion. Compatibility testing against the original version 0.6 package
added 5,000 identities while preserving 15,000 existing records and all 41 complete
profiles in that local test dataset. Your Mac mini's existing counts are preserved;
no local test database is included in this package.
