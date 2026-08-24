import React, { createContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, X } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { GlassButton } from '../lib/glass-buttons';
import { useBottomSheet } from '../lib/useBottomSheet';
import { cn } from '../lib/utils';
import './filterSheet.css';

/**
 * Shared chrome for every filter popup in the app (Discover, Pantry,
 * wishlist, recipes, public profile, recommendations). Provides the
 * overlay, the desktop-card / phone-bottom-sheet container,
 * drag-to-dismiss handle, header (title + optional icon/subtitle), a
 * scrollable body slot, and a Reset / Apply footer — matching the
 * Location page's reference design.
 *
 * Callers compose the body from the primitives in `filterPrimitives.tsx`
 * (FilterSection, Pill, Segment, RangeSlider, FilterDrillSection) plus the
 * shared `MichelinDrillSection`. Filter LOGIC stays in each caller; this
 * component is presentation only.
 *
 * ── Sub-pages (Beli-style drill-in) ──
 * Option-list filters don't expand inline: a FilterDrillSection renders a
 * row (label · current value · chevron) and pushes a SUB-PAGE that slides
 * in over the main list, with the sheet header swapping to a back arrow +
 * the filter's name. The mechanism lives here: drill rows reach it
 * through FilterSheetNavContext and portal their page content into the
 * sliding layer, so selections stay live while the caller re-renders.
 */
interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional rounded icon chip left of the title (wishlist / recipes). */
  titleIcon?: React.ReactNode;
  /** Optional line under the title (e.g. active-filter count). */
  subtitle?: React.ReactNode;
  onReset: () => void;
  resetLabel?: string;
  applyLabel?: string;
  /** Defaults to onClose; Discover passes its nearby-fetch trigger. */
  onApply?: () => void;
  /** Overlay stacking; defaults to 60. Wishlist/Recipe keep 120. */
  zIndex?: number;
  /** Open directly on a drill sub-page (id must match a FilterDrillSection
   *  in children). Consumed on each closed→open transition. */
  initialPage?: { id: string; title: string } | null;
  /** The map page's dress: no title — a glass ✕ on the left and a glass
   *  "Clear all" on the right instead, with Apply owning the whole footer.
   *  The list pages keep the titled header and the Reset/Apply pair. */
  glassChrome?: boolean;
  children: React.ReactNode;
}

/** What a drill page tells the sheet about itself when it opens. */
export interface FilterPageMeta {
  /** The rule, stated: "One choice" / "Pick as many as you like". */
  subtitle?: string;
  /** Clears just this page's selection, from the page's own header. */
  onClear?: () => void;
}

export interface FilterSheetNav {
  /** The drill page currently open, or null (main list). */
  activeId: string | null;
  openPage: (id: string, title: string, meta?: FilterPageMeta) => void;
  closePage: () => void;
  /** Mount point for the active drill page's content (portal target). */
  container: HTMLDivElement | null;
}

/** Default no-ops let primitives render outside a sheet (never expected —
 *  they'd just do nothing on tap). */
export const FilterSheetNavContext = createContext<FilterSheetNav>({
  activeId: null,
  openPage: () => {},
  closePage: () => {},
  container: null,
});

export const FilterSheet: React.FC<FilterSheetProps> = ({
  open,
  onClose,
  title,
  titleIcon,
  subtitle,
  onReset,
  resetLabel = 'Reset',
  applyLabel = 'Apply',
  onApply,
  zIndex = 60,
  initialPage = null,
  glassChrome = false,
  children,
}) => {
  const { phoneMode } = useSettings();
  // Drag-anywhere dismissal — a downward pull with the list at its top
  // takes the whole sheet; scrolled content, or a drill-in subpage, keeps
  // the drag native to whatever's under the finger.
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);
  const { dragProps, sheetRef } = useBottomSheet(open, onClose, sheetScrollRef);
  const handleApply = onApply ?? onClose;

  // ── Drill sub-page state ──
  const [page, setPage] = useState<({ id: string; title: string } & FilterPageMeta) | null>(null);
  const [subContainer, setSubContainer] = useState<HTMLDivElement | null>(null);
  // Apply initialPage on each closed→open transition (read via ref so a
  // parent re-render can't re-trigger it mid-session).
  const initialPageRef = useRef(initialPage);
  initialPageRef.current = initialPage;
  useEffect(() => {
    setPage(open ? initialPageRef.current : null);
  }, [open]);

  const nav: FilterSheetNav = {
    activeId: page?.id ?? null,
    openPage: (id, pageTitle, meta) => setPage({ id, title: pageTitle, ...meta }),
    closePage: () => setPage(null),
    container: subContainer,
  };

  // Portaled to body: several hosts render this shell inside layers that
  // create their own stacking contexts (the search tab's map layer is
  // `isolate`d so its chrome can't rise over the Following wash) — a fixed
  // overlay rendered in place would be fenced UNDER the page's floating
  // glass chrome, which then hangs over the open sheet.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className={cn('fs-overlay', phoneMode && 'is-phone')}
          style={{ zIndex }}
          onClick={onClose}
        >
          <motion.div
            ref={phoneMode ? (sheetRef as React.RefObject<HTMLDivElement>) : undefined}
            {...(phoneMode
              ? {
                  initial: { y: '100%' },
                  animate: { y: 0 },
                  exit: { y: '100%' },
                  transition: { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const },
                  ...dragProps,
                }
              : {
                  initial: { opacity: 0, scale: 0.96, y: -8 },
                  animate: { opacity: 1, scale: 1, y: 0 },
                  exit: { opacity: 0, scale: 0.97, y: -4 },
                  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn('fs-sheet', phoneMode ? 'is-phone' : 'is-desktop')}
          >
            <div className="fs-head">
              {page ? (
                <div className="fs-head-main">
                  <button
                    type="button"
                    onClick={() => setPage(null)}
                    className="fs-back"
                    aria-label="Back to all filters"
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <div className="fs-head-text">
                    <h3 className="fs-title is-sub">{page.title}</h3>
                    {/* The rule, stated. "Cuisine" alone doesn't say whether
                        tapping a second one replaces the first. */}
                    {page.subtitle && <p className="fs-subtitle">{page.subtitle}</p>}
                  </div>
                </div>
              ) : glassChrome ? (
                <GlassButton
                  id="filters-close"
                  symbol="xmark"
                  label="Close filters"
                  onClick={onClose}
                  className="hit-44 w-10 h-10 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
                >
                  <X size={17} />
                </GlassButton>
              ) : (
                <div className="fs-head-main">
                  {titleIcon && <span className="fs-title-icon">{titleIcon}</span>}
                  <div className="fs-head-text">
                    <h3 className="fs-title">{title}</h3>
                    {subtitle && <p className="fs-subtitle">{subtitle}</p>}
                  </div>
                </div>
              )}
              {page ? (
                page.onClear ? (
                  <button type="button" onClick={page.onClear} className="fs-clear">Clear</button>
                ) : null
              ) : glassChrome ? (
                <GlassButton
                  id="filters-clear-all"
                  symbol=""
                  title="Clear all"
                  titleStyle="chip"
                  label="Clear all filters"
                  onClick={onReset}
                  className="h-10 px-4 rounded-full flex items-center text-[13px] font-bold text-on-surface"
                >
                  Clear all
                </GlassButton>
              ) : (
                <button type="button" onClick={onClose} className="fs-close" aria-label="Close filters">
                  <X size={16} />
                </button>
              )}
            </div>

            <FilterSheetNavContext.Provider value={nav}>
              <div className="fs-body-zone">
                {/* An iOS push: the page you came from slides back and
                    shrinks a little as the new one covers it, so the stack
                    reads as depth rather than as a swap. */}
                <motion.div
                  ref={sheetScrollRef}
                  className="fs-body"
                  animate={page ? { x: '-22%', scale: 0.97, opacity: 0.5 } : { x: '0%', scale: 1, opacity: 1 }}
                  transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                  style={{ transformOrigin: 'center left' }}
                  aria-hidden={!!page || undefined}
                >
                  {children}
                </motion.div>
                <AnimatePresence>
                  {page && (
                    <motion.div
                      key={page.id}
                      className="fs-subpage"
                      initial={{ x: '100%' }}
                      animate={{ x: 0 }}
                      exit={{ x: '100%' }}
                      transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
                    >
                      <div ref={setSubContainer} className="fs-subpage-scroll" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </FilterSheetNavContext.Provider>

            <div className="fs-foot">
              {page ? (
                <button type="button" onClick={() => setPage(null)} className="fs-apply">
                  Done
                </button>
              ) : glassChrome ? (
                <button type="button" onClick={handleApply} className="fs-apply">
                  {applyLabel}
                </button>
              ) : (
                <>
                  <button type="button" onClick={onReset} className="fs-reset">
                    {resetLabel}
                  </button>
                  <button type="button" onClick={handleApply} className="fs-apply">
                    {applyLabel}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

export default FilterSheet;
