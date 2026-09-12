# GoodEats 1.3 (3): App Review safety fixes

Status: the owner approved deployment on September 12, 2026. The safety migration and all ten matching Edge Functions are live, live safety checks passed, and the support pages are published. Final app website verification is in progress. App Store Connect has not been accessed or changed.

## What changes

- AI asks for explicit, versioned permission before sending account context or selected content to Anthropic/OpenAI. Declining stops the request; permission can be withdrawn in Privacy & permissions. Personal permission no longer automatically includes friends' names or biographies. Group preference matching stays within the existing local scorer.
- Report/block menus are available on profiles, feed content, reviews, photos, recipes, guides, comments, reels, posts and messages. Reports preserve a server-generated snapshot and are visible only to the reporter and moderators.
- Blocking is enforced on the server for content visibility, follows, conversations, messages, shared lists, group participation and push delivery. Unblocking is available in Privacy & permissions.
- New shared content and edits enter a **manual review queue**. Personal saves remain accessible to their owner. Existing publications retain their visibility and can still be reported, removed or suspended. Moderators use Settings → Help & about → Community moderation; authors can see publication status under Privacy & permissions.
- Media access follows moderation and blocking rules. New videos use signed playback. Previously approved uploaded files cannot be overwritten at the same path.
- The published support site uses GoodEats branding, updates AI/contact/analytics/video/push disclosures, fixes the contact link, and adds the missing terms/community-rules page. The existing support email is preserved.

Subscriptions remain disabled and the app remains free.

## Verification

- Final merged-main release: **1,746 tests passed in 200 files**, including the now-merged landing-page work. The earlier isolated safety snapshot also passed all 1,719 tests.
- Production TypeScript/security-policy checks and Vite build passed.
- PostgreSQL tests cover owner versus stranger visibility, stale moderation revisions, denied self-approval, private report snapshots, reports against invisible private posts, blocking in both directions, direct message/follow restrictions, public JSON projections and restricted administrative/operational functions.
- AI tests cover refusal, acceptance, account changes, permission persistence, revocation and server attestation. Video tests cover viewer-scoped authorization, withheld media, missing signing configuration and forged asset ownership.
- Browser: test-account sign-in worked; disclosure appeared before dispatch; refusal stopped the request; retry requested permission again; report/block dialogs rendered correctly; keyboard focus stayed inside the corrected report form. No report or block was submitted against a real account. The temporary consent-test chat was deleted.
- Live browser: refusal stopped AI dispatch; retry requested consent again; allowing sharing returned a real AI response. The temporary chat was deleted and permission was revoked afterward. All five AI endpoint preflights accept the consent header; the video signing endpoint is configured and responds successfully.
- App and widget both identify as **1.3, build 3**. Archive creation and strict signature verification passed. All **229 bundled web files** match the final merged-main release build. See `build-3-manifest.json`.

Archive: `artifacts/GoodEats-1.3-build-3.xcarchive`.
Final archive baseline: `38c5d72` (merged landing page), plus the safety changes in this release. The earlier isolated snapshot is retained at `/tmp/goodeats-safety-release`.

## Production rollout

- Applied migration `20260912180851_community_safety_controls.sql` atomically using the migration API. The local timestamp matches the recorded production migration. The previous approval rejection was resolved by explicit owner approval; no historical migration records were repaired or rewritten.
- Deployed `location-chat`, `build-recipe`, `import-recipe`, `import-restaurants`, `generate-recipe-image`, `group-swipe`, `mux-upload-init`, `mux-playback-token`, `mux-set-visibility` and `push-dispatch`.
- Existing publications were preserved as approved. Live transactional tests passed with the dedicated test account and a temporary second account: owner-only pending posts/photos, moderator approval/removal, private reports and deduplication, denied self-approval, bidirectional blocks, denied blocked messages, restored messaging after unblock, and corresponding storage-object access rules. All fixture writes and temporary moderator privileges were rolled back. Cleanup confirmed 0 temporary accounts, 0 reports, 0 blocks, the original 1 administrator, and the test account's original 9 ratings.
- Security advisors reported no ERROR findings. Remaining notices cover existing service-only tables intentionally lacking client policies, the existing `pg_trgm` extension location, and executable security-definer functions. The new exposed helpers are intentional authorization boundaries; tests confirm ordinary callers cannot approve content, access internal helpers, or invoke operational functions. This is not a claim that all advisory warnings have disappeared.
- Published support site commit `5a3394e` to `tcg12345/gourmetcanvas-support`.
- App website deployment and public URL checks: in progress.

## Operational limits

Review is manual. Comment notifications are withheld when comments are submitted, and approval does not replay those notifications. Suspension appeals are handled through support; restoring a suspended account currently requires a trusted database administrator. Existing downloaded content and already-issued media URLs cannot be recalled instantly. The refreshed archive has passed automated and signature checks, but these new safety screens still need a brief owner check on the physical iPhone before submission.

## Owner checklist

- Check the moderation inbox regularly, respond promptly to reports, review every submitted photo/video before approval, and monitor `gourmetcanvassupport@gmail.com`. Automatic screening has not been enabled. Establish who will handle the queue before allowing public submissions at scale.
- Review the published privacy policy and community rules against your operating practices. Keep the existing Privacy Policy/Support URLs in App Store Connect; the new terms page uses the matching `/terms` URL.
- Review App Privacy answers for account/contact information, user IDs, user content (including private messages and AI conversations), location, usage and diagnostics. Contact discovery transmits hashes rather than raw address-book entries; determine the applicable disclosure using Apple's collection definitions. Confirm the age-rating answers reflect user-generated content and messaging.
- After a brief physical-device check, upload/select **1.3 (3)**. Leave the draft subscriptions unsubmitted and unattached to this version.
- Supply a working App Review account and reviewer notes explaining where to find AI consent, reporting/blocking, account deletion, and that this release has no paid subscription requirement.

Apple references: [User-generated content, guideline 1.2](https://developer.apple.com/app-store/review/guidelines/#user-generated-content) and [Data use and sharing, guideline 5.1.2](https://developer.apple.com/app-store/review/guidelines/#data-use-and-sharing). These changes address the identified risks; Apple makes the approval decision.
