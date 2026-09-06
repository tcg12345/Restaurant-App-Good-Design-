import React, { createContext, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { ChevronLeft, X } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { GlassButton } from '../lib/glass-buttons';
import { useBottomSheet, mergeRefs, liftOverlayToTopLayer } from '../lib/useBottomSheet';
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [preferredHeight, setPreferredHeight] = useState(700);
  const activeScrollRef = useRef<HTMLDivElement | null>(null);
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);
  // The glass ✕ and Clear all live IN the sheet's header. While the sheet
  // rides a finger they stand down to their CSS look — a native control
  // can't track a finger-driven transform — and come back at rest.
  const [glassSuspended, setGlassSuspended] = useState(false);
  const { dragProps, sheetRef } = useBottomSheet(open, onClose, activeScrollRef, setGlassSuspended);
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

  // Open at the top, always. Showing the sheet in the top layer moves focus
  // into it, and WebKit scrolls whatever lands focused into view — which
  // opened the sheet a dozen pixels down, with the first section's label
  // cut in half. It also matters for the gesture: useBottomSheet only reads
  // a downward drag as a dismissal while this scroller sits at its top.
  useEffect(() => {
    if (!open) return;
    const at0 = () => { if (sheetScrollRef.current) sheetScrollRef.current.scrollTop = 0; };
    at0();
    const raf = requestAnimationFrame(at0);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    activeScrollRef.current = page ? subContainer : sheetScrollRef.current;
  }, [page, subContainer, open]);

  // Keep the sheet sized to its overview while drilling into lists. Short
  // recipe filters need less space, and navigation should not resize the sheet.
  useLayoutEffect(() => {
    if (!open || !contentRef.current || !dialogRef.current) return;
    const measure = () => {
      const root = dialogRef.current;
      if (!root || !contentRef.current) return;
      const chrome = ['.fs-head', '.fs-foot', '.fs-drag-handle'].reduce((height, selector) =>
        height + (root.querySelector<HTMLElement>(selector)?.offsetHeight ?? 0), 0);
      setPreferredHeight(Math.max(440, contentRef.current.offsetHeight + chrome + 14));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [open, phoneMode]);

  const closeCurrent = useRef(() => {});
  closeCurrent.current = () => page ? setPage(null) : onClose();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => {
      liftOverlayToTopLayer(dialogRef.current);
      dialogRef.current?.focus({ preventScroll: true });
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeCurrent.current();
      }
      if (event.key !== 'Tab') return;
      const targets = Array.from<HTMLElement>(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]',
      ) ?? []).filter(el => !el.closest('[inert]') && el.getClientRects().length > 0);
      const first = targets[0], last = targets.at(-1);
      if (!first) { event.preventDefault(); return; }
      const active = document.activeElement as HTMLElement;
      if (event.shiftKey && (active === first || !targets.includes(active))) {
        event.preventDefault(); last?.focus({ preventScroll: true });
      } else if (!event.shiftKey && (active === last || !targets.includes(active))) {
        event.preventDefault(); first.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', keydown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', keydown, true);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);
  const previousPage = useRef<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const from = previousPage.current;
    previousPage.current = page?.id ?? null;
    const frame = requestAnimationFrame(() => {
      if (page) dialogRef.current?.querySelector<HTMLElement>('.fs-title')?.focus({ preventScroll: true });
      else if (from) {
        const row = Array.from<HTMLElement>(dialogRef.current?.querySelectorAll<HTMLElement>('[data-filter-page]') ?? [])
          .find(el => el.dataset.filterPage === from);
        row?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [page?.id, open]);
  const openPage = useCallback<FilterSheetNav['openPage']>((id, pageTitle, meta) =>
    setPage({ id, title: pageTitle, ...meta }), []);
  const closePage = useCallback(() => setPage(null), []);
  const nav: FilterSheetNav = {
    activeId: page?.id ?? null,
    openPage,
    closePage,
    container: subContainer,
  };

  // Portaled to body: several hosts render this shell inside layers that
  // create their own stacking contexts (the search tab's map layer is
  // `isolate`d so its chrome can't rise over the Following wash) — a fixed
  // overlay rendered in place would be fenced UNDER the page's floating
  // glass chrome, which then hangs over the open sheet.
  return createPortal(
    <MotionConfig reducedMotion="user">
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
            ref={mergeRefs(dialogRef, phoneMode ? sheetRef : undefined)}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            style={{ '--fs-preferred-height': `${preferredHeight}px` } as React.CSSProperties}
            tabIndex={-1}
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
            {phoneMode && (
              <div className="fs-drag-handle" aria-hidden>
                <span />
              </div>
            )}
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
                    <h3 id={titleId} tabIndex={-1} className="fs-title is-sub">{page.title}</h3>
                    {/* The rule, stated. "Cuisine" alone doesn't say whether
                        tapping a second one replaces the first. */}
                    {page.subtitle && <p className="fs-subtitle">{page.subtitle}</p>}
                  </div>
                </div>
              ) : (
                <div className="fs-head-main">
                  {titleIcon && <span className="fs-title-icon">{titleIcon}</span>}
                  <div className="fs-head-text">
                    <h3 id={titleId} tabIndex={-1} className="fs-title">{title}</h3>
                    {subtitle && <p className="fs-subtitle">{subtitle}</p>}
                  </div>
                </div>
              )}
              {page ? (
                page.onClear ? (
                  <button type="button" onClick={page.onClear} className="fs-clear">Clear</button>
                ) : null
              ) : glassChrome ? (
                <div className="fs-head-actions">
                  <GlassButton
                    id="filters-clear-all"
                    symbol=""
                    title="Clear all"
                    titleStyle="chip"
                    label="Clear all filters"
                    onClick={onReset}
                    suspended={glassSuspended}
                    className="h-11 px-4 rounded-full flex items-center text-[13px] font-bold text-on-surface"
                  >
                    Clear all
                  </GlassButton>
                  <GlassButton
                    id="filters-close"
                    symbol="xmark"
                    label="Close filters"
                    onClick={onClose}
                    suspended={glassSuspended}
                    className="hit-44 w-11 h-11 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
                  >
                    <X size={17} />
                  </GlassButton>
                </div>
              ) : (
                <GlassButton id="filters-close" symbol="xmark" label="Close filters"
                  onClick={onClose} suspended={glassSuspended} className="fs-close">
                  <X size={19} />
                </GlassButton>
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
                  inert={!!page}
                >
                  <div ref={contentRef} className="fs-body-content">{children}</div>
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
    </AnimatePresence>
    </MotionConfig>,
    document.body,
  );
};

export default FilterSheet;
