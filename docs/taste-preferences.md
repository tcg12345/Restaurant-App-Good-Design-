# Taste profile settings

Settings → Home & personalization → Taste profile opens `/settings/taste`.
Settings search also finds the editor. The earned profile remains at
`/profile/taste`, linked separately from the editor.

Users can edit preferred and less-preferred cuisines, usual price ranges,
restaurant/cooking focus, discovery style, atmosphere, default AI city,
eating preferences, cooking time, and private notes. Save commits the draft;
Discard restores saved values. Clear stages an empty preference record for
the next Save. The AI entry prepares an editable assistant request, which the
user sends in the existing chat. Unsaved manual edits must first be saved or
discarded. AI uses an allowlisted partial update of the same record.

## Where preferences are used

| Surface | Effect |
| --- | --- |
| Discover / restaurant recommendations | Cuisine, budget and discovery style affect ranking; cuisine, atmosphere and eating preferences inform candidate searches. |
| Location recommendations / map suggestions | The same restaurant engine uses current preferences, including when ranking a cached candidate pool. |
| Home ideas | Food preferences affect the relevance of restaurant and recipe highlights. App focus adjusts the balance of cooking and dining ideas. |
| Home Guides | Rotating guides are ordered using cuisine matches in known titles and the restaurant/recipe guide type. All guides remain available. |
| Recipe discovery / Recipes for You | Matching cuisine and eating tags receive a boost. Known prep + cook times inform time preference matching. Explicit sorting still works. |
| AI assistant | Receives stated preferences separately from historical evidence, including atmosphere, default city and freeform notes. Can save only allowed preference fields. |
| AI recipes | Saved preferences inform generation, brainstorms and combined ideas. The current prompt and selected cooking guidelines take priority. |
| Decide Together | Verified room members' structured preferences inform server-side matching. The room's current cuisine and budget choices override saved defaults. Account notes never enter shared room data or the group's AI prompt. |

Search-time choices override saved defaults without persisting changes.
An actively selected location wins over the default AI city. Personal notes
are interpreted by AI; deterministic ranking uses structured fields and
available metadata. Missing recipe times/tags are not invented. Dietary
preferences do not certify restaurant menus. Explicit search filters,
chronological feeds, real ratings and historical recap statistics retain
their own meaning.

## Storage and history separation

`useTastePreferences` reads the private `user_app_data.restaurant_meta`
entry `__taste_preferences_v1__`. Records contain version, owner ID, edit
timestamp and sanitized values. Existing authenticated metadata sync provides
local persistence and cloud sync; hydration picks the newer valid account
record. Account checks reject records from another user. Initial defaults
come only from this account's onboarding profile row, never a device-wide
guest mirror. An empty saved record prevents old onboarding answers from
returning as recommendation defaults.

The public `user_profiles.taste_profile` is not changed. Ratings, visits,
earned points, grading statistics, public taste profiles and GoodEats in
Review are not rewritten. Historical builders do not receive these private
overrides. Recommendation cache keys use a digest of ranking fields, never
the private prose. No schema migration or new public data field is needed.

Cloud persistence follows the existing metadata sync lifecycle. A local save
is immediate; it is not a server acknowledgement. Offline changes sync when
connectivity and account hydration resume. Simultaneous multi-device edits
use the existing blob sync and timestamp merge, not collaborative field-level
editing.

## Validation

- Full suite: 1,013 tests passed across 70 files. TypeScript and production
  build passed; the production assets were synced to iOS. Existing bundle
  size and mixed-import warnings remain.
- Tests cover sanitation, account ownership, timestamp merging, partial AI
  edits and clearing, quiz defaults, historical invariants, preference-based
  retrieval/ranking, transient request priority, guide/recipe scoring, and
  private cache keys. The generated group scorer is checked for parity.
- Browser fixture: `scripts/taste-settings-preview.html`. Cuisine search,
  save/discard and AI handoff were exercised without changing a real account.
  Light/dark layouts were checked at phone widths, including 320 px with no
  horizontal overflow.
- `location-chat` and `group-swipe` were deployed to the configured Supabase
  project on September 6, 2026. Both returned HTTP 401 to unauthenticated
  POSTs after deployment.
- Authenticated AI execution, cross-device sync and a physical iPhone session
  still require acceptance testing with a test account/device.
