# GoodEats iOS notifications

Implemented September 8, 2026. Open **Settings → Notifications**, or Home → More → Notifications, to manage alerts and recent activity. No system permission dialog appears at launch; users choose **Enable notifications**. Existing users start with push off. Message/meal previews start hidden.

### Onboarding

iPhone account setup ends with a dedicated Notifications page. It explains meal reminders, social updates, and recaps, then offers **Enable notifications** and **Not now**. Only the enable action requests iOS permission and saves the existing account notification preferences. Declining allows setup to continue; already enabled permissions show a completion state. Browser onboarding skips this iOS-only step.

Skipping optional taste questions still reaches the notification page. An active setup flow stays mounted through profile/auth refreshes after the system dialog, and releases only on explicit completion. Existing completed accounts are not forced through onboarding again. The page has light/dark and reduced-motion support; development preview: `/scripts/onboarding-preview.html` → Notifications. Its simulated permission action never changes an account or requests OS access.

## Notification catalog

| Event | Delivery and destination | Status |
| --- | --- | --- |
| New friend request | Push + activity → Friends | Implemented; pending requests only |
| Friend request accepted | Push + activity → Friends | Implemented; one per transition |
| Direct or group message | Push + activity → exact conversation | Implemented; excludes sender, read messages and removed participants |
| Shared restaurant, recipe, post, reel or guide in chat | Same message pipeline → conversation | Implemented; generic sharing text when the message has no text |
| Likes on ratings, posts or reels | Push + activity → relevant content | Implemented using existing server engagement triggers |
| Comments/replies on ratings, posts or reels | Push + activity → relevant content | Implemented using existing recipient resolution |
| Invitation to a shared list | Push + activity → shared list | Implemented; new members only |
| Friend adds a restaurant to a shared list | Push + activity → shared list | Implemented; excludes the person adding it |
| Upcoming restaurant/reservation plan | Local iPhone reminder → plan popup | Implemented; chosen lead time |
| Upcoming cooking plan | Local iPhone reminder → plan popup | Implemented; chosen lead time |
| Rate a restaurant after a visit | Local reminder → plan popup | Implemented; one hour after plan ends, respects review state/snooze |
| Weekly food recap | Push + activity → GoodEats in Review | Implemented; Monday after 9 a.m. in account timezone |
| Monthly food recap | Push + activity → GoodEats in Review | Implemented; first of month after 9 a.m. |
| Yearly food recap | Push + activity → GoodEats in Review | Implemented; January 1 after 9 a.m. |
| Pro purchase, plan change, cancelled renewal or expiry | Push + activity → membership settings | Implemented from RevenueCat subscription events |
| Payment/billing issue | Push + activity → membership settings | Implemented from RevenueCat BILLING_ISSUE |
| Verification approved/denied | Push + activity → verification settings | Implemented; decision details stay in the app |
| Admin cuisine review traffic | Activity → admin review | Existing in-app events retained; excluded from general push |

Recaps require real synced dining, dated cooking, or recipe activity in the closed period. When boundaries coincide, only the largest recap is created. A recap is built/displayed by the existing archive when opened; the notification does not claim a pre-rendered story is already downloaded.

Useful next events, once a reliable event source exists:

- **Restaurant operations:** reservation confirmation/change/cancellation, waitlist availability, restaurant cancellation/closure affecting a booked plan. These require a booking/restaurant partner feed; editing an idea in the calendar does not prove a reservation exists.
- **Collaborative plans:** invited to dinner, RSVP, host changes the time/place, group vote ready, final group match. Add shared plan participants and a server-confirmed group outcome before sending these.
- **Cooking:** timer finished, ingredient/checklist reminder, changes to a saved recipe. A timer is a good local notification; reminders should be explicitly requested.
- **Account security:** new-device sign-in, password/email changed, suspicious session, account export ready. Use authenticated server security events; never infer these from client UI. Security emails remain independent of optional push preferences.
- **Discovery:** a followed restaurant's new menu, a saved place reopening, a new recipe from a followed creator. Keep these separately opt-in, with a digest and frequency cap; do not turn the core channel into advertising.
- **Personal milestones:** meaningful firsts or anniversaries, folded into recaps rather than many individual alerts.

## Controls and delivery behavior

- Eight category switches; account-wide pause, preview privacy, sounds, meal lead time, and optional quiet hours.
- Quiet hours defer server alerts and skip local meal reminders inside the quiet window. iPhone Focus and Scheduled Summary remain in control of presentation. The saved IANA timezone is shown in settings.
- Native code keeps the next 60 local meal alerts, refilled on app open or calendar changes. Stable identifiers replace changed plans and remove cancelled/deleted/reviewed reminders. This avoids exceeding the iOS pending-notification budget.
- Local reminders continue offline. Changes made on a different device can only update a phone's local schedule when that phone next syncs; no silent/background push synchronization is implemented.
- Foreground alerts are suppressed when they point to the exact page already open. Reading a conversation marks its message notifications read server-side. Bursts within a delivery batch coalesce to the newest message per conversation/device; APNs also uses a conversation collapse ID.
- Push delivery is at-least-once, not exactly-once: bounded retries, leases, expiry, and stable APNs IDs reduce duplication. APNs acceptance does not guarantee an alert is displayed.
- Installation bindings require a valid Supabase session. Sign-out unregisters APNs and clears scheduled/delivered alerts; deleting/revoking the session cascades the server token and queued work. Tokens are private and never returned through a public table.
- Notification taps survive native cold launch, wait for auth, verify the recipient, and only allow known internal routes. Deleted/unavailable items use the destination page's normal unavailable state.
- No Live Activity, background fetch mode, time-sensitive interruption privilege, or marketing broadcasts have been enabled. WidgetKit widgets are implemented separately; see [iOS widgets](ios-widgets.md).

## Activate remote delivery

The database migration and `push-dispatch` Edge Function are deployed to project `ocpmhsquwsdaauflbygf`. The cron job is installed. On September 9, 2026, APNs key `Z3J734F26B` (Team `669SG3MPU7`, Sandbox & Production per the account owner) and the dispatch credentials were securely installed. All five Edge secrets were verified by digest; both Vault entries exist and the minute cron is active. An authenticated dispatcher request returned HTTP 200 with no queued deliveries, and the scheduler run succeeded. No device was registered at verification time, so real APNs delivery still needs an iPhone test. In-app server events and local iOS reminders can work independently.

1. In the Apple Developer account, enable **Push Notifications** for App ID `com.tylergorin.restaurantapp`. Create an APNs token signing key and download its `.p8` file. Keep the key outside the repository. Record its Key ID and the Apple Team ID. Refresh physical-device provisioning profiles after enabling the capability.
2. In [Supabase Edge Function Secrets](https://supabase.com/dashboard/project/ocpmhsquwsdaauflbygf/functions/secrets), add:
   - `APNS_KEY_ID`
   - `APNS_TEAM_ID`
   - `APNS_PRIVATE_KEY` — complete `.p8` PEM contents, with real newlines (escaped `\n` is also accepted)
   - `APNS_BUNDLE_ID` — `com.tylergorin.restaurantapp`
   - `PUSH_DISPATCH_SECRET` — a newly generated random secret of at least 32 bytes
3. In Supabase Vault, add two named secrets:
   - `goodeats_push_url` = `https://ocpmhsquwsdaauflbygf.supabase.co/functions/v1/push-dispatch`
   - `goodeats_push_dispatch_secret` = the same random value as `PUSH_DISPATCH_SECRET`
   The existing minute cron job will then deliver eligible events. Do not put the service-role key, APNs key or dispatch secret into any `VITE_*` variable, app bundle, migration, screenshot, or chat message.
4. On a signed iPhone build, sign in → Settings → Notifications → Enable. Use **Send a test notification** for a local five-second test. Then use two dedicated test accounts to verify a real friend request/message while the receiving app is backgrounded, tap-through after termination, read suppression, preferences, and logout cleanup. Verify development and TestFlight independently.

The Xcode project has the push capability and `aps-environment` entitlement. `APNS_ENVIRONMENT` is `development` in Debug and `production` in Release; the same build setting is passed to the bridge via Info.plist so the backend selects the appropriate APNs host. Custom distribution configurations must set it consistently with the provisioning profile. No APNs device token is cached in web storage; iOS registration happens again on launch/resume.

## Architecture and operations

- `src/contexts/PushNotificationsContext.tsx`: explicit opt-in, preferences, lifecycle, token binding, local reconciliation, tap routing.
- `ios/App/App/AppDelegate.swift`: native UserNotifications delegate and Capacitor bridge; registered in `MainViewController.swift`.
- `public.notification_preferences`: owner-only RLS and validated boolean categories/timezones.
- Existing `public.notifications`: server-authored events, added titles/routes/dedupe keys. Clients may update `read_at` only.
- `notification_private.devices` and `.outbox`: unexposed, RLS enabled, no client policies or schema grants. Service-only claim/finish RPCs lease up to 40 deliveries at a time.
- `notification_private.dispatch_tick()`: recap creation, three-day queue retention, Vault-authenticated scheduler call. No key means no outbound call.
- `supabase/functions/push-dispatch`: ES256 APNs JWT, development/production routing, eight concurrent requests, retries (max eight attempts), dead-token pruning, quiet-hour deferral, privacy-safe payloads. No token or message text logging.

Monitor failed cron runs and `notification_private.outbox` counts by `last_error`/`attempts`; do not expose token or payload columns in operational dashboards. Jobs expire after three days. Failed or disabled categories remain visible in the in-app activity feed. Category switches control device alerts, not retention of activity.

The Supabase security advisor reported only the intentional “RLS enabled, no policy” information notices for the two new private tables. The lack of client policies is deliberate denial of access; see [Supabase RLS policy advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy). Pre-existing advisories on unrelated tables/views/functions were not changed by this work.

## Widgets and Live Activities

Five WidgetKit widgets are implemented and provisioned: Upcoming Meals, Taste Profile, Your Circle, Saved for Later, and Top Tables. See [iOS widgets](ios-widgets.md) for supported sizes, privacy, and refresh behavior. They use an App Group snapshot synced by the app; remote widget push updates are not implemented.

Live Activities remain a future option for a user-started cooking timer or a confirmed reservation countdown. Messages, friend requests, and recaps use ordinary notifications.

Primary references: [Apple APNs registration](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns), [APNs requests](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns), [Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities), [Supabase scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).

## Verification

58 automated checks passed, including notification and existing calendar/social/glass/back-transition coverage. Notification tests cover permission opt-in, failed preference saves, installation disconnection, cross-account/unsafe tap rejection, calendar deep links, local reminders, quiet hours/DST, burst coalescing, APNs response policy, owner RLS, session validation/revocation, column permissions, trigger deduplication, leases and read suppression. Calendar/social/glass/back-transition regressions also run.

The real notification screen is exercised in a standalone fictional-data preview (`npx vite --config scripts/notifications-preview.vite.ts`, open `/scripts/notifications-preview.html`). This fixture never writes account data or requests OS permissions. The production app does not import it.

The production web build and native iOS simulator build passed. The notification preferences and activity screens were visually checked at 390 × 844 in light/dark appearances; enable state, quiet hours, reminder selection and mark-all-read were exercised using fictional data. The deployed endpoint rejected an unauthenticated request with HTTP 401, and the database scheduler completed successfully.

Physical-device APNs delivery remains unverified. The Apple key and dispatcher are configured; an iPhone must register and opt in before an end-to-end test. Simulator compilation and local UI checks do not constitute APNs end-to-end verification.
