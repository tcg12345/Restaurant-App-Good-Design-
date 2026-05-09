import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X, Film, ChefHat, MapPin, Search, Check, Upload, Music2, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useReels, type ReelKind } from '../contexts/ReelsContext';
import { useLists } from '../contexts/ListsContext';
import { useRecipes } from '../contexts/RecipesContext';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';

/* ── Avatar palette so the new reel has a consistent author chip ─────── */

const AVATAR_PALETTE = [
  'bg-emerald-700', 'bg-rose-700', 'bg-amber-600', 'bg-indigo-700',
  'bg-sky-700', 'bg-fuchsia-700', 'bg-orange-700', 'bg-teal-700',
];

const BG_GRADIENT_POOL = [
  'from-orange-900 via-orange-800 to-orange-950',
  'from-stone-900 via-amber-900 to-stone-900',
  'from-zinc-900 via-rose-900/70 to-zinc-900',
  'from-yellow-900 via-amber-800 to-rose-950',
  'from-emerald-950 via-emerald-800 to-stone-900',
  'from-indigo-950 via-purple-900 to-stone-900',
];

function pickFromPool<T>(pool: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return pool[h % pool.length];
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'YO';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ── The modal ──────────────────────────────────────────────────────── */

export const AddReelModal: React.FC = () => {
  const { addReelModalOpen, addReelInitialKind, closeAddReelModal, addReel } = useReels();
  const { ratings, wishlist, restaurantMeta, homeMeals } = useLists();
  const { myRecipes } = useRecipes();
  const { profile, user } = useAuth();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();

  const [kind, setKind] = useState<ReelKind>(addReelInitialKind ?? 'restaurant');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [audio, setAudio] = useState('Original audio');
  const [pickedRestaurantId, setPickedRestaurantId] = useState<string | null>(null);
  const [pickedRecipeId, setPickedRecipeId] = useState<string | null>(null);
  const [restaurantSearch, setRestaurantSearch] = useState('');
  const [recipeSearch, setRecipeSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state whenever the modal is reopened.
  useEffect(() => {
    if (!addReelModalOpen) return;
    setKind(addReelInitialKind ?? 'restaurant');
    setVideoFile(null);
    setVideoUrl(null);
    setCaption('');
    setAudio('Original audio');
    setPickedRestaurantId(null);
    setPickedRecipeId(null);
    setRestaurantSearch('');
    setRecipeSearch('');
    setSubmitting(false);
  }, [addReelModalOpen, addReelInitialKind]);

  // Revoke the object URL whenever the user picks a new video or closes.
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  // ── Derived restaurant pick list ──
  // We surface the user's rated restaurants AND wishlist entries — the
  // viewer just needs something they can tap through to a detail page.
  const restaurantPickList = useMemo(() => {
    type Item = { id: string; name: string; cuisine: string; price: string; address: string; image?: string; score?: number };
    const byId = new Map<string, Item>();
    for (const r of ratings) {
      byId.set(r.restaurantId, {
        id: r.restaurantId,
        name: r.name,
        cuisine: r.cuisine,
        price: r.price,
        address: r.address,
        image: r.image,
        score: r.score,
      });
    }
    for (const w of wishlist) {
      if (byId.has(w.restaurantId)) continue;
      byId.set(w.restaurantId, {
        id: w.restaurantId,
        name: w.name,
        cuisine: w.cuisine,
        price: w.price,
        address: w.address,
        image: w.image,
      });
    }
    // Restaurant meta entries that aren't yet rated (e.g. last viewed)
    for (const [id, m] of Object.entries(restaurantMeta || {})) {
      if (id.startsWith('__') || byId.has(id)) continue;
      const meta = m as { name?: string; cuisine?: string; price?: string; address?: string; image?: string };
      if (!meta?.name) continue;
      byId.set(id, {
        id,
        name: meta.name,
        cuisine: meta.cuisine || '',
        price: meta.price || '',
        address: meta.address || '',
        image: meta.image,
      });
    }
    const items = Array.from(byId.values());
    const q = restaurantSearch.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items.filter((it) => `${it.name} ${it.cuisine} ${it.address}`.toLowerCase().includes(q)).slice(0, 50);
  }, [ratings, wishlist, restaurantMeta, restaurantSearch]);

  // ── Derived recipe pick list ── pulls from cloud recipes + local home meals
  // so the user can attach anything they've already created in the app.
  const recipePickList = useMemo(() => {
    type Item = { id: string; title: string; prepTime: number; cookTime: number; servings: number; difficulty: 'Easy' | 'Medium' | 'Hard'; image?: string };
    const items: Item[] = [];
    for (const r of myRecipes) {
      const diff = (r.difficulty || 'easy').toLowerCase();
      items.push({
        id: r.id,
        title: r.title,
        prepTime: r.prepTimeMinutes ?? 0,
        cookTime: r.cookTimeMinutes ?? 0,
        servings: r.servings ?? 0,
        difficulty: (diff === 'medium' ? 'Medium' : diff === 'hard' ? 'Hard' : 'Easy'),
        image: r.photos?.[0],
      });
    }
    for (const m of homeMeals) {
      items.push({
        id: m.id,
        title: m.name,
        prepTime: m.prepTime ?? 0,
        cookTime: m.cookTime ?? 0,
        servings: m.servings ?? 0,
        difficulty: m.difficulty ?? 'Easy',
        image: m.coverPhoto || m.photos?.[0]?.url,
      });
    }
    const q = recipeSearch.trim().toLowerCase();
    if (!q) return items.slice(0, 50);
    return items.filter((it) => it.title.toLowerCase().includes(q)).slice(0, 50);
  }, [myRecipes, homeMeals, recipeSearch]);

  const pickedRestaurant = useMemo(
    () => restaurantPickList.find((r) => r.id === pickedRestaurantId) ?? null,
    [restaurantPickList, pickedRestaurantId],
  );
  const pickedRecipe = useMemo(
    () => recipePickList.find((r) => r.id === pickedRecipeId) ?? null,
    [recipePickList, pickedRecipeId],
  );

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      showToast('Please pick a video file');
      return;
    }
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoFile(file);
    setVideoUrl(URL.createObjectURL(file));
  };

  const canSubmit =
    !!videoUrl
    && (kind === 'restaurant' ? !!pickedRestaurant : !!pickedRecipe);

  const onSubmit = () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);

    const authorId = user?.id ?? 'local-user';
    const username = profile?.username || profile?.display_name?.replace(/\s+/g, '').toLowerCase() || 'you';
    const avatarColor = pickFromPool(AVATAR_PALETTE, authorId);
    const bgGradient = pickFromPool(BG_GRADIENT_POOL, videoFile?.name || authorId);

    addReel({
      kind,
      authorId,
      authorUsername: username,
      authorDisplayName: profile?.display_name || profile?.username || 'You',
      authorAvatarColor: avatarColor,
      authorInitials: initialsFor(profile?.display_name || profile?.username || 'You'),
      isExpert: !!profile?.is_expert,
      videoUrl: videoUrl ?? undefined,
      bgGradient,
      caption: caption.trim(),
      audioLabel: audio.trim() || 'Original audio',
      restaurant: kind === 'restaurant' && pickedRestaurant
        ? {
          id: pickedRestaurant.id,
          name: pickedRestaurant.name,
          cuisine: pickedRestaurant.cuisine,
          price: pickedRestaurant.price,
          address: pickedRestaurant.address,
          image: pickedRestaurant.image,
          score: pickedRestaurant.score,
        }
        : undefined,
      recipe: kind === 'recipe' && pickedRecipe
        ? {
          id: pickedRecipe.id,
          title: pickedRecipe.title,
          prepTime: pickedRecipe.prepTime,
          cookTime: pickedRecipe.cookTime,
          servings: pickedRecipe.servings,
          difficulty: pickedRecipe.difficulty,
          image: pickedRecipe.image,
        }
        : undefined,
    });
    // Don't revoke the URL on close — the reel is still using it.
    setVideoUrl(null);
    setVideoFile(null);
    showToast('Reel posted');
    closeAddReelModal();
  };

  return (
    <AnimatePresence>
      {addReelModalOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn(
            'fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center',
            phoneMode ? 'items-end' : 'items-end sm:items-center',
          )}
          onClick={closeAddReelModal}
        >
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'bg-surface w-full overflow-hidden flex flex-col',
              phoneMode
                ? 'h-full rounded-none'
                : 'h-full sm:max-w-lg sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl',
            )}
          >
            {/* Header */}
            <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-on-surface/[0.06] flex-shrink-0">
              <div>
                <h2 className="font-serif font-bold text-lg leading-tight">Post a reel</h2>
                <p className="text-[12px] text-on-surface/45 mt-0.5">Share a short video and link a {kind === 'restaurant' ? 'restaurant' : 'recipe'}.</p>
              </div>
              <button
                type="button"
                onClick={closeAddReelModal}
                className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-4 pb-32 space-y-6">
              {/* Kind toggle */}
              <div className="flex p-1 rounded-full bg-on-surface/[0.06]">
                {(['restaurant', 'recipe'] as const).map((k) => {
                  const active = kind === k;
                  const Icon = k === 'restaurant' ? MapPin : ChefHat;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setKind(k)}
                      className={cn(
                        'flex-1 h-10 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors',
                        active ? 'bg-white shadow text-on-surface' : 'text-on-surface/55',
                      )}
                    >
                      <Icon size={15} />
                      {k === 'restaurant' ? 'Restaurant' : 'Recipe'}
                    </button>
                  );
                })}
              </div>

              {/* Video upload */}
              <section>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Video</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  className="hidden"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                />
                {videoUrl ? (
                  <div className="relative rounded-2xl overflow-hidden bg-black aspect-[9/16] max-h-[420px] mx-auto">
                    <video src={videoUrl} className="w-full h-full object-cover" controls playsInline muted />
                    <button
                      type="button"
                      onClick={() => {
                        if (videoUrl) URL.revokeObjectURL(videoUrl);
                        setVideoUrl(null);
                        setVideoFile(null);
                      }}
                      className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 backdrop-blur flex items-center justify-center text-white"
                      aria-label="Remove video"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      'w-full rounded-2xl border-2 border-dashed border-on-surface/15 hover:border-primary/50 hover:bg-primary/[0.03]',
                      'flex flex-col items-center justify-center gap-2 py-12 text-on-surface/55 transition-colors',
                    )}
                  >
                    <Film size={28} className="text-on-surface/40" />
                    <span className="text-sm font-semibold">Choose a video</span>
                    <span className="text-[11px] text-on-surface/40">MP4, MOV — up to 60s recommended</span>
                  </button>
                )}
              </section>

              {/* Caption */}
              <section>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Caption</label>
                <textarea
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  placeholder="What's the story? Why should people pull up?"
                  rows={3}
                  maxLength={280}
                  className="w-full rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 py-3 text-sm placeholder:text-on-surface/35 focus:outline-none focus:border-primary/40 resize-none"
                />
                <div className="text-right text-[11px] text-on-surface/35 mt-1 tabular-nums">{caption.length} / 280</div>
              </section>

              {/* Audio label (decorative) */}
              <section>
                <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Audio</label>
                <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-11">
                  <Music2 size={15} className="text-on-surface/45 flex-shrink-0" />
                  <input
                    value={audio}
                    onChange={(e) => setAudio(e.target.value)}
                    placeholder="Original audio"
                    className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none"
                    maxLength={60}
                  />
                </div>
              </section>

              {/* Restaurant or recipe picker */}
              {kind === 'restaurant' ? (
                <section>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Featured restaurant</label>
                  {pickedRestaurant ? (
                    <PickedRestaurantPill
                      name={pickedRestaurant.name}
                      meta={[pickedRestaurant.cuisine, pickedRestaurant.price].filter(Boolean).join(' · ')}
                      image={pickedRestaurant.image}
                      onClear={() => setPickedRestaurantId(null)}
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-11 mb-2">
                        <Search size={15} className="text-on-surface/45 flex-shrink-0" />
                        <input
                          value={restaurantSearch}
                          onChange={(e) => setRestaurantSearch(e.target.value)}
                          placeholder="Search your rated places, wishlist…"
                          className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none"
                        />
                      </div>
                      {restaurantPickList.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-on-surface/10 px-4 py-6 text-center text-[12px] text-on-surface/45">
                          No matches. Rate or wishlist a restaurant first to attach it.
                        </div>
                      ) : (
                        <ul className="rounded-2xl border border-on-surface/[0.06] divide-y divide-on-surface/[0.06] max-h-[260px] overflow-y-auto">
                          {restaurantPickList.map((r) => (
                            <li key={r.id}>
                              <button
                                type="button"
                                onClick={() => setPickedRestaurantId(r.id)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.04] text-left"
                              >
                                <div className="w-10 h-10 rounded-xl bg-on-surface/[0.06] overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  {r.image ? (
                                    <img src={r.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                                  ) : (
                                    <MapPin size={14} className="text-on-surface/35" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold truncate">{r.name}</p>
                                  <p className="text-[11px] text-on-surface/45 truncate">
                                    {[r.cuisine, r.price, r.address].filter(Boolean).join(' · ')}
                                  </p>
                                </div>
                                {r.score != null && (
                                  <span className="text-xs font-bold tabular-nums text-on-surface/55 flex-shrink-0">
                                    {Number(r.score).toFixed(1)}
                                  </span>
                                )}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </section>
              ) : (
                <section>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-2">Featured recipe</label>
                  {pickedRecipe ? (
                    <PickedRestaurantPill
                      name={pickedRecipe.title}
                      meta={`${(pickedRecipe.prepTime + pickedRecipe.cookTime) || 0} min · ${pickedRecipe.servings || 0} servings · ${pickedRecipe.difficulty}`}
                      image={pickedRecipe.image}
                      onClear={() => setPickedRecipeId(null)}
                    />
                  ) : (
                    <>
                      <div className="flex items-center gap-2 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.06] px-4 h-11 mb-2">
                        <Search size={15} className="text-on-surface/45 flex-shrink-0" />
                        <input
                          value={recipeSearch}
                          onChange={(e) => setRecipeSearch(e.target.value)}
                          placeholder="Search your recipes and home meals…"
                          className="flex-1 bg-transparent text-sm placeholder:text-on-surface/35 focus:outline-none"
                        />
                      </div>
                      {recipePickList.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-on-surface/10 px-4 py-6 text-center text-[12px] text-on-surface/45">
                          No recipes yet. Create one in the Pantry first to attach it here.
                        </div>
                      ) : (
                        <ul className="rounded-2xl border border-on-surface/[0.06] divide-y divide-on-surface/[0.06] max-h-[260px] overflow-y-auto">
                          {recipePickList.map((r) => (
                            <li key={r.id}>
                              <button
                                type="button"
                                onClick={() => setPickedRecipeId(r.id)}
                                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.04] text-left"
                              >
                                <div className="w-10 h-10 rounded-xl bg-blue-50 overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  {r.image ? (
                                    <img src={r.image} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <ChefHat size={16} className="text-blue-600" />
                                  )}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-semibold truncate">{r.title}</p>
                                  <p className="text-[11px] text-on-surface/45 truncate">
                                    {(r.prepTime + r.cookTime) || 0} min · {r.servings || 0} servings · {r.difficulty}
                                  </p>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </section>
              )}
            </div>

            {/* Footer */}
            <div className="border-t border-on-surface/[0.06] px-5 py-3 bg-surface flex items-center gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={closeAddReelModal}
                className="px-4 h-11 rounded-full text-sm font-semibold text-on-surface/65 hover:bg-on-surface/[0.05] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit || submitting}
                className={cn(
                  'flex-1 h-11 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors',
                  canSubmit && !submitting
                    ? 'bg-primary text-white hover:bg-primary/90'
                    : 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed',
                )}
              >
                <Upload size={15} />
                Post reel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Picked-pill chip used for both restaurant and recipe ──────────── */

const PickedRestaurantPill: React.FC<{ name: string; meta: string; image?: string; onClear: () => void }> = ({ name, meta, image, onClear }) => (
  <div className="flex items-center gap-3 rounded-2xl bg-primary/[0.06] border border-primary/15 px-3 py-2.5">
    <div className="w-10 h-10 rounded-xl overflow-hidden bg-on-surface/[0.06] flex-shrink-0 flex items-center justify-center">
      {image ? (
        <img src={image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <Check size={14} className="text-primary" />
      )}
    </div>
    <div className="flex-1 min-w-0">
      <p className="text-sm font-bold truncate">{name}</p>
      <p className="text-[11px] text-on-surface/55 truncate">{meta}</p>
    </div>
    <button
      type="button"
      onClick={onClear}
      className="text-[11px] font-semibold text-on-surface/55 hover:text-on-surface px-2 h-8 rounded-full hover:bg-on-surface/[0.05]"
    >
      Change
    </button>
  </div>
);
