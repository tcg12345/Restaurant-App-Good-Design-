# Native-style navigation audit — September 5, 2026

Reference reviewed: Aurum's per-tab NavigationStack, HotelDetailView, design system, and supplied screen recording.

## Changes

- Verified history takes priority over a page's default parent. Direct links use safe, replacing fallbacks rather than blindly leaving the app or pushing a return loop. Same-tab reloads retain verified history.
- Back buttons and touch gestures share one transition. Finger-tracked movement reveals the presenting screen with restrained parallax and shadow; a paused short swipe cancels. Interrupted navigation clears gesture state.
- Tabs stay mounted. Scroll restoration ignores hidden tabs, outgoing routes, sheet scrollers, and inert preview copies, and stops retrying as soon as the user interacts.
- Preview copies retain nested scroll offsets and pinned chrome. Hidden preview/tab descendants cannot bleed through the live page.
- Conversations and new-message destinations have history entries. Resolving a draft into a conversation replaces that entry without a second push animation.
- Public-profile filters, sorting, tabs, and expanded visits stay with their history entry. Restaurant disclosures also persist on return; cached restaurant details and a bounded hero cache prevent unnecessary initial loading/layout jumps.
- Restaurant and recipe photo headers meet a softly overlapping content surface. Restaurant navigation condenses to a quiet title and glass controls while scrolling.
- Carousels keep horizontal gestures. Maps, Group Swipe, Pro walkthroughs, and focused reels reserve their interactions, with edge navigation where applicable. Modal sheets keep their own dismissal gestures. Reduced Motion is respected.

## Verification

- 30 routing unit tests passed; TypeScript and production build passed.
- Mocked Chromium mobile checks: list → restaurant → back; short paused swipe cancellation; partial live preview; photo-carousel and gallery gesture ownership; Back button and browser forward with exact scroll restoration; nested Settings and same-tab reload; Home → inbox → conversation → inbox → Home; public taste-profile loop regression; expanded/scrolled public-profile return with pinned preview chrome; interrupted drag; Reduced Motion; light and dark styling.
- All browser network traffic was mocked. No real messages, account edits, or purchases were performed.

## Scope

This improves the existing Capacitor/React navigation layer; it is not a SwiftUI rewrite. Tab roots, modal sheets, and dedicated interactive experiences intentionally retain their own navigation patterns. Physical-device gesture feel and native glass rendering still need an on-device pass.

## Back-flash follow-up

- Reading routes now share a six-entry retained history stack. Returning reveals the same loaded page instance. New forward branches invalidate obsolete entries; media/maps, composers, and password/delete forms are not retained.
- Back moves a fixed viewport preview instead of transforming the live document. This preserves fixed-header coordinates even after window scrolling. The live destination replaces the preview only after its route and scroll settle.
- Removed route brightness filters that temporarily changed fixed-position containing blocks. Push previews can show through the transparent route host, and cloned SVG IDs retain their gradient/clip references.
- Additional mocked browser assertions cover every sampled frame during a committed swipe, exact fixed-header Y position, profile DOM identity and zero profile refetches on Back with delayed network responses, nested and browser Back, and Reduced Motion. Physical-device compositor/native-glass behavior still requires device verification.
