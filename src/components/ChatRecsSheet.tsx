/**
 * "Find me a place" — the recommendations shortcut inside the AI chat.
 *
 * The chat is where people already ask the question; this is the version
 * of the same ask that skips the conversation. Three decisions — who,
 * where, and what you're in the mood for — then it hands off to the
 * ranked list rather than answering inline, because the ranking surface
 * already does filters, sort, distance, wishlist and rating properly and
 * a chat bubble does none of them.
 *
 * Everything here is OPTIONAL. Opening it and pressing the button with
 * nothing chosen is the ordinary "for you" list near your anchor, which
 * is exactly what a shortcut should do when you don't steer it.
 *
 * Motion: a real motion.div. `useBottomSheet`'s dragProps are Framer drag
 * props — on a plain <div> they are inert, which is why the first version
 * of this sheet could not be dragged at all and simply popped in. It now
 * slides on the app's drawer curve and dismisses from anywhere on it.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, MapPin, Sparkles, Users, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { Avatar } from './Avatar';
import { avatarHue } from '../lib/avatar';
import { useBottomSheet } from '../lib/useBottomSheet';
import { GroupPicker } from './GroupPicker';
import { HomeLocationBar, type HomeLocation } from './HomeLocationBar';
import { useHomeLocation } from '../contexts/HomeLocationContext';
import { parseMoodText, moodHasSignal } from '../lib/mood-text';
import type { UserProfile } from '../lib/supabase-community';

/** Mood → the cuisine filter the ranking opens with. Keys are labels from
 *  the app's canonical cuisine list so they match what the browser filters
 *  on; an empty list means "no cuisine filter, just the mood's framing". */
const MOODS: Array<{ id: string; label: string; cuisines: string[] }> = [
  { id: 'anything', label: 'Anything good', cuisines: [] },
  { id: 'italian', label: 'Italian', cuisines: ['Italian'] },
  { id: 'japanese', label: 'Japanese', cuisines: ['Japanese'] },
  { id: 'sushi', label: 'Sushi', cuisines: ['Sushi'] },
  { id: 'mexican', label: 'Mexican', cuisines: ['Mexican'] },
  { id: 'indian', label: 'Indian', cuisines: ['Indian'] },
  { id: 'chinese', label: 'Chinese', cuisines: ['Chinese'] },
  { id: 'thai', label: 'Thai', cuisines: ['Thai'] },
  { id: 'french', label: 'French', cuisines: ['French'] },
  { id: 'american', label: 'American', cuisines: ['American'] },
  { id: 'steakhouse', label: 'Steak', cuisines: ['Steakhouse'] },
  { id: 'pizza', label: 'Pizza', cuisines: ['Pizza'] },
];

/** The app's drawer curve — the same one the search page's filter sheet
 *  arrives on, so the two sheets a person meets in a row feel related. */
const SHEET_TRANSITION = { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const };

export const ChatRecsSheet: React.FC<{
  open: boolean;
  /** Dismissed — X, backdrop, or a drag down. The host returns to the chat. */
  onClose: () => void;
  /** Left for the ranked list. The host must NOT reopen the chat. */
  onNavigate: () => void;
  userId: string | null;
}> = ({ open, onClose, onNavigate, userId }) => {
  const navigate = useNavigate();
  const homeCtx = useHomeLocation();
  const [people, setPeople] = useState<UserProfile[]>([]);
  const [mood, setMood] = useState<string>('anything');
  /* Free text on top of the chips. Parsed deterministically onto the
     engine's own levers (lib/mood-text) — tags re-rank, cuisines/price/
     open-now filter — with an echo of exactly what was understood, so
     the field never pretends to a comprehension it doesn't have. */
  const [moodText, setMoodText] = useState('');
  const parsed = useMemo(() => parseMoodText(moodText), [moodText]);
  const [whoOpen, setWhoOpen] = useState(false);
  const [whereOpen, setWhereOpen] = useState(false);
  const [where, setWhere] = useState<HomeLocation | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const { dragProps, sheetRef } = useBottomSheet(open, onClose, scrollRef);

  const target = where ?? homeCtx?.location ?? null;
  const chosen = MOODS.find((m) => m.id === mood) ?? MOODS[0];
  const typed = moodText.trim().length > 0;

  const go = () => {
    onNavigate();
    /* Chip and text are NOT the same kind of thing. Tapping "Italian" is an
       explicit filter; typing "expensive sushi" is a preference. Sending the
       text's cuisine as a hard filter is what made that search return
       nothing — so the chip filters, and the text only steers. */
    navigate('/pantry/recommended', {
      state: {
        recsPreset: {
          people: people.map((p) => p.user_id),
          cuisines: chosen.cuisines,
          moodCuisines: parsed.cuisines,
          target: target ? { label: target.label, lat: target.lat, lng: target.lng } : null,
          moodTags: parsed.tags,
          moodPhrases: parsed.searchPhrases,
          priceLevels: parsed.priceLevels,
          openNow: parsed.openNow,
        },
      },
    });
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="find-a-place"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[215] flex items-end justify-center bg-black/50 backdrop-blur-[2px]"
            onClick={onClose}
          >
            <motion.div
              ref={sheetRef as React.RefObject<HTMLDivElement>}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={SHEET_TRANSITION}
              {...dragProps}
              onClick={(e) => e.stopPropagation()}
              className="flex w-full max-w-[520px] flex-col rounded-t-[28px] bg-surface shadow-[0_-16px_48px_rgba(0,0,0,0.35)]"
              style={{ maxHeight: '88%', paddingBottom: 'var(--kb-height, 0px)' }}
            >
              {/* Grabber — the drag works from anywhere, this just says so. */}
              <div className="flex justify-center pt-2.5 pb-1">
                <span className="h-[5px] w-10 rounded-full bg-on-surface/20" />
              </div>

              <div className="flex items-start gap-3 px-5 pt-1 pb-4">
                <div className="min-w-0 flex-1">
                  <h3 className="font-serif text-[22px] font-bold leading-tight tracking-[-0.02em] text-on-surface">
                    Find a place
                  </h3>
                  <p className="mt-1 text-[13px] text-on-surface/50">Ranked on what you&rsquo;ve actually rated.</p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="grid h-9 w-9 flex-none place-items-center rounded-full bg-on-surface/[0.06] text-on-surface/70 transition-transform active:scale-95"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-5 pb-2">
                {/* WHO / WHERE — one grouped card, the way settings rows sit
                    together, instead of two hairlined list rows. */}
                <div className="overflow-hidden rounded-[22px] bg-on-surface/[0.04]">
                  <button
                    type="button"
                    onClick={() => setWhoOpen(true)}
                    className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors active:bg-on-surface/[0.04]"
                  >
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-[14px] bg-surface text-on-surface/70 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                      <Users size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-on-surface">Who&rsquo;s eating</span>
                      <span className="mt-[2px] block truncate text-[12.5px] text-on-surface/50">
                        {people.length === 0 ? 'Just me' : `You + ${people.length}`}
                      </span>
                    </span>
                    {people.length > 0 && (
                      <span className="flex flex-none">
                        {people.slice(0, 3).map((p, i) => (
                          <span key={p.user_id} className={cn('rounded-full ring-2 ring-surface', i > 0 && '-ml-2.5')}>
                            <Avatar
                              src={p.avatar_url}
                              name={p.display_name || p.username || 'Friend'}
                              size={26}
                              fallbackStyle={{
                                backgroundColor: `hsl(${avatarHue(p.user_id)} 52% 92%)`,
                                color: `hsl(${avatarHue(p.user_id)} 45% 34%)`,
                              }}
                            />
                          </span>
                        ))}
                      </span>
                    )}
                    <ChevronRight size={16} className="flex-none text-on-surface/30" />
                  </button>

                  <div className="mx-4 h-px bg-on-surface/[0.07]" />

                  <button
                    type="button"
                    onClick={() => setWhereOpen(true)}
                    className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors active:bg-on-surface/[0.04]"
                  >
                    <span className="grid h-10 w-10 flex-none place-items-center rounded-[14px] bg-surface text-primary shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                      <MapPin size={17} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-on-surface">Where</span>
                      <span className="mt-[2px] block truncate text-[12.5px] text-on-surface/50">
                        {target ? target.label.split(',').slice(0, 2).join(',') : 'Choose a location'}
                      </span>
                    </span>
                    <ChevronRight size={16} className="flex-none text-on-surface/30" />
                  </button>
                </div>

                {/* MOOD — chips are a quick pick (a hard cuisine filter); the
                    field underneath is a preference the search and ranking
                    both read. One scrolling row instead of a three-row wrap:
                    the sheet gets shorter and the eye has one line to scan. */}
                <div className="mt-6">
                  <p className="px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface/40">
                    In the mood for
                  </p>
                  <div className="no-scrollbar -mx-5 mt-3 flex gap-2 overflow-x-auto px-5">
                    {MOODS.map((m) => {
                      const on = m.id === mood;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setMood(m.id)}
                          className={cn(
                            'h-9 flex-none whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-[background-color,color,transform] active:scale-[0.97]',
                            on ? 'bg-on-surface text-surface' : 'bg-on-surface/[0.05] text-on-surface/70',
                          )}
                        >
                          {m.label}
                        </button>
                      );
                    })}
                  </div>

                  <div
                    className={cn(
                      'mt-3 flex items-start gap-2.5 rounded-[18px] border bg-on-surface/[0.035] px-3.5 py-3 transition-colors',
                      typed ? 'border-on-surface/15' : 'border-on-surface/[0.07] focus-within:border-on-surface/20',
                    )}
                  >
                    <Sparkles size={15} className="mt-[3px] flex-none text-primary" />
                    <textarea
                      value={moodText}
                      onChange={(e) => setMoodText(e.target.value)}
                      rows={2}
                      maxLength={140}
                      placeholder={'Or say it in your own words — "quiet date-night spot with great cocktails"'}
                      className="w-full resize-none bg-transparent text-[14px] leading-snug text-on-surface placeholder:text-on-surface/35 focus:outline-none"
                    />
                  </div>

                  {/* The receipt: exactly what was understood, nothing more. */}
                  <AnimatePresence initial={false}>
                    {typed && (
                      <motion.div
                        key={moodHasSignal(parsed) ? 'hits' : 'none'}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18 }}
                        className="mt-2.5 px-1"
                      >
                        {moodHasSignal(parsed) ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-on-surface/40">Got it</span>
                            {parsed.recognized.map((r) => (
                              <span key={r} className="rounded-full bg-primary/[0.1] px-2.5 py-1 text-[11.5px] font-semibold text-primary">
                                {r}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[12px] leading-snug text-on-surface/45">
                            Nothing matched yet — try &ldquo;romantic&rdquo;, &ldquo;cheap&rdquo;, &ldquo;rooftop&rdquo;, or a cuisine.
                          </p>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>

              <div className="border-t border-on-surface/[0.06] px-5 pt-3 pb-safe-4">
                <button
                  type="button"
                  onClick={go}
                  className="flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-primary text-[15px] font-bold text-white shadow-[0_10px_28px_-10px_rgba(0,0,0,0.55)] transition-transform active:scale-[0.985]"
                >
                  <Sparkles size={16} />
                  {people.length === 0 ? 'Find places for me' : `Find a place for ${people.length + 1}`}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <GroupPicker
        open={whoOpen}
        onClose={() => setWhoOpen(false)}
        userId={userId}
        selected={people}
        onDone={setPeople}
      />
      {/* Headless: the picker portals its own sheet, so this renders nothing
          until it is opened. */}
      <HomeLocationBar
        variant="headless"
        location={target}
        onChange={(loc) => setWhere(loc)}
        onUseCurrent={async () => { await homeCtx?.useCurrent(); }}
        open={whereOpen}
        onOpenChange={setWhereOpen}
        /* Above this sheet's own z-[215] — the picker portals out to the
           frame root, so without this it opens UNDERNEATH us and the row
           reads as a dead button. */
        sheetZ="z-[230]"
      />
    </>
  );
};
