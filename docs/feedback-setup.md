# Feedback and suggestions

Users open **Settings → Feedback & suggestions** (`/settings/feedback`). The same link appears under Help & about. Signed-in users can send a problem report, feature feedback, an idea, or another comment, select a feature, write 10–5,000 characters, and attach one PNG/JPEG/WebP screenshot up to 5 MB.

The contact checkbox is unchecked by default. The email is stored only when the sender opts in; no email is sent automatically. The submission includes app version, web/iOS, device category, browser family, and `settings` as its entry page. It does not capture the browser URL, query string, or full user agent. The form and inbox are marked private for session replay, and message bodies are not sent as analytics events.

Admins open **Settings → Help & about → Administration → Feedback inbox** (`/admin/feedback`). Search message text, filter by feature/type/status, review 25 messages per page, open private screenshots, and set New, Reviewing, Planned, or Resolved. Repeated themes can be found using the search and feature filters. This first version does not automatically cluster requests or send status notifications.

## Backend

`20260908131556_user_feedback.sql` creates the feedback table, RLS, indexes, a ten-submissions-per-hour account limit, and the private `feedback-screenshots` bucket. It was applied to the connected production project on September 8, 2026. No new environment variables or PostHog products are required.

Users can read only their own submissions; admins can read all and update only the status column. The screenshot path uses the sender and submission IDs, never the original filename. Signed image links expire after five minutes. Retrying a failed submission keeps its payload and ID so a lost response does not create a duplicate. If a screenshot upload succeeded but submission did not, the attachment remains private and can be reused by the retry.

Feedback rows cascade when an account is deleted. The deployed `delete-account` function includes the screenshot bucket in its existing per-user cleanup list (the screenshot path is deliberately flat under the user folder). Version 10 was deployed with owner approval on September 8, 2026. The function verifies the caller inside its handler; this change does not alter authentication or deletion behavior for other data. An unsigned POST was verified to return 401 without deleting an account.

The web frontend deploys from `main` through Vercel. An iPhone build needs the normal build/sync/release process. This release also restores the earlier desktop home layout while preserving the mobile home.

## Verification

Focused tests cover database RLS, restricted admin updates, forged submissions, validation, timestamps, rate limits, private screenshot access, contact consent, upload failure, retry identity, and inbox failure/filter behavior. A live database insert and status update were tested inside a rolled-back transaction; no test messages remain in production. Visual fixtures use sample content only.

The Supabase security advisor reported no feedback-specific finding. Existing project-wide findings include older security-definer functions/views and configuration warnings; these were not changed by this feature. [Supabase linter guidance](https://supabase.com/docs/guides/database/database-linter).
