# Restaurant photo reveal

The mobile restaurant details page now presents its content as a rounded card over a shared photo canvas. A downward pull begun at the top of the details moves the card with the finger and expands the photo header into a full-screen gallery. The card rests at the bottom as a restaurant-details dock. Swipe upward on the photo or dock, tap the dock/close button, or press Escape to return.

The photo-count button, card grabber, and photo itself also open the gallery. Horizontal swipes, arrows, and a thumbnail strip change the selected photo; the header keeps that selection when details return. An all-photos grid provides direct jumps. Community captions and the existing Pro-gated dish recreation handoff are preserved. Personal visit-photo viewers and the desktop details layout keep their existing behavior.

## Interaction safeguards

- Native upward scrolling and downward scrolling away from the top are left alone. Form controls and horizontal rails do not initiate a pull.
- The left edge remains available for app navigation. A presented gallery temporarily owns the overlay and native-glass/scroll locks.
- A small incomplete pull springs back. Interrupted/multitouch gestures cancel; a deliberate pull or flick commits. A drag's synthetic click cannot immediately toggle the gallery back.
- The details stay mounted, preserving form/accordion state. Focus moves into the gallery and returns without scrolling. Background details become inert while open; keyboard navigation is contained within the gallery.
- Reduce Motion skips the reveal spring. Safe areas and viewport changes reposition the bottom dock. Native status-bar text stays legible over the dark photo canvas.
- Leaving a retained restaurant route releases gallery ownership. Pro dialogs temporarily take over interaction and status-bar styling; dish recreation does not steal focus back from its destination.
- Photos are real existing restaurant/community URLs. The grid/strip mount only during a reveal and thumbnails load lazily. Failed photos show an explicit fallback.

## Files and checks

- `RestaurantPhotoStage.tsx` and `.css`: presentation and interactions.
- `restaurant-photo-gesture.ts`: direction-lock and snap policy.
- Component and gesture tests cover open/close, grid/selection, pull/return, cancellation, native scrolling, edge navigation, no-photo fallback, and lock cleanup.
- `scripts/restaurant-photo-preview.html`: isolated local fixture using the real component with existing sample images; no account or API writes.
- Visual checks at 393 × 852 and 320 × 568, including light/dark details, the photo canvas, grid, and return dock.

## Swipe reliability and searchable gallery update

Restaurant routes now disable app pull-to-refresh outright. The details root also opts out at the gesture target level, including restaurants without photos; browser overscroll is contained while that route is active. Refresh also relinquishes an already-prevented touch and never treats touch cancellation as a refresh request.

The gallery registers gesture/overlay ownership with `dimPresenter: false`. App presentation now listens to a separate ref-counted presenter signal, so the in-place photo reveal does not shrink or transform its own viewport. Normal sheets still dim their presenters, including sheets opened above the gallery.

A persistent search field filters available community captions, restaurant name, photo number, and source labels locally. It does not infer image contents for uncaptioned photos. Matching photos appear in a two-column grid with visible captions; selecting a result opens its original album index. Empty results provide a clear recovery action. Search input arrow keys retain their editing behavior and the focus loop includes the input.

Validation for this update: 20 focused component/gesture/overlay/rating/share tests passed, including a long pull with the real refresh component mounted and nested sheet presentation ownership. Browser visual inspection was unavailable because the host Mac was locked; the earlier visual checks above predate this update.

## Compact gallery and stable reveal

The restaurant navigation now observes the stationary hero spacer instead of the translated restaurant title. The observation is renewed when photos arrive asynchronously. This prevents gallery movement from leaving the opaque scrolled-header background over the photo.

The gallery uses a single-line header, compact search, three-column square grid, and a 44 px restaurant-details return bar plus the device's bottom safe area. Its measured travel matches that smaller dock. Single-photo images explicitly fit their allotted height so they cannot spill over captions and controls.

The canvas keeps viewport dimensions during a reveal, using clipping and opacity instead of resizing the gallery and blurring a full-screen image every frame. The card follows the finger and settles in 280 ms; an open-state change no longer starts the settle animation twice. Photo changes use a short opacity transition without rescaling the image.

Verification: 13 gesture/component/overlay tests, TypeScript/build, and iOS sync passed. The actual component was checked in the browser at 393×852 and 320×568, including grid, selection, dark/light return bars, and image/caption bounds. The small-screen photo bottom and caption top both measured 396 px, with a 44 px dock. These are browser checks; physical iPhone animation performance has not been measured.
