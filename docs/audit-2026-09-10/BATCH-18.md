# Batch 18 — Home spacing and restaurant detail loading

September 12, 2026. Source commit `7eba385`.

Home's top toolbar now has 8px more separation from the search/location row. Route commits immediately flush hidden native glass controls, and background navigation warmup includes the restaurant detail module. Detail routes reuse fresh Places details already fetched by Lists.

The cover request starts from the route ID without waiting for Google details. It primes signed image access; later photo metadata loads in bounded 12-row pages after the route settles. Failed later pages preserve the cover. Covers are scoped to the viewer and media-access generation. Stable database ordering includes the photo ID. No RLS or storage access changes.

The photo stage keeps the detail subtree mounted when the first photo arrives, reserves header space while the cover loads, and defers filmstrip images until the gallery opens. A closed 150-photo test mounts only the two selected-image copies instead of the whole filmstrip.

Validation: TypeScript, security-policy prebuild, production build, native device build, signature verification and packaged asset comparison passed. Full suite: 1,689 passed; one PGlite setup exceeded its 5-second timeout under concurrent build/test load. Its isolated rerun passed, along with navigation-warmup checks (4 tests total). All 22 focused gallery, media loading and glass regression tests passed.

Browser QA at 393x852: Home toolbar computed padding-bottom is 12px and the visible gap is clear. La Vague d'Or's 41-photo detail rendered its cover, with two loaded stage images and zero closed-gallery filmstrip images. Gallery opening, next-photo navigation and closing worked. Browser viewport override was reset afterward.

Installed the signed device build in place on Tyler's iPhone 16 Pro; app data preserved. Evidence is in `/tmp/goodeats-detail-phone-install.json`; native build log is `/tmp/goodeats-detail-ios-build.log`. Physical frame pacing and the subjective native transition remain unverified by this browser QA.

Vercel confirmed deployment success for `7eba385`. Production serves `index-CYCXzpFO.js` and `index-CgtAaYuu.css`. Device installation succeeded, but automatic launch was blocked because the iPhone is locked (`/tmp/goodeats-detail-phone-launch.json`). The user can open the installed update after unlocking.
