# Home redesign

Home follows the open, editorial reference: the location selector sits in the
header beside Create, Messages and Circle; a personalized greeting leads into
one horizontally scrollable shortcut row. Ask AI is the primary accent action.
For you, Rate a place, Decide together and Cook at home remain accessible in the
same row. The former Dine out / Cook at home boxes and duplicate shortcuts are
removed. Restaurant search remains available through Search and relevant ideas.

One full-width feature uses the existing personalized highlight selection and
real photos when available. A quiet forest/mint illustration fills photo-less
ideas. Transitions crossfade together, without a separate exit delay. Swipe,
pause, next, reduced motion and autoplay preferences are retained.

Guides occupy an open horizontal shelf, rather than a bordered rotating box.
Up to eight guides retain preference ordering and link directly to their guide;
See all opens the existing full browser. Real cover photos are used when present,
with an illustrated cover fallback. Guide positions stay still while browsing.

Home does not vertically scroll. The existing Explore the feed button stays at
the bottom above the unchanged app navigation. Horizontal rails extend to both
screen edges. The separate feed keeps its existing gestures and focus handling.

Validation: 22 Home gesture, highlight and social tests pass. The standalone
/scripts/home-preview.html fixture is visual-only, with sample editorial content;
it does not inject sample posts or guides into the app or write account data.

TypeScript, production build and iOS asset sync pass. Browser checks cover
light/dark layouts at 393×852 and 320×568, photo and illustration features,
shortcut rail reachability, and feed forward/back navigation. Home has no
vertical overflow at either size. Physical-device gesture validation remains
outside these browser checks.
