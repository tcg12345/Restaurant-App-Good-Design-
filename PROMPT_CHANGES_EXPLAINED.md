# What Each Fix Prompt Changes — Plain-English Guide (iOS / Capacitor version)

Companion to `CLAUDE_CODE_FIX_PROMPTS.md` (generated 2026-07-17). Same IDs, same order — one short explanation of what each prompt actually changes in the app.

---

## Phase 1 — Critical (security & data integrity)

**S1 — Open AI endpoints.** Deletes (or locks down) an old, forgotten copy of the AI endpoints that anyone on the internet can call for free on your Anthropic/OpenAI bill — including forcing the most expensive model and paid web searches. Adds rate limiting to the real endpoints and rotates the keys.

**S2 — Reel hijack.** Closes a hole where any signed-in user could overwrite anyone else's published reel or post video with their own upload, by making the server verify you own the content you're uploading to.

**S3 — "Followers only" isn't.** Followers-only reels are currently playable by anyone who gets the raw video URL, and sharing one hands that URL out. This makes private video require signed, expiring playback tokens and makes shares send an access-controlled link instead of the raw file.

**S4 — AI prompt injection.** A malicious user bio or restaurant name could currently instruct the AI assistant to take real actions in your app (change your wishlist, navigate you somewhere). This fences off third-party text as "data, not instructions," makes wishlist changes undoable/confirmed, and whitelists where the AI can navigate.

**S5 — Silent videos.** Any video that goes through trim/crop/filter/text — or gets compressed — currently uploads with NO audio. This merges the original audio track into the edited output.

**S6 — Profile wipe.** One flaky network request can currently dump an existing user into first-time setup, which then erases their bio and flips their private account public. Adds a retry screen instead, and setup pre-fills and preserves existing values.

**S7 — Sign-out leftovers.** Signing out currently leaves all your ratings, meals, and photos readable on the device, and working links into private media survive even account deletion. Sign-out now wipes everything, including the media-link cache.

**S8 — Password overwrite flow.** If the "does this email exist?" check fails, existing users get funneled into the signup flow and end up having their password silently replaced. Failures now show a retry; users with passwords sign in normally after verifying.

**S9 — Vanishing photo galleries.** Rating a restaurant right after sign-in (before your profile loads) currently deletes your previously published photos for that place. Photo removal now only happens when you actually remove photos.

**S10 — Recipes published in your name.** Saving someone else's recipe to a list currently creates a PUBLIC copy under your account that shows up in feeds as if you wrote it. Saved copies become private.

---

## Phase 2 — High severity

**H1 — Un-timestamped edits lost.** Edits to trips, lists, home meals, wishlist notes, and recipes carry no "last edited" stamp, so syncing can silently revert them to older cloud copies. Every edit now gets stamped, and ties resolve in favor of the device in your hand.

**H2 — Double-save drops a rating.** Two rapid rating saves in the same instant can silently drop the first one everywhere. The save path now reads the freshest state instead of a stale snapshot.

**H3 — Deleted visit shows wrong score to friends.** Deleting your current visit is supposed to promote an older one publicly, but the promotion silently never runs — friends keep seeing the deleted score. Fixed ordering makes the promotion actually publish.

**H4 — Stranded photos.** Photos taken offline (or whose upload failed) currently never reach the cloud or your other devices, forever, with no signal. Adds a retry queue that uploads them when you're back online, plus a small "waiting to upload" indicator.

**H5 — AI chat loses your last answer.** Tapping "New chat" within a moment of an answer finishing silently deletes it from history. The history now saves before switching.

**H6 — Broken retry.** Retrying a failed AI message currently sends your question twice in one request, which can make the retry itself fail. Retry now sends a clean history.

**H7 — Chat history sync conflicts.** Two devices overwrite each other's whole AI chat history, and deleted chats resurrect. Adds deletion tombstones and smarter merging.

**H8 — Images eat your chat history.** AI-generated recipe images are stored as raw data inside chat history, and one image can silently evict your entire saved history when storage fills. Images move to cloud storage with only links in history.

**H9 — Guide line breaks destroyed.** Pressing Enter in the guide editor works on screen, but saving glues every line together — multi-line bullet sections publish as one blob. The editor now preserves line breaks.

**H10 — Guide paste chaos.** Pasting into the guide editor injects raw formatting/HTML and bypasses all length limits. Paste becomes plain-text and clamped.

**H11 — AI draft overwrites your manual draft.** Generating or importing a recipe silently overwrites your unsaved in-progress manual recipe in the auto-resume slot. Seeded sessions get their own slot.

**H12 — Recipe delete & duplicates.** "Delete recipe" currently deletes nothing (the confirm flow is wired to a no-op), and double-tapping Save creates duplicate recipes in the database. Both fixed.

**H13 — "2 bay leaves" → "2 bags".** The ingredient parser fuzzy-matches units so aggressively that common ingredients get mangled. Parsing becomes strict; fuzzy matching stays only in the unit picker.

**H14 — ½ doesn't scale.** Quantities written with unicode fractions ("½", "1½") or ranges ("2-3") — common in imported recipes — don't scale when you change servings. All three parsers learn them.

**H15 — Import parser mangles amounts.** The bulk recipe importer uses its own broken parser ("1 1/2 cups flour" → amount 1). It now uses the shared, correct one.

**H16 — Review save can resurrect old data.** Saving a meal review rewrites a whole shared data blob and can race other syncs, resurrecting stale meals or dropping the review. Review writes now go through the single serialized owner of that blob.

**H17 — Pantry reorder.** The custom-order drag does nothing on iPhone and, on desktop, silently scrambles your full saved ranking whenever a filter is active. Touch users get routed to the working /reorder screen; desktop drag now moves only what you moved.

**H18 — Stuck score slider.** The score-range filter can deadlock with both handles at 10 (only Reset recovers). The thumbs can now always pass each other.

**H19 — Head-to-head double-fires.** The comparison-rating flow can fire its "done" callback multiple times, double-saving ratings. It now fires exactly once.

**H20 — "Create New Rating" no-op.** Using "Create New Rating" in a list for a restaurant you'd already rated silently did nothing to the list. The freshness check now uses the right timestamp.

**H21 — Post composer memory leak.** Every compose-and-close session pins all its photo/video previews in memory forever on iOS. Previews now get released.

**H22 — Ghost "Processing video…" reels.** Backgrounding the app mid-upload leaves a permanently stuck processing reel with no cleanup and no way to cancel. Adds a Cancel button, a server-side cleaner for stuck rows, and a retry/discard offer.

**H23 — Like buttons drift.** Fast double-taps on likes/saves (feed, reels, posts) can leave the heart showing the opposite of what's stored, and failures roll back the wrong state. Toggles are now serialized and reconciled with the server's answer.

**H24 — Messaging hardening.** Any member of a group chat can currently erase the whole conversation for everyone; failed sends look "Sent" forever; unread counts can miscount from clock skew. Delete becomes per-person hide, sends get sent/failed/retry states, and unread uses server time and real visibility.

**H25 — Follower counts.** Everyone else's profile shows 0–1 followers because the counting query is blocked by security rules. A server-side counter returns real numbers.

**H26 — Declined = blocked forever.** Once someone declines your follow request, every future request fails with a generic error, permanently. Re-requesting now works.

**H27 — Doomed writes + wasted quota.** Viewing someone's profile map fires paid Google lookups and doomed database writes (to rows you don't own) on every open. Coordinates move to a shared cache table; cross-user writes stop.

**H28 — Missing friends' posts.** The Posts tab fetches the global feed and filters it locally — once the platform has >100 recent posts, friends' posts silently vanish. It now queries friends' posts directly.

**H29 — Eternal spinners on city pages.** One failed network call wedges "Finding restaurants…" or Load More forever. All loading states now clear on failure with a Retry.

**H30 — Blank map on rotate.** Crossing the tablet/phone layout breakpoint (e.g. iPad rotation) permanently blanks the location map. The map now survives layout swaps.

**H31 — Cache tug-of-war.** The home recommendations rail and the browser write incompatible signatures to the same cache slot, endlessly invalidating each other and re-hitting the paid Places API. One canonical signature.

**H32 — Recommendations ignore your friends.** Friend/expert signals load after the recommendations are ranked and never get applied that session. Rankings now re-score when signals arrive.

**H33 — Restaurant panel (from reels).** The panel that opens from every reel can spin forever on a failed fetch, and its community photos render blank on iOS. Adds error handling and the same photo conversion the detail page uses.

**H34 — Scroll restored to the wrong page.** Back-navigation restores scroll into the page that's animating OUT, so the new page lands at the top. Restoration now waits for the destination to exist.

**H35 — Page permanently unscrollable.** Closing two stacked sheets in the wrong order can leave background scrolling locked forever. The lock becomes reference-counted.

**H36 — Swipe-back grows history.** Swiping back to a parent screen pushes a new history entry, so the hardware back button then goes "forward." It now replaces instead.

**H37 — Crash screen overkill + silent crashes.** Any stray browser error event (including a harmless ResizeObserver warning) replaces the whole running app with a dead-end crash screen — and production builds strip all error logs. Benign errors get filtered, the crash screen gets a "Try again," and error logging survives builds.

**H38 — Keyboard bridge edge cases.** Fixes a listener leak (duplicate keyboard handlers), the bottom nav vanishing when a hardware keyboard is attached, and stale layout heights after rotating with the keyboard open.

---

## Phase 3 — Medium

**M1 — "Opens today" lies.** The hours banner shows opening times that already passed. A single correct helper (using the already-existing hours parser) replaces two broken copies.

**M2 — Off-by-one dates.** Three remaining spots show visit dates a day early in US timezones. One shared date parser fixes them.

**M3 — Modal seeding.** Logging a new visit silently reverts your hand-picked price to Google's guess, and first-ever ratings save with no date. Both fields now seed correctly.

**M4 — Double-tap saves.** Rating save buttons get an in-flight guard so a double-tap can't create duplicate visits.

**M5 — Retire the second rating modal.** Two divergent rating editors are live; the older one lacks compression, delete, and new-visit mode. Everything now uses the full-featured one; the old modal is deleted.

**M6 — Frozen hours.** Restaurant hours are fetched once per restaurant, forever — schedule changes never show. Hours now refresh after 7 days.

**M7 — Fake interactive map.** The detail-page mini-map renders zoom controls that are covered by an invisible button and can never be used. It becomes an honest static map that opens the full map on tap.

**M8 — Better directions.** Directions links get the exact place ID (no more wrong-branch routing for chains) and open Apple Maps natively on iOS instead of bouncing through Safari.

**M9 — Trip stats.** The trip average divides by the wrong count and trip ratings are never even populated — it shows "0.0". Both fixed; completed dinners pull your real rating.

**M10 — Tokyo trips search Manhattan.** Trips without geocoded destinations silently search New York. The destination now geocodes on demand.

**M11 — List search/stats.** Searching inside a list now filters the wishlist section too; header counts and averages reflect what's actually shown.

**M12 — CSV "city" = country.** The export's city column now uses the real city extraction instead of the last address segment.

**M13 — Reorder screen races.** The reorder page no longer shows "no restaurants" when data loads late, and undo no longer duplicates snapshots in dev.

**M14 — Stale distances.** Changing your home location now updates Pantry distance labels without a remount.

**M15 — "Under 30 min" consistency.** Recipes with unknown cook times behave the same in every view.

**M16 — Wrong Michelin stars.** Name-only Michelin matching can badge a same-named restaurant on the other side of the world. Matching now requires a real city match and never guesses on empty addresses.

**M17 — NYC search bias.** The rating-search popup and phone search results are biased to Manhattan for everyone. Both now use your saved home location.

**M18 — Michelin list behavior.** Michelin results now merge before sorting (not appended at the bottom), get capped by distance, and unknown-price places stop sorting as "cheapest."

**M19 — Dead refresh pipeline.** A fully built but never-wired "refresh recommendations" and infinite-scroll pipeline gets connected to the UI (or deleted).

**M20 — Geocode bookkeeping.** Interrupted wishlist geocoding no longer permanently skips the rest; coordinate-less community candidates stop being silently discarded at (0,0).

**M21 — Comment composers.** Double-Enter can no longer post duplicate comments/messages, and Asian-language keyboards no longer post mid-composition.

**M22 — Feed timestamps.** Feeds fetch by edit-time but sort/label by create-time, so edited old reviews float up labeled "2 years ago." One timestamp everywhere, with an "(edited)" tag.

**M23 — Expert list queries.** Loading experts fires 3 requests per expert (with full rating downloads just to count them). One batched server call replaces them.

**M24 — Reply migrations.** Two parallel migration folders can produce databases where replies silently fail; one folder becomes the source of truth, and the review-detail page renders threads properly instead of flat.

**M25 — Admin flash.** Real admins no longer see a "not available" flash while their permission check loads.

**M26 — Guide creator safety.** Esc no longer closes the whole editor through a popover; misclicking the backdrop asks before discarding a whole unsaved guide; list "Add all" toggles behave; unpublishing no longer overwrites newer edits.

**M27 — Guide editor details.** "Reset styles" no longer deletes your typed author bio; entries added from search can finally be given a score in the editor; duplicate chips remove one at a time.

**M28 — Recipe robustness.** 16-hour recipes stop getting truncated to 12; malformed AI output shows an error instead of a stuck spinner; a rare streaming edge case stops corrupting output; review headlines stop misrendering.

**M29 — Recipe comments.** Deleting a comment thread no longer leaves badge counts wrong, and users can finally delete their own comments.

**M30 — Data-layer hygiene.** Four systemic cleanups: state updates stop doing writes twice in dev; sign-in stops republishing every rating (hundreds of needless writes that also spam friends' feeds); saves stop making 2 round-trips each; and the giant shared blob (visit history with inline photos, meals, tombstones) gets split into proper columns so one tap stops re-uploading megabytes.

**M31 — CSV import.** The restaurant importer's parser handles quoted fields properly, stops matching restaurants at latitude 0/longitude 0, clamps scores (with a 5-point-scale prompt), and stops reporting "found" for rows it silently skipped.

**M32 — Reels engineering.** Off-screen videos release their memory; a stalled video edit times out instead of hanging the submit; feeds paginate past 100 items; comment badges stay accurate; followers see followers-only reels in restaurant rails.

**M33 — OAuth cold start.** If iOS kills the app while the Google sign-in browser sheet is open, sign-in now completes on relaunch instead of being lost.

---

## Phase 4 — Glitches & polish

**G1 — Keyboard sweep.** Every remaining composer (rating notes, comments, share dialog, recipe modals, guide footers) gets the keyboard-height padding the chat already has, so inputs and Save buttons stop hiding behind the iOS keyboard.

**G2 — Toasts.** Overlapping toasts stop piling up, and toasts rise above the keyboard instead of behind it.

**G3 — Push animation direction.** Navigating deeper stops playing the "going back" animation; pushes and pops now animate in the correct iOS directions.

**G4 — Sidebar jank.** Desktop sidebar hover-expansion stops reflowing the entire page; it expands as an overlay.

**G5 — Pull-to-refresh.** Stops taxing every scroll frame app-wide, and refreshing one tab stops wiping the other tabs' state and scroll positions.

**G6 — Sheet exits.** Three sheets that pop off instantly (guide creator, add-to-night, create-trip) get their slide-down close; wizard steps crossfade without a blank gap or scroll reset.

**G7 — Dark mode sweep.** Fixes white-on-white comments sheet, unreadable map pills, cream flashes before guides, glowing score chips, and other hardcoded light surfaces.

**G8 — AI chat feel.** The keyboard stays up between messages, a Stop button can cancel long generations, your sent message scrolls into view, long chats stop stuttering, and the input grows for multi-line questions.

**G9 — Search feel.** Results dim instead of vanishing into a spinner on every keystroke; the loading fade matches reality; backspace-clearing search restores browsing.

**G10 — Rotation-proof sheet.** The map bottom sheet's snap points recompute after rotation instead of freezing at mount values.

**G11 — Reels overlays.** The delete chip stops colliding with the mute button on Dynamic Island phones; the scrub bar becomes grabbable; lower-screen taps pause the video instead of toggling the caption; follow state syncs across an author's slides; upload progress stops hitting 100% early.

**G12 — Detail polish.** Restaurant pages load with a skeleton instead of a spinner-then-pop; photo dots animate; invalid button-inside-button markup is fixed.

**G13 — Pantry/profile micro-fixes.** Grid cards stop reflowing rows when notes expand; the sort pill reflects reality; the profile stat popup stops flashing empty; the trips header/FAB align with the rest of the app.

**G14 — Import/cook/gallery.** The bulk-import Stop button actually stops; cook mode shows the rich step timers/sections that advanced recipes have; the photo gallery dot can't go stale.

---

## Phase 5 — Design system / iOS consistency

**D1 — One score-color system.** Four different green/amber/red palettes (and three map marker palettes) collapse into one token-based scale that adapts to dark mode.

**D2 — Tap targets.** Dozens of sub-44pt controls across every surface get proper touch areas (and accessibility labels).

**D3 — Safe-area stragglers.** The last few elements that can sit under the home indicator (action menus, detail page bottom, trips FAB) get inset-aware spacing.

**D4 — Token drift.** Hardcoded hexes — including a shadow still using the OLD brand color — migrate to theme tokens so dark mode and future rebrands work everywhere.

**D5 — Honest flavor chart.** The radar chart labeled "From the community" is actually fabricated; it either becomes real (from community tags) or gets relabeled honestly.

**D6 — Mapbox attribution.** Hidden map attribution (a terms-of-service violation) is restored in compact form.

**D7 — Share links.** Shares from the iOS app stop leaking useless `capacitor://` URLs; reels share their actual deep link; guides always include a working link.

**D8 — Touch affordances.** The hover-only "Message" button becomes visible on touch; the fake "Follow" label becomes a real button; blocking alert() dialogs become toasts; avatar colors match across surfaces.

---

## Phase 6 — Gaps & features

**F1 — Auth completeness.** "Forgot password?" actually works; the decorative "Keep me signed in" is implemented or removed; username availability is checked live; Terms & Privacy actually link.

**F2 — Onboarding answers used.** The taste quiz stops throwing away its answers — they persist and seed recommendations for new users.

**F3 — Hidden rating data.** "Would return" and favorite dishes are collected but never shown anywhere; they either get rendered on the detail page or removed.

**F4 — Receipt/typing stubs.** "Sent" receipts (hardcoded) and the typing indicator (always off) get minimally implemented from existing data, or removed until real.

**F5 — Social navigation.** "Message" on a profile opens that person's thread directly; fake "1,200+ recipes" copy shows the real count; Activity counts match their grids.

**F6 — Guide data completeness.** Guides capture the city (so they appear on city pages without expensive fallbacks); computed-but-hidden stats (read time, average score, saves) get displayed; fragile hours capture is fixed.

**F7 — Honest AI tools.** The assistant stops claiming "no circle ratings" when it simply can't check, stops presenting unfiltered experts as filtered matches, and always closes with text after taking actions.

**F8 — Composer gaps.** Desktop reels get the audio field; post audio labels actually render; the fully built video-crop capability gets its UI; invalid file picks stop advancing the wizard to an empty step.

**F9 — Recipe completeness.** Photo captions persist; cover choice becomes explicit; bulk-paste works in the simple modals; ingredient checkmarks can be reset; saved copies keep the full advanced recipe data and stop duplicating.

**F10 — Dead code & platform cleanup.** ~500+ lines of unreachable UI (desktop bottom-nav, empty native-plugin folder, dead sheets/props/wrappers) are removed; an obsolete iOS capability flag is corrected; the photos permission prompt becomes the gentler read-only variant.

**F11 — Wire the lost personalization.** A fully built rich-context system (your top cuisines, friends' scores, followed experts) is computed on every city page but never handed to the AI assistant — connecting it makes answers like "Mira has this at 9.4" actually possible, as the server prompt already expects.
