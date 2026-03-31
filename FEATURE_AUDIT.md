# FEATURE AUDIT — Gourmet Canvas

Generated 2026-03-29. Pre-implementation audit for the next 6 planned features.

---

## 1. ARCHITECTURE SUMMARY

### State Flow: Contexts → Hooks → UI

The app uses three React contexts provided at the root (`App.tsx`):

1. **AuthContext** (`src/contexts/AuthContext.tsx`) — Wraps Supabase Auth. Exposes `user`, `profile`, `isSignedIn`, `profileComplete`, `pendingRequestCount`. All methods use `useCallback`. The `loadProfile` effect runs on auth state changes.

2. **SettingsContext** (`src/contexts/SettingsContext.tsx`) — Lightweight. Provides `phoneMode` (toggle between phone-frame and full-screen layouts) and `hideBottomNav` (controlled by child components like Map.tsx when filter overlays are open).

3. **ListsContext** (`src/contexts/ListsContext.tsx`) — Central state manager. Owns: `ratings`, `lists`, `wishlist`, `restaurantMeta`, `trips`, and all modal open/close state. Every mutation method follows the same pattern:
   - `setX(prev => { const next = ...; saveToStorage(key, next); syncXToCloud(next); return next; })`
   - `useCallback` wraps every method.
   - `userIdRef` and `isPublicRef` are used inside callbacks to avoid stale closures.

Provider nesting order (outermost first): `Router > AuthProvider > SettingsProvider > ListsProvider > AppContent`.

### Data Persistence: Dual-Write (localStorage + Supabase)

**Per-user private data** is stored in the `user_app_data` table as JSONB columns (one row per user):
- `ratings` (JSONB array of `RestaurantRating`)
- `lists` (JSONB array of `CustomList`)
- `wishlist` (JSONB array of `WishlistItem`)
- `restaurant_meta` (JSONB object keyed by place ID)
- `recent_views` (JSONB array)
- `trips` (JSONB array of `Trip`)

The persistence layer (`src/lib/supabase-db.ts`) uses `ensureRow()` before every partial update to guarantee the row exists. Full saves use `upsert` with `onConflict: 'user_id'`. Partial updates use `update().eq('user_id', ...)` to avoid clobbering other columns.

**localStorage keys** (cache, also serves offline-first):
| Key | Data |
|---|---|
| `gourmad-ratings` | RestaurantRating[] |
| `gourmad-lists` | CustomList[] |
| `gourmad-wishlist` | WishlistItem[] |
| `gourmad-restaurant-meta` | Record<string, RestaurantMeta> |
| `gourmad-trips` | Trip[] |
| `gourmad-recent-views` | RecentView[] |
| `gourmad-user-id` | Current user ID (for multi-account cache busting) |

On sign-in, `ListsContext` detects if the cached `gourmad-user-id` differs from the current user and clears all localStorage keys before loading cloud data. If cloud data exists, it overwrites local state; otherwise it starts fresh and saves empty state to cloud.

**Community/shared data** lives in separate Supabase tables (NOT JSONB):
| Table | Purpose | Key |
|---|---|---|
| `community_ratings` | Public rating feed | `(user_id, restaurant_id)` unique |
| `community_photos` | Photo gallery per restaurant | `(user_id, restaurant_id)` |
| `user_profiles` | Display names, usernames, bios | `user_id` PK, `username` unique |
| `user_friends` | Friend/follow relationships | `(user_id, friend_id)` unique |
| `activity_likes` | Likes on ratings | `(user_id, rating_id)` unique |
| `activity_comments` | Comments on ratings | FK to `community_ratings.id` |

### Modals

All modals are controlled via ListsContext state (e.g. `addRestaurantModalOpen`, `wishlistModalOpen`). They are rendered at the root level in `AppContent` (after `<Routes>`), so they overlay any page.

Modal animation pattern: `AnimatePresence` → outer backdrop (`motion.div`, `initial={{ opacity: 0 }}`) → inner sheet (`motion.div`, `initial={{ y: '100%' }}`, spring transition `damping: 30, stiffness: 300`). Content uses `AnimatePresence mode="wait"` for page transitions within the modal.

### Map Modes

`Map.tsx` supports 4 modes stored in `sessionStorage` key `map-mode`:
- **discover** — Google Places API search. Auto-fetches on load, shows "Search this area" button on pan.
- **myratings** — User's `community_ratings`. Filterable by list.
- **friends** — Friends' `community_ratings`. Filterable by friend.
- **experts** — Ratings from users with `is_expert=true`.

For non-discover modes, markers are created as DOM elements with inline SVG and inline `onclick` handlers using global `window` callback functions (cleaned up on popup close). The `navigateRef` / `openAddRestaurantModalRef` pattern is used to keep callback refs current.

---

## 2. EXISTING PATTERNS

### Data Persistence Pattern
- **Canonical file:** `src/contexts/ListsContext.tsx` (lines 368–401)
- **Convention:** Every state mutation does: `setState(prev => { const next = transform(prev); saveToStorage(key, next); syncToCloud(next); return next; })`. Cloud sync functions use `userIdRef.current` (not `userId` directly) to avoid stale closures. New data types need: a `STORAGE_KEY_*` constant, a `syncXToCloud` callback, state initialization from `loadFromStorage`, cloud load/save in the `useEffect` that fires on `userId` change, and the corresponding `saveX` function in `supabase-db.ts`.

### Modal Pattern (Multi-Page Bottom Sheet)
- **Canonical file:** `src/components/AddRestaurantModal.tsx`
- **Convention:** `type Page = 'main' | 'notes' | 'tags' | ...`. State is `page`, toggled via `setPage()`. Each page is wrapped in `<AnimatePresence mode="wait">`. The outer shell handles the backdrop + spring animation. Each sub-page uses a shared `<SubPage>` wrapper with a back button. A sticky `<BottomBtn>` sits at the bottom. All state resets in the `useEffect` that fires when modal opens.

### Map Marker Pattern
- **Canonical file:** `src/pages/Map.tsx` (lines 225–409 for discover, 600–673 for custom tabs)
- **Convention:** Markers are DOM elements created with `document.createElement`. Popup content is raw HTML set via `setHTML()`. Callbacks are registered on `window` with unique IDs and cleaned up on popup close. `markersRef` tracks active markers for cleanup. `syncMarkers()` handles diff-based add/remove with staggered fade-in animation.

### RLS Policy Pattern
- **Canonical file:** `supabase/migrations/001_create_user_app_data.sql`, `002_create_community_tables.sql`
- **Convention:** Every table has `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. Policies: users can SELECT/INSERT/UPDATE/DELETE their own rows (`auth.uid() = user_id`). Community tables also allow SELECT for all authenticated users. `ON DELETE CASCADE` for foreign keys referencing `auth.users(id)`.

### Social Feed Card Pattern
- **Canonical file:** `src/components/SocialFeed.tsx`
- **Convention:** Cards are `bg-white rounded-2xl border border-on-surface/8`. User header with avatar → restaurant card block (as Link to `/restaurant/:id`) → action bar (like, comment). Score colors: green `>= 8`, yellow `>= 5`, red `< 5`. Tags rendered as `text-[9px] px-1.5 py-0.5 rounded-full bg-primary/8 text-primary/60`. Likes/comments use optimistic updates with Supabase sync.

### Route & Provider Pattern
- **Canonical file:** `src/App.tsx`
- **Convention:** Routes defined in `<Routes>` inside `AppContent`. New pages need: a component, a `<Route>` entry, and optionally a BottomNav entry. Global modals (RatingModal, AddToListModal, AddRestaurantModal, WishlistModal) are rendered outside Routes. Auth guard redirects to SignIn if `!isSignedIn`, ProfileSetup if `!profileComplete`.

### Design System Tokens
- **Canonical file:** `src/index.css`
- **Convention:** Tailwind v4 `@theme` block defines: `--color-primary: #9f3012`, `--color-surface: #fff8f6`, `--color-on-surface: #1e1b1a`, `--color-secondary: #5c6144`, `--color-accent: #d4a373`, `--color-muted: #e5e1e0`. Font families: `--font-serif: "Noto Serif"` (headings), `--font-sans: "Manrope"` (body). The `.glass` class provides `bg-white/80 backdrop-blur-xl` for nav elements. `cn()` utility from `src/lib/utils.ts` for conditional class merging.

---

## 3. FEATURE MAP

### Feature 1: Expert Recommendations

Expert profiles with recommendation text, highlight dishes, and curated lists.

**Files to modify:**
- `src/pages/Experts.tsx` — Replace hardcoded `EXPERTS` array with real data from `user_profiles` where `is_expert=true`
- `src/pages/Circle.tsx` — Replace `MOCK_EXPERTS` array in the Experts tab with real data
- `src/lib/supabase-community.ts` — Add functions to fetch expert profiles, expert recommendations, expert lists
- `src/components/ExpertCard.tsx` — Update to accept real profile data instead of mock props
- `supabase/migrations/013_*.sql` — New table(s) for expert recommendations, highlight dishes

**Patterns to reuse:**
- Community data fetching pattern (separate Supabase tables, not JSONB)
- Social feed card pattern for recommendation display
- `getProfilesByIds` pattern for loading expert profiles
- `getExpertRatings` already exists as the data loading pattern

**Potential concerns:**
- `EXPERTS` in `Experts.tsx` and `MOCK_EXPERTS` in `Circle.tsx` have different shapes — need to unify under one real data type
- Expert recommendations are shared/community data → need separate Supabase table with RLS policies
- Need to decide: can any user become an expert, or is it admin-assigned? Currently `is_expert` is a boolean on `user_profiles`

### Feature 2: Hotel Dining

Tracking hotel restaurant and breakfast experiences, integrated with trips.

**Files to modify:**
- `src/contexts/ListsContext.tsx` — The `CustomList` type already has `type?: 'hotel-breakfast'`; may need additional hotel dining fields
- `src/pages/Pantry.tsx` — Already has hotel breakfast list support in `PRESET_LISTS`; need dedicated hotel dining views
- `src/components/AddRestaurantModal.tsx` — May need hotel-specific fields (hotel name, room service vs restaurant)
- `src/pages/RestaurantDetailMobile.tsx` / `RestaurantDetailDesktop.tsx` — Show hotel association if applicable
- `src/lib/places.ts` — Already has `searchHotels` function (imported in Pantry.tsx)

**Patterns to reuse:**
- Trip/hotel management (TripHotel type, addHotelToTrip, etc.)
- Custom list type field (`type: 'hotel-breakfast'` already exists)
- AddRestaurantModal multi-page pattern for hotel-specific detail entry
- localStorage + Supabase dual-write via ListsContext

**Potential concerns:**
- Hotels are already part of Trips. Need to clarify: is this about standalone hotel dining tracking, or extending the trip hotel feature?
- `TripHotel` already has fields like `starRating`, `confirmationNumber`, `notes` — may overlap
- The `searchHotels` function in `places.ts` is already imported but its full integration in the UI should be verified

### Feature 3: Rating History & Reordering

Tracking rating changes over time, drag-to-reorder lists.

**Files to modify:**
- `src/contexts/ListsContext.tsx` — Add rating history to `RestaurantRating` type (e.g. `history: { score: number; date: string }[]`), add list reorder method
- `src/pages/Pantry.tsx` — Add drag-to-reorder UI for lists and restaurant order within lists
- `src/pages/RestaurantDetailMobile.tsx` / `RestaurantDetailDesktop.tsx` — Show rating history timeline
- `src/components/AddRestaurantModal.tsx` — When updating, offer to preserve previous rating in history
- `src/lib/supabase-db.ts` — No structural changes needed (JSONB stores whatever shape)

**Patterns to reuse:**
- Photo drag-to-reorder in AddRestaurantModal (`dragIdx`, `movePhoto`, `GripVertical` icon) — reuse for list reordering
- `updateRating` already supports partial updates — extend with history append
- localStorage + Supabase persistence (JSONB, so schema changes are free)

**Potential concerns:**
- Adding `history` to `RestaurantRating` needs a migration function in `migrateRatings()` (like existing `listIds`, `photos` migrations)
- Drag-to-reorder on mobile needs careful touch handling (Pantry.tsx already imports `GripVertical` but doesn't use it for lists)
- Reordering needs to persist to both localStorage and Supabase on each change

### Feature 4: Home Cooking

Tracking home-cooked meals with recipes, ingredients, and ratings.

**Files to modify:**
- `src/contexts/ListsContext.tsx` — New types (HomeMeal, etc.), new state arrays, new CRUD methods, new localStorage key, new cloud sync
- `src/lib/supabase-db.ts` — New `saveHomeCooking` partial update, add column to `loadUserData`/`saveUserData`
- `supabase/migrations/013_*.sql` — Add `home_cooking` JSONB column to `user_app_data`
- `src/App.tsx` — New route for home cooking page
- `src/components/BottomNav.tsx` — Possibly add nav entry or nest under existing section
- New page file (e.g. `src/pages/HomeCooking.tsx`)
- New modal (following AddRestaurantModal pattern)

**Patterns to reuse:**
- ListsContext state management pattern (setState → saveToStorage → syncToCloud)
- AddRestaurantModal multi-page bottom sheet for logging a home meal
- Photo upload/compression pattern from AddRestaurantModal
- Score color convention (green >= 8, yellow >= 5, red < 5)

**Potential concerns:**
- This is per-user private data → goes in `user_app_data` JSONB
- Adding a new JSONB column requires a migration file and updating `loadUserData`/`saveUserData` with fallback handling (see trips pattern)
- Need to decide if home meals should have a community component (sharing recipes) — if so, needs a separate Supabase table

### Feature 5: Recipes

Recipe collection tied to restaurants and home cooking.

**Files to modify:**
- `src/contexts/ListsContext.tsx` — New Recipe type, state, CRUD methods
- `src/lib/supabase-db.ts` — New save function, update load/save
- `supabase/migrations/013_*.sql` or `014_*.sql` — New column or table
- New page file (e.g. `src/pages/Recipes.tsx`)
- `src/App.tsx` — New route
- Possibly `src/pages/RestaurantDetailMobile.tsx` / `RestaurantDetailDesktop.tsx` — Link recipes to restaurants

**Patterns to reuse:**
- ListsContext CRUD pattern
- Card UI pattern (rounded-2xl cards with image, title, metadata)
- Search/filter pattern from Pantry.tsx or UserProfile.tsx
- Photo upload for recipe images

**Potential concerns:**
- If recipes can be shared/public, they need a community table (not JSONB). If private-only, JSONB in `user_app_data` works
- Recipes might link to both restaurants and home cooking entries — need a flexible `sourceId`/`sourceType` scheme
- Recipe data could be large (ingredients, steps, photos) — watch JSONB payload size limits

### Feature 6: Group Chats

Real-time messaging between friends for restaurant planning.

**Files to modify:**
- `src/lib/supabase-community.ts` — New functions for chat CRUD, message send/receive
- `supabase/migrations/013_*.sql` — New tables: `group_chats`, `chat_members`, `chat_messages`
- New page file (e.g. `src/pages/GroupChat.tsx`)
- `src/pages/Circle.tsx` — Entry point to create/view group chats
- `src/App.tsx` — New route
- `src/components/BottomNav.tsx` — Badge for unread messages

**Patterns to reuse:**
- Activity comments pattern in SocialFeed.tsx (text input + send button, optimistic updates)
- Friend list loading from Circle.tsx (`getFriends`, `getProfilesByIds`)
- Bottom sheet pattern for chat creation (selecting friends)
- `user_friends` table for membership validation

**Potential concerns:**
- This is the most complex feature — requires real-time subscriptions (`supabase.channel().on('postgres_changes', ...)`)
- Message tables need careful RLS: users can only read messages from chats they're members of
- Need `ON DELETE CASCADE` from `auth.users` to chat members, and from chats to messages
- Typing indicators and read receipts add significant complexity
- Push notifications would require additional infrastructure

---

## 4. MOCK DATA INVENTORY

All hardcoded mock/fake data arrays that need to be replaced with real Supabase data:

| Location | Variable | Description |
|---|---|---|
| `src/pages/Experts.tsx:7` | `EXPERTS` | 4 hardcoded expert profiles (Elena Vance, Marcus Thorne, Sofia Rossi, Julian Chen) with Unsplash images |
| `src/pages/Experts.tsx:34` | `RECENT_REVIEWS` | 2 hardcoded expert review objects with fake restaurant names and comments |
| `src/pages/Circle.tsx:12` | `MOCK_EXPERTS` | 3 hardcoded expert profiles (Elena Vance, Marcus Thorne, Sofia Rossi) — subset of Experts.tsx data |
| `src/components/CircleActivity.tsx:29` | `MOCK_CIRCLE_RESTAURANTS` | 12 hardcoded restaurant entries with fake friend/expert attributions, Unsplash images |
| `src/components/RatingModal.tsx:148` | `MOCK_FRIENDS` | 10 hardcoded friend name strings (Alex Chen, Maria Garcia, etc.) |

**Note:** `DEFAULT_LISTS` in `ListsContext.tsx:199` and `PRESET_LISTS` in `Pantry.tsx:17` / `AddRestaurantModal.tsx:217` are intentional presets (not mock data to replace), as they provide starter list suggestions for new users.

---

## 5. CURRENT MIGRATION COUNT

**Highest-numbered migration:** `012_add_trips_column.sql`

**New migrations should start from:** `013_*.sql`

Complete migration history:
| # | File | Purpose |
|---|---|---|
| 001 | `create_user_app_data.sql` | Core JSONB per-user data table |
| 002 | `create_community_tables.sql` | `community_ratings`, `community_photos`, `user_friends` |
| 003 | `create_user_profiles.sql` | `user_profiles` with username uniqueness |
| 004 | `add_friend_request_status.sql` | Status field on `user_friends` |
| 005 | `add_bio_to_profiles.sql` | Bio column on `user_profiles` |
| 006 | `add_public_to_profiles.sql` | `is_public` boolean on `user_profiles` |
| 007 | `add_friend_ids_to_community_ratings.sql` | `friend_ids` array on `community_ratings` |
| 008 | `allow_read_user_app_data.sql` | RLS policy for reading other users' data |
| 009 | `add_coords_to_community_ratings.sql` | `lat`, `lng` on `community_ratings` |
| 010 | `create_likes_comments.sql` | `activity_likes`, `activity_comments` tables |
| 011 | `add_expert_to_profiles.sql` | `is_expert` boolean on `user_profiles` |
| 012 | `add_trips_column.sql` | `trips` JSONB column on `user_app_data` |
