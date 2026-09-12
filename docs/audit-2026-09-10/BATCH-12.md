# Batch 12 — physical install and photo privacy enforcement

September 11, 2026. Continues the photo access preparation from Batch 3.

## Physical iPhone

- First install attempt was blocked by iOS DeviceLocked. User unlocked the selected iPhone 16 Pro; the retry installed the verified Batch 11 signed build successfully without uninstalling or clearing app data.
- Launched the actual app with a bounded 45-second console capture, then launched normally afterward. WebView loaded; 17 native Filesystem call markers, zero JavaScript error markers, zero ranking-evidence warning markers, no recurrence of the earlier restaurant metadata cache save failure. This is a startup observation, not exhaustive persistence certification.
- Replaced raw console output with aggregate diagnostics in photo-cutover-device-launch.log to avoid retaining personal/session values.
- Native Computer Use reported permissions not granted. No phone UI automation or private device-data extraction was attempted as a workaround.
- User independently confirmed community photo galleries, own saved photos, profile avatar and close/reopen all worked before cutover. A separate request to verify fresh community/own photos after cutover is pending.

## Applied storage change

Migration **20260911112640_audit_photo_privacy_cutover.sql** applied successfully. Local filename matches live migration history; the CLI-created initial timestamp was renamed to the live application timestamp.

Set public=false on both **photos** and **avatars**. Existing audience/ownership policies, objects and stored canonical URLs are unchanged. The deployed photo reader resolves canonical identifiers to authorized signed URLs. Ordinary profile avatars remain intentionally shareable through the existing policy; legacy restaurant photos follow ownership/explicit sharing. No blanket signed-in read policy was added.

## Verification

- Current Supabase changelog and Storage Buckets docs reviewed. No relevant new breaking change found.
- Re-audited live storage policies and private helper configuration after the database upgrade. Helpers remain SECURITY INVOKER with empty search_path.
- Focused photo policy/reader/rendered-image suite: **27 tests / 3 files passed**. Fictional policy fixtures cover owner, stranger, accepted follower, private profile, public references, recipe/review visibility and copied private paths.
- Before cutover, five public photo samples signed/downloaded successfully in 372–614 ms each (HTTP 206).
- After cutover, seven publicly shared photo/avatar references signed/downloaded successfully (HTTP 206) while each direct public URL returned HTTP 400. Per-sample signing + one-byte download + denial check took 490–742 ms. All these references used photos bucket; public profile avatars in this sample are stored there.
- An existing private legacy restaurant-photo object in avatars was denied anonymous signing (400) and direct public HEAD access (400). No private image bytes downloaded. The metadata-only probe is local and must not be committed publicly.
- Fresh hosted website rendered community content. All 16 observed Supabase image sources were signed; 13 loaded, zero broken, others pending/lazy. No warning/error console logs returned.
- Live flags confirmed false for both buckets. Security advisors show no new categories: existing 14 RLS/no-policy, one public extension, 84 anon and 95 authenticated definer-function findings remain separately scoped.
- One broad anonymous storage inventory request returned an MCP HTTP 504; a later activity check found no matching query running. Smaller direct API samples succeeded. No unsupported conclusion about database performance was made from the tool timeout.
- The unrelated existing AppDelegate.swift whitespace edit was left untouched. Migration-only change needs no new native/web bundle; no full app rebuild performed.
- Local commit **148ae9b** records only the applied migration. Pushing main was rejected by automatic approval review on the ground that remote publication needs explicit authorization. User approval requested; no remote push occurred at this point. Live Supabase change already succeeded independently.
- Follow-up: the user explicitly authorized the push, and `148ae9b` was successfully pushed to main during Batch 13.

## Limits and next steps

Signed links already issued remain usable until expiry. Previously downloaded/cached public image bytes cannot be recalled. This closes public bucket bypass, not every security finding.

Await the user's final post-cutover iPhone photo check. Broader signed-in CRUD/uploads/edits/sharing/account switching, offline/reconnect, purchases/restore, accessibility and long-session native performance remain outstanding. Browser and anonymous API checks do not establish these workflows.
