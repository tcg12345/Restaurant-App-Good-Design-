# Batch 19 — first gallery pull and unwanted highlighting

September 12, 2026. Source commit `b0cb949`.

Reproduced a first-pull failure with a regression test: start pulling with one cover, append the rest of a 41-photo library while the finger is down, then finish the pull. Before the fix the dialog never opens, because the photo-count dependency replaces the touch listeners and loses their gesture state.

Listeners now persist across photo-count and viewport measurement updates, with travel captured per gesture. The gallery reserves thumbnail-rail space before opening and delays thumbnail image mounting until the opening spring completes, keeping image geometry stable during the pull. Programmatic modal focus remains accessible; keyboard modality controls focus outlines, while pointer/touch input clears them. Gallery chrome explicitly suppresses text selection, callouts and tap highlights.

Validation: 29 focused tests across gesture, gallery, photo loading and native glass passed. New coverage exercises mid-pull photo arrival, resize, thumbnail deferral and touch-versus-keyboard focus. TypeScript/security-policy/production build passed. Device Xcode build passed, signature verified, and packaged web assets matched dist.

Browser QA at 393x852 with La Vague d'Or's 41 photos: pointer opening focused the close button with computed outline `none`, and the handle outline was also `none`. Shift-Tab moved focus to Show all photos with a solid keyboard outline. Gallery layout and close worked. Temporary viewport override reset. These checks do not measure physical-device frame pacing.

Vercel deployment succeeded; live entry is `index-DE-5K476.js`. Native entry `index-B98puffm.js` installed in place on Tyler's iPhone 16 Pro, preserving data (`/tmp/goodeats-first-pull-phone-install.json`). Automatic approval review rejected launching because the device was last confirmed locked; user unlock requested. No workaround attempted.
