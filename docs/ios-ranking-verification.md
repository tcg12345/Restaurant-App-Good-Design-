> Historical verification record. For subsequent fixes and current release evidence, see [the audit release log](audit-2026-09-10/RELEASE.md).

# iOS preference-recorder verification

September 9, 2026. App source: `6529bc5c44545c9946b87057863510caf0e8dd69`.

## Completed

- Synced the validated web build into Capacitor with `npx cap sync ios`. The bundled JavaScript contains the new preference recorder.
- Xcode Debug builds succeeded for both iOS Simulator and physical iPhone, including the widget extension. The device build used the existing development signing configuration.
- Launched the normal app in an isolated iPhone 16 Pro simulator running iOS 26.5; Capacitor reported that its WebView loaded.
- Ran an isolated fixture importing the real evidence and journal modules inside the app's actual Capacitor WKWebView (`capacitor://localhost`). It used fictional restaurants and a mocked remote, with no production cloud writes.
- Native checks passed: UUID availability; distinct choice/tie/skip outcomes; local pending persistence; unchanged input scores/order; numeric-free evidence; retention after simulated network failure; retry acknowledgement without duplicate upload; causal links; supersession after edits; separate account journals.
- Terminated and relaunched the fixture. Both recorded events and their acknowledged status survived.
- Restored the ordinary app in the simulator after the fixture checks.

The fixture checks cover native runtime/storage compatibility, not touch interaction or authenticated synchronization against the live database. Previously passing automated component/database tests cover the recording integration and access rules. No new ranking algorithm is enabled by this update.

## Short physical-iPhone checklist

Use a test account for disposable ratings, or make only genuine changes to your own ratings.

1. **Normal H2H:** Save a restaurant after choosing winners. Confirm the rating sheet closes and its score and placement behave as before.
2. **Tie, skip, undo, cancel:** Try a tie and a skip. Undo one answer before saving; abandon a separate draft. Only the final saved answers should be recorded; a skip must not count as a loss.
3. **Other saves:** Try a slider score, a manual reorder, and a notes-only edit. Notes-only changes should not create preference records.
4. **Persistence/offline:** With the app open and signed in, enable Airplane Mode, save a rating, then force-close and reopen. Restore connectivity and foreground the app. The rating should remain, and pending evidence should eventually upload once.
5. **Account isolation:** Once pending uploads have completed, sign out and sign back in. Another account must not inherit the first account's observations.

There is intentionally no new score, badge, or analytics screen. The recorder operates in the background. Verifying exact event contents, duplicate prevention, and upload completion requires inspecting the private `ranking_preference_events` table or the app's account-scoped local journal; the visible UI alone cannot prove those checks.

## Physical installation status

The selected device is Tyler's iPhone 16 Pro. Wireless attempts failed with a timeout/connection interruption. After the phone was connected by USB, installation completed successfully for `com.tylergorin.restaurantapp`; device inspection confirmed a wired connection. The first launch was blocked while the phone was locked. After unlocking, the app launched successfully, reported `WebView loaded`, and completed native bridge calls. It was subsequently relaunched normally and left open on the phone. See the storage warning below before treating this as a clean verification.

The phone reports iOS 27.0 beta; simulator coverage above is iOS 26.5. Successful simulator tests therefore do not establish behavior on the phone's beta OS.

## Broader regression run

A follow-up check on September 9, 2026 passed:

- `npm test -- --maxWorkers=4`: **153 test files, 1,415 tests passed**, zero failures. This includes rating-flow components, H2H, score settlement, saved data handling, preference recording/sync, database access rules, and the rest of the configured application suite.
- Native `WidgetRenderTests` on the isolated iOS 26.5 simulator: **2 tests passed**, zero failures, covering widget and empty/Lock Screen layouts.
- Existing normal-app launch log reports `WebView loaded` with no matching error, exception, or unhandled-error entries.

Logs from this run are in `/tmp/goodeats-full-regression.log` and `/tmp/goodeats-ranking-widget-regression.log`; native test results are `/tmp/goodeats-ranking-widget-regression.xcresult`. These temporary files may be cleaned by the operating system.

No application code changes were required. These passing automated checks do not certify every live service or physical-device interaction; authenticated live sync and touch flows on the selected iOS 27 beta phone remain unverified until installation and hands-on testing succeed.


## Physical-device startup result

On the connected iPhone 16 Pro running iOS 27.0 beta:

- Installation and launch succeeded. The main Capacitor WebView loaded.
- Startup exercised native preferences, keyboard, status bar, tab controls, widgets, notification integration, and purchases configuration. This confirms those bridge calls occurred, not that every feature completed an end-to-end user workflow.
- The captured session had no JavaScript `[error]` entries and no `[Ranking evidence]` warnings.
- **Unresolved warning:** `saveToStorage(goodeats-restaurant-meta) failed even after stripping images`. The restaurant metadata cache did not persist on this startup attempt. Device file metadata reported a 5,783,552-byte local-storage SQLite database (plus its WAL). This is consistent with storage pressure, but database file size alone does not prove a browser quota error or identify which keys consume the space.
- A read-only database-copy diagnostic was blocked by automatic approval review because the database might contain authentication tokens and private records. No database contents were copied or inspected, and no phone data was cleared.

Startup verification therefore passed with a storage finding, not an unconditional all-clear. Local persistence needs further investigation; no loss of ratings or preference events was demonstrated by this check. Actual touch-based rating saves, real offline/reconnect behavior, and authenticated live preference uploads were not exercised on the physical phone.
