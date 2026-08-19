import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, Camera, ChevronLeft, ChevronDown, ChevronRight, DollarSign, CalendarDays, Tag, StickyNote, Image, Users, Search, GripVertical, Star, Sparkles, RotateCcw, ChefHat, Trash2, Loader2, Lock } from 'lucide-react';
import { cn, localISODate } from '../lib/utils';
import { compressImage } from '../lib/images';
import { dropDeadPhotos } from '../lib/pendingPhotos';
import { scoreColorLight, scoreRingColor, scoreBgGradient } from '../lib/score';
import { useLists, type PhotoItem, type RestaurantRating } from '../contexts/ListsContext';
import { settleScores, tierOfScore } from '../lib/settleScores';
import { useSettings } from '../contexts/SettingsContext';
import { ALL_TAGS, PRICE_RANGES, priceIndexFromAmount, EMOJI_OPTIONS, Calendar } from './RatingShared';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { CuisinePicker, EditableCuisineLine } from './CuisinePicker';
import { submitCuisineSuggestion } from '../lib/supabase-cuisine-suggestions';
import { getFriends, getProfilesByIds, getVisitHistory, type UserProfile, type FriendInfo } from '../lib/supabase-community';
import { useBottomSheet } from '../lib/useBottomSheet';
import { useSubmitOnce } from '../lib/useSubmitOnce';
import { useDeferredFocus } from '../lib/useDeferredFocus';
import { type H2HState, initH2HTieBreak, placementOrder, TIER_LABELS } from '../lib/headToHeadRating';
import { InlineH2H, RankingContext, rankAmong } from './HeadToHeadRatingPages';
import { SCORE_UNLOCK_THRESHOLD } from '../lib/scoreUnlock';

type Page = 'rate' | 'main' | 'notes' | 'tags' | 'photos' | 'price' | 'date' | 'friends' | 'favorite-dishes';

export const AddRestaurantModal: React.FC = () => {
  const {
    addRestaurantModalOpen, addRestaurantModalMeta, addRestaurantModalInitialPage, closeAddRestaurantModal,
    rateRestaurant, getRating, removeRating,
    lists, createList, ratings, getRestaurantInfo, scoresUnlocked,
  } = useLists();
  const { phoneMode } = useSettings();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { dragProps } = useBottomSheet(addRestaurantModalOpen, closeAddRestaurantModal);
  // Double-tapping Save during the sheet's exit animation must not save
  // twice — the second isNewVisit save archives the first as a phantom visit.
  const { submitting: saving, tryLock } = useSubmitOnce(addRestaurantModalOpen);

  // Real friends
  const [realFriends, setRealFriends] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      const fl = await getFriends(user.id);
      if (fl.length > 0) {
        const profiles = await getProfilesByIds(fl.map((f) => f.friend_id));
        setRealFriends(fl.map((f) => ({ id: f.friend_id, name: profiles[f.friend_id]?.display_name || profiles[f.friend_id]?.username || f.friend_id.slice(0, 8) })));
      }
    })();
  }, [user?.id]);

  const restaurant = addRestaurantModalMeta;
  const existing = restaurant ? getRating(restaurant.id) : undefined;

  const [score, setScore] = useState(7);
  const [notes, setNotes] = useState('');
  /** A cuisine this user has just proposed for this place. Display only —
   *  it is NOT written into the rating being saved. Rating a place is when
   *  someone most reliably knows what it serves, which is why the control
   *  is here, but a suggestion changes nothing until it's reviewed. */
  const [suggestedCuisine, setSuggestedCuisine] = useState('');
  const [cuisinePickerOpen, setCuisinePickerOpen] = useState(false);
  const [visitDate, setVisitDate] = useState(localISODate());
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [priceIndex, setPriceIndex] = useState(-1);
  const [priceAmount, setPriceAmount] = useState('');
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [favoriteDishes, setFavoriteDishes] = useState<string[]>([]);
  const [dishDraft, setDishDraft] = useState('');
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');

  const [listDropdownOpen, setListDropdownOpen] = useState(false);
  const [creatingList, setCreatingList] = useState(false);
  const [newListSheetOpen, setNewListSheetOpen] = useState(false);
  const [newListMode, setNewListMode] = useState<'browse' | 'custom'>('browse');
  const [newListSearch, setNewListSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('📋');

  const [page, setPage] = useState<Page>('main');
  // Focus the sub-page fields only after the slide-in settles — a bare
  // autoFocus popped the keyboard mid-animation and the two fought.
  const notesFocusRef = useDeferredFocus<HTMLTextAreaElement>(page === 'notes');
  const dishFocusRef = useDeferredFocus<HTMLInputElement>(page === 'favorite-dishes');
  // Which sub-flow the Rate page shows. Head-to-head is THE rating method;
  // the slider lives behind the quiet "choose my own score" link.
  const [rateMode, setRateMode] = useState<'h2h' | 'slider'>('h2h');
  // How the CURRENT score value was produced this session. null = untouched
  // (editing details of an existing rating) — the save preserves the
  // rating's existing method so a note edit can't change provenance.
  const [sessionMethod, setSessionMethod] = useState<'h2h' | 'slider' | null>(null);
  // Active head-to-head session state. null before a sentiment is picked.
  const [h2hState, setH2hState] = useState<H2HState | null>(null);
  // The completed head-to-head's raw score. Once set, the score is LOCKED —
  // there is no slider hand-off; changing it means re-ranking.
  const [h2hScore, setH2hScore] = useState<number | null>(null);
  // Settled preview of the H2H score (what actually lands after the tier
  // rebalances) — shown on the details page's score chip.
  const [settledDisplay, setSettledDisplay] = useState<number | null>(null);
  // Exact descending placement from the completed head-to-head — captured at
  // completion (the state itself is cleared) and passed to the settle so a
  // score collision can't invert the order the comparisons decided.
  const [h2hOrder, setH2hOrder] = useState<string[] | null>(null);
  // When true, the running H2H is a tie-break triggered by Save on the
  // slider — completing it auto-saves with the refined score instead of
  // returning the user to the slider.
  const [tieBreakActive, setTieBreakActive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isNewVisit, setIsNewVisit] = useState(false);
  const [visitCount, setVisitCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  // Photos still being compressed. Previews (object URLs) land in state the
  // instant the picker closes; each is swapped for its compressed inline
  // JPEG as it finishes. Saving is blocked until this hits zero so a fast
  // Save can never race the pipeline and lose photos.
  const [photosProcessing, setPhotosProcessing] = useState(0);
  // Auto-share, opt-out. ON by default so a rating reaches the people who
  // follow you without a second decision; flipping it off keeps the score
  // in your own list only. Imports never reach here (they bypass the modal).
  const [shareToFeed, setShareToFeed] = useState(true);
  const previewUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (addRestaurantModalOpen && restaurant) {
      // The override belongs to the restaurant, not the session — clear it
      // whenever the modal opens on a different one.
      setSuggestedCuisine('');
      setCuisinePickerOpen(false);
      const ex = getRating(restaurant.id);
      const startAsNewVisit = addRestaurantModalInitialPage === 'new-visit';
      if (startAsNewVisit && ex) {
        // New visit: start fresh but keep restaurant context
        setScore(7);
        setNotes('');
        setVisitDate(localISODate());
        setSelectedTags([]);
        setPhotos([]);
        setFavoriteDishes([]);
        setSelectedListIds(ex.listIds ?? []);
        setSelectedFriends([]);
      } else {
        setScore(ex?.score ?? 7);
        setNotes(ex?.notes ?? '');
        // First-ever rating defaults to today — `''` would save as "No date".
        // Editing keeps whatever the record holds (including deliberately unset).
        setVisitDate(ex ? (ex.visitDate ?? '') : localISODate());
        setSelectedTags(ex?.tags ?? []);
        setPhotos(ex?.photos ?? []);
        setFavoriteDishes(ex?.favoriteDishes ?? []);
        setSelectedListIds(ex?.listIds ?? []);
        setSelectedFriends(ex?.friendIds ?? []);
      }
      setDishDraft('');
      setIsNewVisit(startAsNewVisit);
      // Auto-share is the default every time the flow opens — opting out is
      // a per-save choice, not a sticky preference.
      setShareToFeed(true);
      // A previous session's in-flight previews are dead weight now.
      for (const u of previewUrlsRef.current) URL.revokeObjectURL(u);
      previewUrlsRef.current.clear();
      setPhotosProcessing(0);
      // Restore the saved price when editing — resetting to -1 made "Update"
      // silently revert a hand-picked price back to the meta default. A new
      // visit keeps it too: the restaurant's price tier doesn't change
      // between visits, and resetting overwrote a hand-picked $$$$ with the
      // meta price on save.
      setPriceIndex(ex?.price ? PRICE_RANGES.findIndex((pr) => pr.signs === ex.price) : -1);
      setPriceAmount('');
      // Where the modal opens:
      // - NEW rating (or Log New Visit) → the Rate page: the score comes
      //   first, details after. Head-to-head is the default method.
      // - EDITING an existing rating → the details page; the score shows as
      //   a locked chip with "Re-rank" (fresh comparisons) as the way to
      //   change it. A caller-requested sub-page ('notes' etc.) still wins.
      // NOTE: `initialPage` doubles as a mode hint — 'new-visit' means "open
      // in Log-New-Visit mode" (handled via `startAsNewVisit` above), NOT a
      // sub-page; anything that isn't a real Page falls back to the default.
      const VALID_PAGES: Page[] = ['main', 'notes', 'tags', 'photos', 'price', 'date', 'friends', 'favorite-dishes'];
      const requestedInitial = addRestaurantModalInitialPage as Page | null;
      const isFreshRating = !ex || startAsNewVisit;
      if (requestedInitial && requestedInitial !== 'main' && VALID_PAGES.includes(requestedInitial) && ex && !startAsNewVisit) {
        setPage(requestedInitial);
      } else {
        setPage(isFreshRating ? 'rate' : 'main');
      }
      setRateMode('h2h');
      setSessionMethod(null);
      setH2hState(null);
      setH2hScore(null);
      setH2hOrder(null);
      setSettledDisplay(null);
      setTieBreakActive(false);
      setConfirmDelete(false);
      setCreatingList(false);
      setNewListSheetOpen(false);
      setNewListMode('browse');
      setNewListSearch('');
      setNewName('');
      setListDropdownOpen(false);
      setTagSearch('');
      setFriendSearch('');
      // Fetch visit count
      if (ex && user?.id) {
        getVisitHistory(user.id, restaurant.id).then((h) => setVisitCount(h.length));
      } else {
        setVisitCount(0);
      }
    }
  }, [addRestaurantModalOpen, restaurant]);

  // Toggling between Log New Visit and Update Current changes the visit
  // context — any in-progress or completed head-to-head no longer applies.
  // Called from the toggle buttons (not an effect: the modal is mounted
  // once globally, and an isNewVisit effect re-firing across opens could
  // clobber the open logic's page choice).
  const resetRatingSession = (nextPage: Page) => {
    setRateMode('h2h');
    setSessionMethod(null);
    setH2hState(null);
    setH2hScore(null);
    setH2hOrder(null);
    setSettledDisplay(null);
    setTieBreakActive(false);
    setPage(nextPage);
  };

  const toggleTag = (tag: string) => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  const toggleList = (listId: string) => setSelectedListIds((prev) => prev.includes(listId) ? prev.filter((id) => id !== listId) : [...prev, listId]);
  const toggleFriend = (name: string) => setSelectedFriends((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);

  const handlePriceSignClick = (idx: number) => { setPriceIndex(idx); setPriceAmount(''); };
  const handlePriceAmountChange = (val: string) => {
    setPriceAmount(val);
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) setPriceIndex(priceIndexFromAmount(num));
  };

  // No pick and no meta price → persist '' (unset); fabricating '$$' would
  // stamp a made-up tier on the rating.
  const resolvedPrice = priceIndex >= 0 ? PRICE_RANGES[priceIndex].signs : (restaurant?.price || '');
  const resolvedCuisine = restaurant?.cuisine || '';

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    const totalFiles = files ? (Array.from(files) as File[]).filter((f) => f.type.startsWith('image/')) : [];
    e.target.value = '';
    if (totalFiles.length === 0) return;

    // The old pipeline compressed AND uploaded every photo to Storage before
    // the Photos page even appeared — 20 screenshots meant 20 sequential
    // network round-trips of dead air, during which Save could fire without
    // them. Now: object-URL previews land in state IMMEDIATELY and the page
    // opens; each preview is swapped for its compressed inline JPEG as it
    // finishes (a small pool — parallel decodes of 12MP camera files spike
    // memory); the Storage upload happens AFTER save via the pending-photo
    // retry pass (an inline data: URL *is* that queue's membership card).
    const staged = totalFiles.map((file) => {
      const preview = URL.createObjectURL(file);
      previewUrlsRef.current.add(preview);
      return { file, preview };
    });
    setPhotos((prev) => [...prev, ...staged.map((s): PhotoItem => ({ url: s.preview, caption: '', isFavorite: false }))]);
    setPage('photos');
    setPhotosProcessing((n) => n + staged.length);

    const queue = [...staged];
    const worker = async () => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        try {
          const dataUrl = await compressImage(item.file);
          // Swap by URL identity — reorders/caption edits/deletes made while
          // compressing can't mis-target. A deleted preview simply matches
          // nothing and the result is discarded.
          setPhotos((prev) => prev.map((p) => (p.url === item.preview ? { ...p, url: dataUrl } : p)));
        } catch {
          // Undecodable (e.g. HEIC on a browser that can't) — drop the preview.
          setPhotos((prev) => prev.filter((p) => p.url !== item.preview));
        } finally {
          window.setTimeout(() => URL.revokeObjectURL(item.preview), 1000);
          previewUrlsRef.current.delete(item.preview);
          setPhotosProcessing((n) => Math.max(0, n - 1));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, staged.length) }, () => worker()));
  };

  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));
  const updatePhotoCaption = (idx: number, caption: string) => setPhotos((prev) => prev.map((p, i) => i === idx ? { ...p, caption } : p));
  const togglePhotoFavorite = (idx: number) => setPhotos((prev) => prev.map((p, i) => i === idx ? { ...p, isFavorite: !p.isFavorite } : p));
  const movePhoto = (from: number, to: number) => {
    setPhotos((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  // Photo button: if no photos, open picker. If photos exist, go to edit page.
  const handlePhotosClick = () => {
    if (photos.length === 0) {
      fileInputRef.current?.click();
    } else {
      setPage('photos');
    }
  };

  // Fires when the user misses a required field (currently: no visit
  // date on a Log New Visit save) so the Date sub-page opens and the
  // save button briefly shakes.
  const [dateError, setDateError] = useState(false);

  // Pure preview of what a raw H2H score becomes once the tier settles
  // around it — mirrors the settle rateRestaurant runs on save, so the
  // result dial shows the value that will actually land in the list.
  const previewSettledScore = (rawScore: number): number => {
    if (!restaurant) return rawScore;
    const self: RestaurantRating = {
      restaurantId: restaurant.id, name: restaurant.name, image: restaurant.image,
      cuisine: resolvedCuisine, price: resolvedPrice, address: restaurant.address,
      score: rawScore, notes: '', visitDate: '', wouldReturn: true, tags: [], photos: [],
      listIds: [], friendIds: [], createdAt: 0,
    };
    const change = settleScores(
      [self, ...ratings.filter((r) => r.restaurantId !== self.restaurantId)],
      {
        justRatedId: self.restaurantId,
        previousScore: existing ? existing.score : undefined,
        explicitOrder: h2hState ? placementOrder(h2hState, self.restaurantId, rawScore) : undefined,
      },
    ).find((c) => c.restaurantId === self.restaurantId);
    return change ? change.score : rawScore;
  };

  const persistRating = (finalScore: number, orderOverride?: string[]) => {
    if (!restaurant || !tryLock()) return;
    // The H2H placement order binds whenever the score being saved is the
    // one the search produced (post-H2H the score is locked, so it always
    // is — the equality check is a defensive invariant, not a UX path).
    const settleOrder =
      orderOverride ??
      (h2hOrder && h2hScore !== null && finalScore === h2hScore ? h2hOrder : undefined);
    rateRestaurant(
      {
        restaurantId: restaurant.id, name: restaurant.name, image: restaurant.image,
        cuisine: resolvedCuisine, price: resolvedPrice, address: restaurant.address,
        score: finalScore, notes, visitDate, wouldReturn: isNewVisit ? true : (existing?.wouldReturn ?? true), tags: selectedTags,
        // blob: previews are session-scoped — they'd be dead links after a
        // reload. Save is blocked while any remain; this filter is the
        // safety net for programmatic saves (tie-break auto-save). It also
        // drops dead entries (url '') left by an old sync bug, so editing a
        // poisoned rating heals it instead of re-persisting blank tiles.
        photos: dropDeadPhotos(photos),
        favoriteDishes: favoriteDishes.length > 0 ? favoriteDishes : undefined,
        listIds: selectedListIds, friendIds: selectedFriends, createdAt: Date.now(),
        // Provenance: how THIS session produced the score. A details-only
        // edit (sessionMethod null) preserves whatever the rating had —
        // fixing a typo must never change how a score counts.
        ratingMethod: sessionMethod ?? existing?.ratingMethod,
      },
      // Only archive the existing rating into visit history when the
      // user is on the "Log New Visit" tab. The "Update Current" tab
      // edits the existing record in place and shouldn't manufacture
      // a phantom visit.
      { isNewVisit, settleOrder, shareToFeed },
    );
    closeAddRestaurantModal();
  };

  const handleSaveRating = () => {
    if (!restaurant) return;
    // Photos still compressing — saving now would drop them. The button is
    // disabled in this state; this guard covers keyboard/programmatic paths.
    if (photosProcessing > 0) {
      setPage('photos');
      return;
    }
    // A brand-new rating can't save without a score having been produced.
    if (!existing && sessionMethod === null) {
      setPage('rate');
      return;
    }
    // A visit date is required when logging a new visit — without it
    // we can't sort the visit correctly in the history timeline and
    // the card above the visit list would render with a blank date.
    if (isNewVisit && !visitDate) {
      setDateError(true);
      setPage('date');
      return;
    }
    // Slider tie-break: a self-picked score that ties with existing rated
    // restaurants forces a quick H2H against just the tied ones so the new
    // rating lands in the right spot relative to them. (The rating still
    // counts as slider-made — the comparisons only refine its ORDER.)
    if (sessionMethod === 'slider') {
      const tieBreakState = initH2HTieBreak(ratings, score, restaurant.id);
      if (tieBreakState) {
        setH2hState(tieBreakState);
        setRateMode('h2h');
        setTieBreakActive(true);
        setPage('rate');
        return;
      }
    }
    persistRating(score);
  };

  // Clear the date-error state as soon as the user picks one.
  useEffect(() => { if (visitDate) setDateError(false); }, [visitDate]);

  const handleCreateList = () => {
    if (!newName.trim()) return;
    createList(newName.trim(), newEmoji);
    setNewName(''); setNewEmoji('📋'); setCreatingList(false);
  };

  const scoreClr = scoreColorLight(score);
  const scoreBg = scoreBgGradient(score);
  const scoreRing = scoreRingColor(score);

  const hasNotes = notes.trim().length > 0;
  const hasPrice = priceIndex >= 0;
  const hasTags = selectedTags.length > 0;
  const hasPhotos = photos.length > 0;
  const hasDishes = favoriteDishes.length > 0;
  const hasFriends = selectedFriends.length > 0;
  const hasDate = visitDate !== '';
  const dateLabel = hasDate ? new Date(visitDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : undefined;

  const addDish = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    setFavoriteDishes((prev) => prev.includes(v) ? prev : [...prev, v]);
    setDishDraft('');
  };
  const removeDish = (idx: number) => setFavoriteDishes((prev) => prev.filter((_, i) => i !== idx));

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) return ALL_TAGS;
    const q = tagSearch.toLowerCase();
    return ALL_TAGS.filter((t) => t.toLowerCase().includes(q));
  }, [tagSearch]);

  const filteredFriends = useMemo(() => {
    if (!friendSearch.trim()) return realFriends;
    const q = friendSearch.toLowerCase();
    return realFriends.filter((f) => f.name.toLowerCase().includes(q));
  }, [friendSearch, realFriends]);

  const selectedListLabels = lists.filter((l) => selectedListIds.includes(l.id));

  // Hidden file input for photos
  const photoInput = <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />;

  const PRESET_LISTS_MODAL = [
    { name: 'Best Date Night Spots', emoji: '🕯️' }, { name: 'Birthday & Celebrations', emoji: '🎂' },
    { name: 'Late Night Eats', emoji: '🌙' }, { name: 'Solo Dining Friendly', emoji: '🧘' },
    { name: 'Group Dinner & Big Tables', emoji: '👥' }, { name: 'Hidden Gems', emoji: '💎' },
    { name: 'Worth the Hype', emoji: '🔥' }, { name: 'Best Burgers', emoji: '🍔' },
    { name: 'Best Pizza', emoji: '🍕' }, { name: 'Best Sushi & Omakase', emoji: '🍣' },
    { name: 'Best Brunch', emoji: '🥞' }, { name: 'Best Cocktails', emoji: '🍸' },
    { name: 'Michelin Star Experiences', emoji: '⭐' }, { name: 'Best Tasting Menus', emoji: '🍽️' },
    { name: 'Quick Bites', emoji: '⚡' }, { name: 'Healthy Options', emoji: '🥗' },
    { name: 'Vacation Eats', emoji: '🏖️' },
  ];
  const existingListNames = new Set(lists.map((l) => l.name.toLowerCase()));
  const filteredPresetLists = newListSearch.trim()
    ? PRESET_LISTS_MODAL.filter((p) => p.name.toLowerCase().includes(newListSearch.toLowerCase()))
    : PRESET_LISTS_MODAL;

  const handleCreateFromPreset = (name: string, emoji: string) => {
    createList(name, emoji);
    setNewListSheetOpen(false); setNewListMode('browse'); setNewListSearch('');
  };
  const handleCreateCustomFromSheet = () => {
    if (!newName.trim()) return;
    createList(newName.trim(), newEmoji);
    setNewListSheetOpen(false); setNewListMode('browse'); setNewName(''); setNewEmoji('📋');
  };

  return (
    <>
    <AnimatePresence>
      {addRestaurantModalOpen && restaurant && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center",
            phoneMode ? "items-end" : "items-end sm:items-center"
          )}
          onClick={closeAddRestaurantModal}
        >
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            {...dragProps}
            onClick={(e) => e.stopPropagation()}
            className={cn("bg-surface w-full overflow-hidden flex flex-col kb-pad",
              phoneMode
                ? "h-full rounded-none"
                // The Rate page hugs its content on desktop — a floating
                // dialog, not a full-height sheet with dead space.
                : page === 'rate'
                  ? "h-full sm:h-auto sm:min-h-[560px] sm:max-w-md sm:max-h-[92vh] rounded-none sm:rounded-3xl"
                  : "h-full sm:max-w-md sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl"
            )}
          >
            {photoInput}
            <AnimatePresence mode="wait">
              {/* ═══════════ RATE PAGE — the score comes first ═══════════
                  Sentiment → head-to-head comparisons → reveal (locked
                  score), or the slider behind "choose my own score".
                  Details live on the next page. */}
              {page === 'rate' && (
                <motion.div key="rate" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                  className="relative flex flex-col flex-1 min-h-0 bg-on-surface/[0.025]">
                  {/* Floating chrome — the step content owns the page. */}
                  {existing && !tieBreakActive && (
                    <button
                      onClick={() => setPage('main')}
                      aria-label="Back to details"
                      style={{ top: 'max(1.25rem, env(safe-area-inset-top))' }}
                      className="absolute left-5 z-10 w-9 h-9 rounded-full bg-surface shadow-[0_2px_10px_-2px_rgba(28,24,22,0.14)] ring-1 ring-on-surface/[0.05] flex items-center justify-center text-on-surface/50 hover:text-on-surface transition-colors"
                    >
                      <ChevronLeft size={18} />
                    </button>
                  )}
                  <button onClick={closeAddRestaurantModal} aria-label="Close"
                    style={{ top: 'max(1.25rem, env(safe-area-inset-top))' }}
                    className="absolute right-5 z-10 w-9 h-9 rounded-full bg-surface shadow-[0_2px_10px_-2px_rgba(28,24,22,0.14)] ring-1 ring-on-surface/[0.05] flex items-center justify-center text-on-surface/50 hover:text-on-surface transition-colors">
                    <X size={17} />
                  </button>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-16 flex flex-col">
                    {tieBreakActive && (
                      <div className="pt-2 pb-3 text-center">
                        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary/70 mb-1.5">Tie-break</p>
                        <p className="text-[12px] text-on-surface/55 max-w-[280px] mx-auto leading-snug">
                          You picked {score.toFixed(1)} — let's see how it compares to your other {score.toFixed(1)}s.
                        </p>
                      </div>
                    )}
                    <AnimatePresence mode="wait" initial={false}>
                      {rateMode === 'h2h' ? (
                        <motion.div key="h2h-flow" initial={false} className="flex-1 flex flex-col">
                          <InlineH2H
                            ratings={ratings}
                            excludeId={restaurant.id}
                            newRestaurant={{ ...restaurant, tags: selectedTags }}
                            resolveMeta={getRestaurantInfo}
                            settlePreview={previewSettledScore}
                            scoresUnlocked={scoresUnlocked}
                            heading={{
                              eyebrow: existing && isNewVisit ? `New visit${visitCount > 0 ? ` · #${visitCount + 2}` : ''}` : existing ? 'Re-rank' : 'Rate',
                              title: `How was ${restaurant.name}?`,
                            }}
                            state={h2hState}
                            setState={setH2hState}
                            skipTierSelect={tieBreakActive}
                            skipResult={tieBreakActive}
                            onChooseOwnScore={tieBreakActive ? undefined : () => { setRateMode('slider'); setH2hState(null); }}
                            onCancelFromStart={tieBreakActive ? () => {
                              // Backing out of a tie-break returns to the
                              // slider so the score can be nudged instead.
                              setTieBreakActive(false);
                              setH2hState(null);
                              setRateMode('slider');
                            } : undefined}
                            onComplete={(finalScore) => {
                              // Capture the search's exact placement BEFORE
                              // the state is cleared — the settle needs it to
                              // keep the decided order through score ties.
                              const order = h2hState && restaurant
                                ? placementOrder(h2hState, restaurant.id, finalScore)
                                : null;
                              if (tieBreakActive) {
                                // Tie-break completion auto-saves with the
                                // refined score — the rating stays slider-made.
                                setTieBreakActive(false);
                                setH2hState(null);
                                persistRating(finalScore, order ?? undefined);
                                return;
                              }
                              // The head-to-head result is FINAL — no slider
                              // hand-off. Continue to the details page.
                              setScore(finalScore);
                              setH2hScore(finalScore);
                              setH2hOrder(order);
                              setSettledDisplay(previewSettledScore(finalScore));
                              setSessionMethod('h2h');
                              setH2hState(null);
                              setPage('main');
                            }}
                          />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="slider-step"
                          initial={{ opacity: 0, x: 36 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -28 }}
                          transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                          className="flex-1 flex flex-col items-center justify-center"
                        >
                          <div className="text-center mb-7 px-2">
                            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary/70 mb-2.5">Your own score</p>
                            <h2 className="font-serif font-bold text-[26px] leading-[1.12] tracking-[-0.015em] text-on-surface">
                              How was {restaurant.name}?
                            </h2>
                          </div>
                          <div className="text-center mb-4">
                            <div className={cn("font-serif font-bold tabular-nums leading-none text-[44px] sm:text-[48px] transition-colors duration-300", scoreClr)}>
                              {score.toFixed(1)}
                            </div>
                            <span className={cn("inline-block mt-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-[0.16em] bg-gradient-to-b", scoreBg, scoreClr)}>
                              {score >= 9 ? 'Exceptional' : score >= 8 ? 'Excellent' : score >= 7 ? 'Very Good' : score >= 6 ? 'Good' : score >= 5 ? 'Average' : score >= 4 ? 'Below Average' : score >= 3 ? 'Poor' : 'Terrible'}
                            </span>
                          </div>
                          <div className="w-full max-w-[320px] mb-2">
                            <input type="range" min="1" max="10" step="0.1" value={score} onChange={(e) => setScore(parseFloat(e.target.value))}
                              className="w-full h-2 bg-on-surface/10 rounded-full appearance-none cursor-pointer accent-primary" />
                            <div className="flex justify-between mt-2 text-[10px] text-on-surface/25 font-semibold px-0.5">
                              <span>1</span><span>3</span><span>5</span><span>7</span><span>10</span>
                            </div>
                          </div>
                          {scoresUnlocked ? (
                            <div className="mt-3">
                              <RankingContext score={score} ratings={ratings} excludeId={restaurant.id} />
                            </div>
                          ) : (
                            <p className="mt-3 text-[11px] text-on-surface/40 text-center max-w-[260px] leading-snug">
                              Scores stay hidden until you've rated {SCORE_UNLOCK_THRESHOLD} places.
                            </p>
                          )}
                          <p className="mt-4 text-[11px] text-on-surface/40 text-center max-w-[280px] leading-snug">
                            Hand-picked scores don't count toward community ratings — comparisons do.
                          </p>
                          <div className="mt-3 flex items-center gap-2 w-full max-w-xs">
                            <button
                              type="button"
                              onClick={() => { setRateMode('h2h'); setH2hState(null); }}
                              className="inline-flex items-center justify-center px-4 py-2.5 rounded-xl text-[12.5px] font-semibold text-on-surface/65 hover:text-on-surface bg-on-surface/[0.04] hover:bg-on-surface/[0.08] transition-colors"
                            >
                              Compare instead
                            </button>
                            <button
                              type="button"
                              onClick={() => { setSessionMethod('slider'); setSettledDisplay(null); setH2hScore(null); setH2hOrder(null); setPage('main'); }}
                              className="flex-1 py-2.5 bg-primary text-white rounded-xl font-semibold text-[13px] active:scale-[0.98] transition-transform"
                            >
                              Continue
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}

              {/* ═══════════ MAIN PAGE ═══════════ */}
              {page === 'main' && (
                <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                  className="flex flex-col flex-1 min-h-0">
                  <div className="px-5 pt-safe-4 sm:pt-5 pb-1 flex items-center justify-end flex-shrink-0">
                    <button onClick={closeAddRestaurantModal} aria-label="Close"
                      className="w-9 h-9 rounded-full bg-on-surface/[0.04] flex items-center justify-center text-on-surface/45 hover:text-on-surface hover:bg-on-surface/[0.08] transition-colors">
                      <X size={18} />
                    </button>
                  </div>
                  <div className="px-5 pb-4 flex-shrink-0">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary/75 mb-2">
                      {existing ? (isNewVisit ? `New visit${visitCount > 0 ? ` · #${visitCount + 2}` : ''}` : 'Update rating') : 'Add details'}
                    </p>
                    <h2 className="font-serif font-bold text-[27px] leading-[1.08] tracking-[-0.015em] text-on-surface">
                      {restaurant.name}
                    </h2>
                    <EditableCuisineLine
                      cuisine={resolvedCuisine}
                      onEdit={() => setCuisinePickerOpen(true)}
                      pending={!!suggestedCuisine}
                      className="group/cuisine mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-on-surface/45"
                    />
                  </div>

                  {/* New Visit vs Update toggle */}
                  {existing && (
                    <div className="px-5 pb-2 flex-shrink-0">
                      <div className="flex bg-on-surface/[0.04] rounded-xl p-0.5">
                        <button
                          onClick={() => {
                            if (!isNewVisit) {
                              setIsNewVisit(true);
                              setScore(7); setNotes(''); setVisitDate(localISODate());
                              setSelectedTags([]); setPhotos([]); setSelectedFriends([]);
                              // A fresh visit gets a fresh rating — back to the Rate step.
                              resetRatingSession('rate');
                            }
                          }}
                          className={cn("flex-1 py-2 rounded-lg text-xs font-semibold transition-all",
                            isNewVisit ? "bg-white shadow-sm text-primary" : "text-on-surface/40")}
                        >
                          Log New Visit
                        </button>
                        <button
                          onClick={() => {
                            if (isNewVisit) {
                              setIsNewVisit(false);
                              const ex = getRating(restaurant.id);
                              if (ex) {
                                setScore(ex.score); setNotes(ex.notes); setVisitDate(ex.visitDate);
                                setSelectedTags(ex.tags); setPhotos(ex.photos);
                                setSelectedFriends(ex.friendIds || []);
                              }
                              resetRatingSession('main');
                            }
                          }}
                          className={cn("flex-1 py-2 rounded-lg text-xs font-semibold transition-all",
                            !isNewVisit ? "bg-white shadow-sm text-on-surface/70" : "text-on-surface/40")}
                        >
                          Update Current
                        </button>
                      </div>
                    </div>
                  )}

                  {/* List selector */}
                  <div className="px-5 pb-2 flex-shrink-0 relative z-20">
                    <button onClick={() => setListDropdownOpen(!listDropdownOpen)}
                      className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                        selectedListLabels.length > 0
                          ? "bg-primary/10 text-primary"
                          : "bg-on-surface/5 text-on-surface/50"
                      )}>
                      {selectedListLabels.length > 0
                        ? selectedListLabels.map((l) => `${l.emoji} ${l.name}`).join(', ')
                        : 'All Restaurants'}
                      <ChevronDown size={12} className={cn("transition-transform", listDropdownOpen && "rotate-180")} />
                    </button>
                    <AnimatePresence>
                      {listDropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setListDropdownOpen(false)} />
                          <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={{ duration: 0.12 }}
                            className="absolute top-full left-0 mt-1.5 bg-white rounded-2xl shadow-xl border border-on-surface/8 z-20 max-h-56 overflow-y-auto min-w-[220px]">
                            {lists.map((list) => {
                              const selected = selectedListIds.includes(list.id);
                              return (
                                <button key={list.id} onClick={() => toggleList(list.id)}
                                  className={cn("w-full flex items-center gap-2.5 px-4 py-3 transition-colors text-left",
                                    selected ? "bg-primary/5" : "hover:bg-on-surface/3"
                                  )}>
                                  <span className="text-base">{list.emoji}</span>
                                  <span className={cn("flex-1 text-sm font-medium truncate", selected ? "text-primary" : "text-on-surface/70")}>{list.name}</span>
                                  {selected && <Check size={14} className="text-primary flex-shrink-0" />}
                                </button>
                              );
                            })}
                              <button onClick={() => { setListDropdownOpen(false); setNewListSheetOpen(true); }}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 border-t border-on-surface/6 text-on-surface/35 hover:text-primary transition-colors">
                                <Plus size={14} /><span className="text-xs font-semibold">New List</span>
                              </button>
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">
                    {/* ── Score chip — the rating is FINAL here. Changing it
                        means re-ranking (or adjusting, for slider-made
                        ratings); there is no free-hand editing of a
                        head-to-head result. ── */}
                    {(() => {
                      const currentMethod = sessionMethod ?? existing?.ratingMethod;
                      const needsRating = (!existing || isNewVisit) && sessionMethod === null;
                      const chipScore = settledDisplay ?? score;
                      const { rank, total } = rankAmong(ratings, chipScore, restaurant.id);
                      const tier = tierOfScore(chipScore);
                      if (needsRating) {
                        return (
                          <button
                            type="button"
                            onClick={() => { setRateMode('h2h'); setH2hState(null); setPage('rate'); }}
                            className="w-full mt-1 mb-1 flex items-center gap-3.5 p-4 rounded-2xl bg-primary/[0.06] border border-primary/15 text-left hover:bg-primary/[0.09] transition-colors"
                          >
                            <span className="w-11 h-11 rounded-2xl bg-primary/10 text-primary grid place-items-center flex-shrink-0">
                              <Sparkles size={18} />
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block font-serif font-bold text-[16px] text-on-surface">Rate this visit</span>
                              <span className="block text-[11.5px] text-on-surface/50 mt-0.5">A few quick comparisons place it on your list.</span>
                            </span>
                            <ChevronRight size={16} className="text-on-surface/30 flex-shrink-0" />
                          </button>
                        );
                      }
                      return (
                        <div className="mt-1 mb-1 flex items-center gap-3.5 p-4 rounded-2xl bg-white border border-on-surface/[0.08] shadow-sm">
                          {scoresUnlocked ? (
                            <div className={cn("w-14 h-14 rounded-2xl grid place-items-center bg-gradient-to-b ring-2 flex-shrink-0", scoreBgGradient(chipScore), scoreRingColor(chipScore))}>
                              <span className={cn("font-serif font-bold text-[20px] tabular-nums leading-none", scoreColorLight(chipScore))}>
                                {chipScore.toFixed(1)}
                              </span>
                            </div>
                          ) : (
                            <div className="w-14 h-14 rounded-2xl grid place-items-center bg-on-surface/[0.04] ring-1 ring-on-surface/[0.06] flex-shrink-0">
                              <span className="font-serif font-bold text-[17px] text-on-surface/80">#{rank}</span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-serif font-bold text-[15.5px] leading-snug text-on-surface">
                              {scoresUnlocked
                                ? (currentMethod === 'slider' ? 'Your score' : TIER_LABELS[tier])
                                : TIER_LABELS[tier]}
                            </div>
                            <div className="text-[11.5px] font-medium text-on-surface/50 mt-0.5">
                              #{rank} of {total} on your list
                              {!scoresUnlocked && ' · scores unlock at ' + SCORE_UNLOCK_THRESHOLD}
                              {currentMethod === 'slider' && ' · self-scored'}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setRateMode(currentMethod === 'slider' ? 'slider' : 'h2h');
                              setH2hState(null);
                              setPage('rate');
                            }}
                            className="flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/[0.09] text-[12px] font-semibold text-on-surface/70 hover:text-on-surface transition-colors"
                          >
                            <RotateCcw size={12} />
                            {currentMethod === 'slider' ? 'Adjust' : 'Re-rank'}
                          </button>
                        </div>
                      );
                    })()}
                    <div className="border-t border-on-surface/[0.07] pt-5 mt-5">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-on-surface/40 font-bold mb-1.5 px-1">Add details</p>
                      <div className="flex flex-col">
                        <DetailBtn icon={<StickyNote size={15} />} label="Notes" active={hasNotes} sub={hasNotes ? notes.slice(0, 15) + '...' : undefined} onClick={() => setPage('notes')} />
                        <DetailBtn icon={<ChefHat size={15} />} label="Favorite dishes" active={hasDishes} sub={hasDishes ? `${favoriteDishes.length} added` : undefined} onClick={() => setPage('favorite-dishes')} />
                        <DetailBtn icon={<DollarSign size={15} />} label="Price" active={hasPrice} sub={hasPrice ? PRICE_RANGES[priceIndex].signs : undefined} onClick={() => setPage('price')} />
                        <DetailBtn
                          icon={<CalendarDays size={15} />}
                          label={isNewVisit ? 'Date *' : 'Date'}
                          active={hasDate}
                          sub={dateLabel || (isNewVisit && !hasDate ? 'Required' : undefined)}
                          onClick={() => setPage('date')}
                          error={dateError && isNewVisit && !hasDate}
                        />
                        <DetailBtn icon={<Tag size={15} />} label="Tags" active={hasTags} sub={hasTags ? `${selectedTags.length} selected` : undefined} onClick={() => setPage('tags')} />
                        <DetailBtn icon={<Image size={15} />} label="Photos" active={hasPhotos} sub={hasPhotos ? `${photos.length} added` : undefined} onClick={handlePhotosClick} />
                        <DetailBtn icon={<Users size={15} />} label="Friends" active={hasFriends} sub={hasFriends ? `${selectedFriends.length} friends` : undefined} onClick={() => setPage('friends')} isLast />
                      </div>
                    </div>
                  </div>
                  <div className="px-5 pt-3 pb-safe-4 flex-shrink-0 bg-surface space-y-2">
                    {/* Share state, stated out loud. Adding photos is what
                        turns a rating into a post in everyone's feed, and
                        that rule is worthless if it's invisible — so the
                        toggle says exactly what will happen either way. */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={shareToFeed}
                      onClick={() => setShareToFeed((v) => !v)}
                      className="w-full flex items-center gap-3 rounded-2xl border border-on-surface/[0.07] bg-white px-3.5 py-3 text-left transition-colors hover:border-on-surface/15 active:bg-on-surface/[0.02]"
                    >
                      <motion.span
                        key={shareToFeed ? 'on' : 'off'}
                        initial={{ scale: 0.82, opacity: 0.5 }}
                        animate={{ scale: 1, opacity: 1 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                        className={cn(
                          'grid h-8 w-8 flex-shrink-0 place-items-center rounded-full',
                          shareToFeed ? 'bg-primary/[0.08] text-primary' : 'bg-on-surface/[0.05] text-on-surface/45',
                        )}
                      >
                        {shareToFeed ? <Users size={15} /> : <Lock size={15} />}
                      </motion.span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-serif text-[14px] font-bold leading-tight tracking-[-0.01em] text-on-surface">
                          {shareToFeed ? 'Share to your feed' : 'Keep this private'}
                        </span>
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-on-surface/45">
                          {shareToFeed
                            ? hasPhotos
                              ? `Your circle sees this as a post with ${photos.length === 1 ? 'your photo' : `your ${photos.length} photos`}.`
                              : 'Your circle sees your score. Add photos to share them too.'
                            : "Only you. It won't post, and it won't count toward this restaurant's score."}
                        </span>
                      </span>
                      <span className={cn(
                        'relative h-[26px] w-[44px] flex-shrink-0 rounded-full transition-colors duration-200',
                        shareToFeed ? 'bg-primary' : 'bg-on-surface/15',
                      )}>
                        <motion.span
                          layout
                          transition={{ type: 'spring', stiffness: 520, damping: 34 }}
                          className={cn(
                            'absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm',
                            shareToFeed ? 'left-[21px]' : 'left-[3px]',
                          )}
                        />
                      </span>
                    </button>
                    {dateError && isNewVisit && !hasDate && (
                      <p className="text-xs text-red-600 font-medium text-center">
                        Pick a visit date to save this visit.
                      </p>
                    )}
                    <button onClick={handleSaveRating} disabled={saving || photosProcessing > 0}
                      className="w-full py-4 bg-primary text-white rounded-full font-semibold text-[15px] shadow-lg shadow-primary/25 active:scale-[0.98] transition-transform disabled:opacity-60 disabled:pointer-events-none">
                      {photosProcessing > 0
                        ? `Preparing ${photosProcessing} photo${photosProcessing === 1 ? '' : 's'}…`
                        : saving ? 'Saving…' : existing ? (isNewVisit ? 'Save New Visit' : 'Update Rating') : 'Save Rating'}
                    </button>
                    {existing && !confirmDelete && (
                      <button onClick={() => setConfirmDelete(true)}
                        className="w-full py-2.5 text-red-400 text-xs font-semibold hover:text-red-500 transition-colors">
                        Delete Rating
                      </button>
                    )}
                    {existing && confirmDelete && (
                      <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                        <p className="text-xs text-red-600 font-medium">Delete this rating?</p>
                        <div className="flex gap-2">
                          <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg hover:bg-white">Cancel</button>
                          <button onClick={() => { if (restaurant) { removeRating(restaurant.id); closeAddRestaurantModal(); } }} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ═══════════ NOTES ═══════════ */}
              {page === 'notes' && (
                <SubPage key="notes" onBack={() => setPage('main')} title="Notes">
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} ref={notesFocusRef}
                      placeholder="What did you enjoy? Any favorite dishes, standout moments, or things to remember?" rows={8}
                      className="w-full bg-white border border-on-surface/10 rounded-2xl px-4 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed" />
                  </div>
                  <BottomBtn label={hasNotes ? 'Update Notes' : 'Save Notes'} onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ FAVORITE DISHES ═══════════ */}
              {page === 'favorite-dishes' && (
                <SubPage key="favorite-dishes" onBack={() => { addDish(dishDraft); setPage('main'); }} title="Favorite Dishes">
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5" onTouchMove={(e) => e.stopPropagation()}>
                    <p className="text-xs text-on-surface/45 mb-4 leading-relaxed">
                      The dishes worth ordering here. These show up automatically when you add this restaurant to a guide.
                    </p>
                    <div className="relative mb-4">
                      <ChefHat size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
                      <input
                        type="text"
                        value={dishDraft}
                        onChange={(e) => setDishDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDish(dishDraft); } }}
                        placeholder="Add a dish (press Enter)…"
                        ref={dishFocusRef}
                        className="w-full bg-white border border-on-surface/10 rounded-full pl-10 pr-20 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30"
                      />
                      {dishDraft.trim() && (
                        <button
                          type="button"
                          onClick={() => addDish(dishDraft)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1 rounded-full bg-primary text-white text-[11px] font-bold"
                        >
                          Add
                        </button>
                      )}
                    </div>
                    {favoriteDishes.length === 0 ? (
                      <div className="px-5 py-12 flex flex-col items-center justify-center text-on-surface/30 text-center">
                        <ChefHat size={28} className="mb-2" />
                        <p className="text-sm font-semibold">No dishes added yet</p>
                        <p className="text-xs mt-1 max-w-[220px]">Type a dish above and press Enter to add it to the list.</p>
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {favoriteDishes.map((dish, idx) => (
                          <li key={`${dish}-${idx}`} className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 border border-on-surface/[0.06]">
                            <span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                              <ChefHat size={14} />
                            </span>
                            <span className="flex-1 text-[14px] font-semibold text-on-surface/85 truncate">{dish}</span>
                            <button
                              type="button"
                              onClick={() => removeDish(idx)}
                              aria-label={`Remove ${dish}`}
                              className="w-8 h-8 rounded-full text-on-surface/35 hover:text-primary hover:bg-primary/[0.06] flex items-center justify-center transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <BottomBtn
                    label={hasDishes || dishDraft.trim() ? `Done (${favoriteDishes.length + (dishDraft.trim() && !favoriteDishes.includes(dishDraft.trim()) ? 1 : 0)})` : 'Done'}
                    onClick={() => { addDish(dishDraft); setPage('main'); }}
                  />
                </SubPage>
              )}

              {/* ═══════════ PRICE ═══════════ */}
              {page === 'price' && (
                <SubPage key="price" onBack={() => setPage('main')} title="Price Range">
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-6 flex flex-col items-center">
                    <p className="text-xs text-on-surface/40 mb-5 text-center">How much per person?</p>
                    <div className="flex gap-2.5 w-full max-w-xs mb-6">
                      {PRICE_RANGES.map((p, idx) => (
                        <button key={idx} onClick={() => handlePriceSignClick(idx)}
                          className={cn("flex-1 py-4 rounded-2xl border-2 transition-all text-center",
                            priceIndex === idx ? "bg-primary/10 border-primary/30 text-primary shadow-sm" : "bg-white border-on-surface/10 text-on-surface/40"
                          )}>
                          <div className="text-xl font-bold">{p.signs}</div>
                          <div className="text-[10px] font-medium opacity-60 mt-1">{p.label}</div>
                        </button>
                      ))}
                    </div>
                    <div className="w-full max-w-xs">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-2 text-center">Or enter exact amount</p>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-on-surface/30 font-medium">$</span>
                        <input type="number" value={priceAmount} onChange={(e) => handlePriceAmountChange(e.target.value)} placeholder="0"
                          className="w-full bg-white border border-on-surface/10 rounded-2xl pl-8 pr-4 py-3.5 text-center text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20" />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-on-surface/30">per person</span>
                      </div>
                    </div>
                  </div>
                  <BottomBtn label="Done" onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ DATE ═══════════ */}
              {page === 'date' && (
                <SubPage key="date" onBack={() => setPage('main')} title="Date Visited">
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
                    <Calendar value={visitDate} onChange={setVisitDate} onClear={() => setVisitDate('')} />
                  </div>
                  <BottomBtn label="Done" onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ TAGS ═══════════ */}
              {page === 'tags' && (
                <SubPage key="tags" onBack={() => { setPage('main'); setTagSearch(''); }} title="Tags">
                  <div className="px-5 pt-4 pb-2 flex-shrink-0">
                    <div className="relative">
                      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                      <input type="text" value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} placeholder="Search tags..."
                        className="w-full bg-white border border-on-surface/10 rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>
                    {hasTags && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {selectedTags.map((tag) => (
                          <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                            {tag}<button onClick={() => toggleTag(tag)} className="text-primary/40 hover:text-primary"><X size={11} /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-3"
                    onTouchMove={(e) => e.stopPropagation()}>
                    {filteredTags.map((tag) => {
                      const sel = selectedTags.includes(tag);
                      return (
                        <button key={tag} onClick={() => toggleTag(tag)}
                          className={cn("w-full flex items-center gap-3 px-3 py-3 border-b border-on-surface/5 text-left transition-colors",
                            sel ? "bg-primary/3" : "hover:bg-on-surface/3"
                          )}>
                          <div className={cn("w-5 h-5 rounded flex items-center justify-center border-2 transition-all flex-shrink-0",
                            sel ? "bg-primary border-primary text-white" : "border-on-surface/20"
                          )}>{sel && <Check size={12} strokeWidth={3} />}</div>
                          <span className={cn("text-sm font-medium", sel ? "text-primary" : "text-on-surface/70")}>{tag}</span>
                        </button>
                      );
                    })}
                    {filteredTags.length === 0 && <p className="text-center py-8 text-sm text-on-surface/30">No tags match "{tagSearch}"</p>}
                  </div>
                  <BottomBtn label={hasTags ? `Done (${selectedTags.length})` : 'Done'} onClick={() => { setPage('main'); setTagSearch(''); }} />
                </SubPage>
              )}

              {/* ═══════════ PHOTOS ═══════════ */}
              {page === 'photos' && (
                <SubPage key="photos" onBack={() => setPage('main')} title="Photos" rightAction={
                  <button onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold text-primary">
                    Add More
                  </button>
                }>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
                    onTouchMove={(e) => e.stopPropagation()}>
                    {photos.length === 0 ? (
                      <div className="px-5 py-16 flex flex-col items-center justify-center text-on-surface/30">
                        <Camera size={28} className="mb-2" />
                        <p className="text-sm font-semibold">No photos yet</p>
                        <button onClick={() => fileInputRef.current?.click()} className="mt-3 text-primary text-sm font-semibold">Add Photos</button>
                      </div>
                    ) : (
                      <div className="divide-y divide-on-surface/[0.06]">
                        {photos.map((photo, idx) => (
                          <div key={idx} className="flex gap-3 px-5 py-4">
                            <div className="w-24 h-24 rounded-xl overflow-hidden flex-shrink-0 relative">
                              <img src={photo.url} alt="" className="w-full h-full object-cover" />
                              {photo.url.startsWith('blob:') && (
                                <div className="absolute inset-0 grid place-items-center bg-black/25">
                                  <Loader2 size={16} className="text-white animate-spin" />
                                </div>
                              )}
                              <button onClick={() => removePhoto(idx)}
                                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center">
                                <X size={10} className="text-white" />
                              </button>
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                              <input
                                type="text"
                                value={photo.caption}
                                onChange={(e) => updatePhotoCaption(idx, e.target.value)}
                                placeholder="What's this?"
                                className="text-sm font-medium text-on-surface/70 placeholder:text-on-surface/30 border-none outline-none bg-transparent w-full"
                              />
                              <button onClick={() => togglePhotoFavorite(idx)}
                                className={cn("flex items-center gap-2 mt-2 text-xs font-medium transition-colors",
                                  photo.isFavorite ? "text-primary" : "text-on-surface/35"
                                )}>
                                <span className="text-on-surface/40">Mark as a favorite dish:</span>
                                <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                                  photo.isFavorite ? "bg-primary border-primary text-white" : "border-on-surface/20"
                                )}>
                                  {photo.isFavorite && <Star size={10} fill="white" />}
                                </div>
                              </button>
                            </div>
                            <div className="flex items-start pt-1 flex-shrink-0">
                              <div className="text-on-surface/20 cursor-grab active:cursor-grabbing p-1"
                                onPointerDown={() => setDragIdx(idx)}
                                onPointerUp={() => {
                                  if (dragIdx !== null && dragIdx !== idx) movePhoto(dragIdx, idx);
                                  setDragIdx(null);
                                }}>
                                <GripVertical size={18} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <BottomBtn label={hasPhotos ? `Done (${photos.length})` : 'Done'} onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ FRIENDS ═══════════ */}
              {page === 'friends' && (
                <SubPage key="friends" onBack={() => { setPage('main'); setFriendSearch(''); }} title="Went With">
                  <div className="px-5 pt-4 pb-2 flex-shrink-0">
                    <div className="relative">
                      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                      <input type="text" value={friendSearch} onChange={(e) => setFriendSearch(e.target.value)} placeholder="Search friends..."
                        className="w-full bg-white border border-on-surface/10 rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>
                    {hasFriends && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {selectedFriends.map((fid) => {
                          const fname = realFriends.find((f) => f.id === fid)?.name || fid.slice(0, 8);
                          return (
                            <span key={fid} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                              {fname}<button onClick={() => toggleFriend(fid)} className="text-primary/40 hover:text-primary"><X size={11} /></button>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-3"
                    onTouchMove={(e) => e.stopPropagation()}>
                    <p className="text-[10px] text-on-surface/30 mb-3 px-1">Select friends who joined you</p>
                    {realFriends.length === 0 ? (
                      <div className="text-center py-8">
                        <Users size={24} className="mx-auto text-on-surface/15 mb-2" />
                        <p className="text-sm text-on-surface/30">No friends yet</p>
                        <p className="text-xs text-on-surface/20 mt-1">Add friends on the Circle page first</p>
                      </div>
                    ) : (
                      <>
                        {filteredFriends.map((friend) => {
                          const sel = selectedFriends.includes(friend.id);
                          return (
                            <button key={friend.id} onClick={() => toggleFriend(friend.id)}
                              className={cn("w-full flex items-center gap-3 px-3 py-3 border-b border-on-surface/5 text-left transition-colors",
                                sel ? "bg-primary/3" : "hover:bg-on-surface/3"
                              )}>
                              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary/50 flex-shrink-0">
                                {friend.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                              </div>
                              <span className={cn("flex-1 text-sm font-medium", sel ? "text-primary" : "text-on-surface/70")}>{friend.name}</span>
                              {sel && <Check size={16} className="text-primary flex-shrink-0" />}
                            </button>
                          );
                        })}
                        {filteredFriends.length === 0 && <p className="text-center py-8 text-sm text-on-surface/30">No friends match "{friendSearch}"</p>}
                      </>
                    )}
                  </div>
                  <BottomBtn label={hasFriends ? `Done (${selectedFriends.length})` : 'Done'} onClick={() => { setPage('main'); setFriendSearch(''); }} />
                </SubPage>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* New List Sheet */}
    <AnimatePresence>
      {newListSheetOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[110]" onClick={() => setNewListSheetOpen(false)} />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className={cn("fixed bottom-0 left-0 right-0 z-[110] bg-surface rounded-t-3xl flex flex-col overflow-hidden kb-pad",
              phoneMode ? "h-[92vh]" : "max-h-[75vh]")}
          >
            {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
            <div className="flex items-center justify-between px-5 pt-3 pb-3 border-b border-on-surface/6 flex-shrink-0">
              <h3 className="font-serif font-bold text-lg">{newListMode === 'browse' ? 'New List' : 'Create Custom List'}</h3>
              <button onClick={() => { setNewListSheetOpen(false); setNewListMode('browse'); }} className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center">
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>

            {newListMode === 'browse' ? (
              <>
                <div className="px-5 pt-3 pb-2 flex-shrink-0">
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                    <input type="text" value={newListSearch} onChange={(e) => setNewListSearch(e.target.value)} placeholder="Search lists..."
                      className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                </div>
                <div className="px-5 pb-2 flex-shrink-0">
                  <button onClick={() => setNewListMode('custom')}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border-2 border-dashed border-primary/20 text-primary hover:bg-primary/5 transition-all">
                    <span className="text-sm font-semibold">Create Custom List</span>
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-1.5">
                  {filteredPresetLists.map((preset) => {
                    const exists = existingListNames.has(preset.name.toLowerCase());
                    return (
                      <button key={preset.name} onClick={() => !exists && handleCreateFromPreset(preset.name, preset.emoji)} disabled={exists}
                        className={cn("w-full flex items-center gap-3 p-2.5 rounded-xl border transition-all text-left",
                          exists ? "bg-on-surface/3 border-on-surface/5 opacity-50" : "bg-white border-on-surface/8 hover:border-primary/30 active:bg-primary/5")}>
                        <span className="text-xl">{preset.emoji}</span>
                        <span className="text-sm font-medium flex-1 truncate">{preset.name}</span>
                        {exists ? <span className="text-[10px] text-on-surface/30">Added</span> : <Plus size={16} className="text-on-surface/20" />}
                      </button>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="px-5 py-4 space-y-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40 mb-2">Choose an emoji</p>
                  <div className="flex flex-wrap gap-1.5">
                    {EMOJI_OPTIONS.map((e) => (
                      <button key={e} onClick={() => setNewEmoji(e)}
                        className={cn("w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all", newEmoji === e ? "bg-primary/10 ring-2 ring-primary/30 scale-110" : "hover:bg-on-surface/5")}>{e}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/40 mb-2">List name</p>
                  <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Enter list name..." autoFocus
                    className="w-full bg-white border border-on-surface/10 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    onKeyDown={(e) => e.key === 'Enter' && handleCreateCustomFromSheet()} />
                </div>
                <div className="flex gap-3 pt-1">
                  <button onClick={() => { setNewListMode('browse'); setNewName(''); }} className="flex-1 py-3 rounded-xl border border-on-surface/10 text-sm font-medium text-on-surface/50">Back</button>
                  <button onClick={handleCreateCustomFromSheet} disabled={!newName.trim()} className="flex-1 py-3 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-40">Create</button>
                </div>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>

    {/* Proposing a cuisine while rating the place. Rating is when someone
        most reliably knows what a restaurant serves, which is why the
        control is here — but it files a suggestion and nothing more. The
        rating being saved keeps whatever cuisine the app resolved. */}
    <CuisinePicker
      open={cuisinePickerOpen}
      onClose={() => setCuisinePickerOpen(false)}
      onSelect={async (c) => {
        if (!restaurant?.id || !user?.id) return false;
        const res = await submitCuisineSuggestion({
          userId: user.id,
          restaurantId: restaurant.id,
          cuisine: c,
          restaurantName: restaurant.name,
          restaurantAddress: restaurant.address,
          currentCuisine: resolvedCuisine,
        });
        if (!res.ok) return false;
        setSuggestedCuisine(c);
        showToast('Sent for review', { subtitle: `You suggested ${c} — nothing changes until it's approved` });
        return true;
      }}
      current={resolvedCuisine}
      restaurantName={restaurant?.name}
      pending={suggestedCuisine || undefined}
    />
    </>
  );
};

/* ── Shared sub-components ── */

// Compact ~44px row shared with the Log Home Meal modal. Relies on a
// parent container for the outer border/background and uses a bottom
// divider between rows except on the last one.
const DetailBtn: React.FC<{
  icon: React.ReactNode; label: string; active: boolean; sub?: string; onClick: () => void; isLast?: boolean; error?: boolean;
}> = ({ icon, label, active, sub, onClick, isLast, error }) => (
  <button
    onClick={onClick}
    className={cn(
      "group/detail w-full flex items-center gap-3 px-3.5 py-3 text-left hover:bg-on-surface/[0.03] transition-colors",
      !isLast && "border-b border-on-surface/[0.06]",
      error && "bg-red-50",
    )}
  >
    <span className={cn(
      "w-8 h-8 rounded-[10px] flex items-center justify-center flex-shrink-0 transition-transform group-active/detail:scale-95",
      error ? "bg-red-100 text-red-600" : active ? "bg-on-surface/[0.08] text-on-surface/70" : "bg-on-surface/[0.05] text-on-surface/45",
    )}>
      {icon}
    </span>
    <span className={cn("text-[13px] font-medium flex-1", error ? "text-red-600" : active ? "text-on-surface" : "text-on-surface/70")}>{label}</span>
    {sub && <span className={cn("text-[11px] flex-shrink-0 font-medium", error ? "text-red-600 font-semibold" : "text-on-surface/45")}>{sub}</span>}
    <ChevronRight size={14} className={cn("flex-shrink-0", error ? "text-red-500" : "text-on-surface/25")} />
  </button>
);

const SubPage: React.FC<{
  children: React.ReactNode; onBack: () => void; title: string; rightAction?: React.ReactNode;
}> = ({ children, onBack, title, rightAction }) => (
  <motion.div initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }}
    transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
    className="flex flex-col flex-1 min-h-0" onTouchMove={(e) => e.stopPropagation()}>
    {/* pt-safe-4 (not plain pt-4) so the back-arrow/title row clears the iOS
        status bar / notch — the full-screen sub-page sits at the very top of
        the WebView on phone, same as the main modal header. */}
    <div className="px-5 pt-safe-4 sm:pt-5 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
      <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
        <ChevronLeft size={22} />
      </button>
      <h2 className="font-serif font-bold text-lg flex-1">{title}</h2>
      {rightAction}
    </div>
    {children}
  </motion.div>
);

const BottomBtn: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <div className="px-5 pt-4 pb-safe-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
    <button onClick={onClick} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">{label}</button>
  </div>
);
