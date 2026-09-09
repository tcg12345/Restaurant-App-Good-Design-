# iPhone widgets

GoodEats now embeds a native SwiftUI/WidgetKit extension, `GoodEatsWidgets` (iOS 17+).

| Widget | Content | Sizes |
| --- | --- | --- |
| Upcoming Meals | Upcoming restaurant and recipe plans, confirmed reservation indicator, tap into the exact plan | Small, medium, large, rectangular and inline Lock Screen |
| Taste Profile | Existing taste tier and points, next-tier progress; medium adds exploration stats and community rank when available | Small, medium, circular Lock Screen |
| Your Circle | Unread message and friend request counts; no conversation content | Small, medium |
| Saved for Later | Daily rotating pick from up to 12 recently saved restaurants | Small, medium |
| Top Tables | Personal restaurant ranking, first place or top three; numeric scores remain hidden | Small, medium |

Open GoodEats and sign in once. On the iPhone Home Screen, hold an empty area, choose **Edit → Add Widget**, search **GoodEats**, then pick a size. The app includes these instructions under **Settings → iPhone widgets**. Users place widgets themselves; the app cannot add them to the Home Screen automatically.

## Data and refresh behavior

`WidgetSync` consumes existing account, calendar, chat, lists, and taste providers. It coalesces changes for 400 ms and writes a bounded, versioned JSON snapshot through `GoodEatsWidgetsPlugin`. No new database schema or public endpoint is introduced. No tokens, contact identities, message bodies, reservation codes, addresses, or notes are shared with the extension.

The app and extension share `group.com.tylergorin.restaurantapp.widgets`. Writes are atomic with file protection until first unlock. A serial queue and owner checks prevent old-account writes from overtaking sign-out. Sign-out, account deletion, guest mode, and device account changes clear widget data and request a reload. Widget views mark personal content as privacy-sensitive; iOS controls when cached widget views are actually replaced.

Changes refresh after the app's existing providers sync, including local edits and foreground refreshes. **This implementation does not perform authenticated network fetches from the extension and does not add WidgetKit push delivery.** Friends/messages do not update continuously while GoodEats is closed. The circle widget stops showing old counts after 24 hours. All snapshots expire after seven days and ask the user to reopen the app.

When the app moves to the background, pending widget data is sent immediately rather than waiting for the normal debounce. This covers saving a plan and immediately returning to the Home Screen. Daily saved picks use a local calendar-day index so daylight-saving changes cannot skip or repeat a pick.

Meal timelines contain start/end boundaries for the next day, so the next meal advances without opening the app. Saved picks rotate at local midnight (calendar arithmetic respects daylight saving). An hourly timeline reload is requested; iOS controls actual scheduling. The initial gallery uses explicitly marked sample data, while live timelines use only the shared snapshot or an empty state.

Links use the existing application URL scheme with a widget-specific host and an allowlist of supported paths. Calendar links preserve the plan ID; restaurant links open the restaurant detail page.

## Signing and release

The extension is embedded by the App target. Both targets use the existing Apple Developer team and automatic signing. **Provisioning was completed on September 9, 2026:** the signed app and extension both contain `group.com.tylergorin.restaurantapp.widgets`, and both embedded profiles authorize that group. The app profile also includes Push Notifications. Both profiles expire September 9, 2027; normal automatic signing refreshes them as needed.

A Release iPhone archive was created successfully, and both code signatures were verified using the system trust service. The archive currently carries development provisioning; distributing through TestFlight still requires the normal App Store export/upload step. No TestFlight upload or physical-device installation was performed.

For simulator installation, use local ad-hoc signing (`CODE_SIGN_IDENTITY=- CODE_SIGNING_ALLOWED=YES`). An unsigned `CODE_SIGNING_ALLOWED=NO` build compiles but does not register App Group access when installed, leaving widgets unable to read the shared snapshot.

The App still targets iOS 15, while widgets require iOS 17. Keep the App/project deployment configuration first in the `.pbxproj` build-configuration section: the installed Capacitor CLI discovers the Swift package deployment version by reading the first `IPHONEOS_DEPLOYMENT_TARGET` entry, irrespective of target.

## Verification

- `npx vitest run src/lib/widget-data.test.ts src/lib/native-widgets.test.ts` checks privacy filtering, ownership, payload bounds, sorting, malicious links, queue recovery, and clear/write races. The contract test writes a synthetic snapshot to `/tmp/goodeats-widget-contract.json`.
- `xcrun swiftc -module-cache-path /tmp/goodeats-swift-cache -D WIDGET_MODEL_TESTS ios/App/SharedWidgets/WidgetModels.swift scripts/widget-model-check.swift -o /tmp/goodeats-widget-model-check && /tmp/goodeats-widget-model-check` decodes that actual JavaScript payload in Swift and checks meal rollover, expiry, saved picks, and link encoding.
- The shared `WidgetRenderTests` scheme renders the production SwiftUI views in an iOS simulator. It covers 22 Home Screen size/appearance combinations plus five empty states and three Lock Screen layouts. Images are retained as XCTest attachments. These renders verify layouts, not SpringBoard placement or physical-device background scheduling.
- `npm run ios:sync`, then build/install the App scheme. Widget render tests are a separate development target and are not embedded in the shipping app.
- Final simulator integration: the locally signed app registered the shared App Group and wrote a version-1, account-scoped snapshot with meal, saved-place, taste, social, and personal-ranking data. This was checked without printing account identifiers or content. SpringBoard placement and physical-device background scheduling remain device checks.

References: [Apple widget installation](https://support.apple.com/en-gb/118610), [WidgetKit refresh behavior](https://developer.apple.com/documentation/widgetkit/keeping-a-widget-up-to-date/), [App Groups](https://developer.apple.com/documentation/xcode/configuring-app-groups).
