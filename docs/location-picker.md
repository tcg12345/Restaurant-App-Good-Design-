# Location picker

The shared HomeLocationBar now presents LocationPickerSurface: a bottom-attached sheet with a compact header, an internal close button, a 16 px search input, one selected-location card, a current-location action, and scrolling recent/popular choices. The current selection is omitted from recent and popular rows. All existing callers use this surface.

The sheet enters in 240 ms and exits in 180 ms, respecting Reduce Motion. The shared scroll-aware dismissal hook allows downward dismissal from the header or content at its top, while preserving normal scrolling and text input. The surface owns hard scroll locking, native glass occlusion, keyboard focus containment, and visual-viewport resizing until its exit completes. Opening does not automatically raise the phone keyboard.

Location search retains separate global city and proximity-biased address queries, with a 220 ms debounce, abort on query/visibility changes, stale-response guards, duplicate removal, and retryable errors. Selection still updates the existing picked-location store and caller callback.

Validation: six tests covering selection, scroll/focus ownership, out-of-order searches, deduplication, errors, and shared swipe behavior. Browser previews checked light/dark presentation at 393×852 and compact layout at 320×568. Requests were mocked in tests; browser inspection did not submit searches, request device location, or save a selection.
