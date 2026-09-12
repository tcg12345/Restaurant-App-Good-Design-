# Third implementation batch — September 10, 2026

This batch prepares photo privacy enforcement across web and iOS. It installs explicit audience rules on the server and implements compatible photo readers locally. **The photos and avatars buckets still allow public downloads. S4 remains open until the compatible clients are released and public downloads are disabled.**

## Application changes implemented locally

- Added a shared photo reader and native image/background components across the app, including galleries, guides, recipes, restaurant sheets, profiles, feeds and animated images. The conversion covered 149 JSX image/background elements in 86 files, plus the activity draft background and imperative profile map popups.
- Own-project photo and avatar references resolve to authorized signed URLs. External images remain unchanged. Signing batches up to 100 references, deduplicates concurrent requests and uses a bounded memory cache. Tokens last 15 minutes and refresh before expiry; failed authorization never falls back to a public URL.
- Account changes invalidate image, signed-URL and blob caches. Late requests from the previous account cannot repopulate those caches. Mounted images discard stale account/source results, and reconnect can retry failed signing.
- Export, image editing, compression and dish-photo reads use the same authorization path. Upload references remain stable identifiers instead of persisting expiring tokens. New photo uploads use a 15-minute cache lifetime.
- Existing image layout, refs, callbacks and motion components are preserved. Ranking behavior is unchanged.

These readers are in the working tree, production build output and synced Capacitor project. They have **not been deployed to the website or installed on the physical iPhone in this batch**.

## Live server changes

Applied `20260910134232_audit_photo_access_preparation.sql`:

- Photo signing/listing follows ownership or an explicit authorized reference in avatars, community photos/ratings, public home meals, recipes, guides, recipe reviews or verified expert recommendations. Existing row-level audience rules still apply. A readable parent recipe is required for a review photo.
- Referenced objects must belong to the publishing user; copying another person's private photo path into a public record does not grant access.
- Legacy visit photos in the avatars bucket follow the same audience rules. Ordinary profile avatars remain intentionally readable.
- Helpers use SECURITY INVOKER in a non-exposed schema with explicit grants. Owner photo updates check both the original and updated path.
- Photos accept image MIME types only, with a 10 MiB upload limit.

The live inventory contains 640 photos and 140 legacy visit objects in avatars. Existing paths are compatible with the new reader; moving files or rewriting stored references is unnecessary. **Bucket public flags remain true for installed-client compatibility; public download URLs still bypass these signing rules.**

## Validation

- **1,505 tests passed across 160 files**, including 29 new reader, account-isolation, component and SQL policy regressions. SQL tests execute the migration in PGlite and reuse the existing authorized home-meal projection. See `batch3-tests.log`.
- TypeScript and production web build passed: `batch3-build.log`.
- Capacitor iOS sync passed: `batch3-ios-sync.log`.
- Native iOS Simulator build passed: `batch3-ios-build.log`. This establishes compilation, not physical-device runtime coverage.
- Live anonymous checks signed three explicitly public photo references and successfully downloaded one byte from each (HTTP 206). No private photo content or real-user sessions were used.
- Mobile browser at 390 × 844: all 34 guide photo/avatar image sources were signed and loaded, with no broken images or public storage image URLs. The Jungsik gallery opened and advanced from photo 1 to photo 2 of 30. The checked flow produced no console warnings or errors.
- Post-change advisor counts are unchanged; see `batch3-advisors.json` for counts and remediation links. These are inventory notices, not a count of confirmed vulnerabilities. [Supabase database advisor guidance](https://supabase.com/docs/guides/database/database-linter).

## Coordinated release still required

1. Deploy the compatible website and install/release the compatible iOS client. Confirm supported older clients have a migration/update path before the bucket change.
2. Verify public and owner photos, legacy visit photos, avatars, uploads, editing, sharing, account switching and reconnect on the released clients, including the physical iPhone.
3. Disable public downloads on both `photos` and `avatars`. The adjacent `photo-privacy-cutover.sql` is a **not-applied checklist/template**, deliberately outside migrations so a normal migration push cannot trigger an early cutover. Recheck actual policies and client readiness before running it.
4. Confirm anonymous private paths cannot be signed or downloaded; intentionally public references and authorized owner/follower references should still resolve. Check legacy visit objects and ordinary avatars separately.

Signed links remain usable until expiry. This reader uses 15-minute tokens; existing post/reel signing lifetimes are unchanged. Previously cached public bytes cannot be recalled. Existing decoded/cached photos may remain visible offline, but new authorization and expired links require connectivity; real-device offline/reconnect coverage remains pending.

The existing large main bundle warning, native metadata persistence, wider animation measurements, analytics request behavior and remaining security advisor findings are separate audit work. This batch does not establish that every app flow is flawless.
