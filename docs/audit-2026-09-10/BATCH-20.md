# Batch 20 — Home pull-down search

September 12, 2026. Source commit `027419a`.

Home's pull-down gesture, Home search button and feed search action now navigate to `/search` with `openTakeover`, using the same retained Search page and its location field. Removed the separate HomeSearchOverlay and stylesheet. Direct entries initialize the expanded state before paint and skip the secondary map-wash/content entrance animation. Desktop Search also consumes Home search requests. A retained Following map view no longer takes over the expanded global search input.

Home gesture listeners now read the current search callback through a ref, preserving an in-flight pull when Home's props update. Search button taps retain their direct action rather than going through the gesture cooldown/overlay guard.

Validation: 18 tests across Home gestures, HomeExperience, retained tab location and Search passed. Coverage includes cold and retained search entry, one-time request consumption, shared location chrome and Home prop refresh during a pull. TypeScript, security-policy bootstrap and production build passed. Browser QA at 393x852 verified Home's search entry reaches `/search`, displays the real New York location field, expands it into Search for a location with Current location, and works on a fresh Home load. Viewport override reset afterward.

Physical swipe frame pacing remains a device check. No new security or database changes. Unrelated AppDelegate whitespace and private audit notes excluded from source commit.

Vercel confirmed successful deployment of `027419a`; production serves `index-LhVRA_dv.js`. Signed native build `index-qzbc-A8i.js` installed in place on Tyler's iPhone 16 Pro with packaged asset comparison passing. Evidence: `/tmp/goodeats-home-search-phone-install.json`. Automatic launch was not retried because the earlier locked-device review prerequisite has not been cleared by an unlock reply.
