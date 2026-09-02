import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Check, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { useBottomSheet } from '../lib/useBottomSheet';
import { scoreTintStyle } from '../lib/score';

/**
 * "Your lists" — the Lists page's list switcher.
 *
 * This is the page's navigation now that the card-grid landing is gone: the
 * title in the header is a button, and this is what it opens. Sections are
 * the same split the page already thinks in — the two or three built-in
 * lists, then the user's own collections, then a cuisine breakdown — so the
 * drawer reads as the whole shelf at once rather than a menu of commands.
 *
 * Portalled to the body for the same reason FilterSheet is: the page's
 * floating glass chrome sits in stacking contexts a locally-rendered fixed
 * overlay would end up underneath.
 */

export interface DrawerItem {
  id: string;
  name: string;
  meta: string;
  /** Mutually exclusive with `score` — a list gets a glyph, a cuisine gets its average. */
  icon?: React.ReactNode;
  score?: number;
  onSelect: () => void;
}

export interface DrawerSection {
  label: string;
  items: DrawerItem[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Synthetic id of the list currently on screen — see PANTRY_VIEW_IDS in Pantry.tsx. */
  activeId: string;
  sections: DrawerSection[];
  onNewList: () => void;
  newListLabel: string;
}

export const PantryListSwitcherDrawer: React.FC<Props> = ({
  open, onClose, activeId, sections, onNewList, newListLabel,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { dragProps, sheetRef } = useBottomSheet(open, onClose, scrollRef);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 z-[120] bg-black/40 backdrop-blur-[3px]"
        >
          <motion.div
            ref={sheetRef as React.RefObject<HTMLDivElement>}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            {...dragProps}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 max-h-[76vh] flex flex-col rounded-t-[28px] bg-surface shadow-[0_-20px_60px_rgba(30,18,10,0.26)] overflow-hidden"
          >
            <div className="flex-shrink-0 pt-2.5 pb-1 flex justify-center">
              <div className="w-9 h-[4.5px] rounded-full bg-on-surface/[0.16]" />
            </div>

            <div className="flex-shrink-0 flex items-center gap-2.5 px-4 pt-1 pb-3">
              <span className="flex-1 font-serif text-[20px] font-bold tracking-[-0.4px] text-on-surface">
                Your lists
              </span>
              <button
                type="button"
                onClick={onNewList}
                className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-primary/10 text-primary text-[12.5px] font-bold active:scale-95 transition-transform"
              >
                <Plus size={12} strokeWidth={2.6} />
                New
              </button>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 min-h-0 overflow-y-auto scrollbar-hide px-2 pb-safe-6"
            >
              {sections.map((section) => (
                section.items.length > 0 && (
                  <div key={section.label}>
                    <div className="px-3 pt-2.5 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.09em] text-on-surface/40">
                      {section.label}
                    </div>
                    {section.items.map((item) => {
                      const active = item.id === activeId;
                      const tint = item.score !== undefined ? scoreTintStyle(item.score) : null;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={item.onSelect}
                          className={cn(
                            'w-full flex items-center gap-3 px-2.5 py-2.5 rounded-2xl text-left transition-colors',
                            active ? 'bg-primary/[0.08]' : 'active:bg-on-surface/[0.04]',
                          )}
                        >
                          <span
                            className={cn(
                              'flex-shrink-0 w-[38px] h-[38px] rounded-[13px] flex items-center justify-center',
                              !tint && (active ? 'bg-primary text-on-primary' : 'bg-cream-2 text-primary'),
                            )}
                            style={tint ? {
                              background: tint.background,
                              color: tint.color,
                              boxShadow: `inset 0 0 0 1.5px ${tint.ring}`,
                            } : undefined}
                          >
                            {tint
                              ? <span className="text-[13px] font-extrabold tabular-nums">{item.score!.toFixed(1)}</span>
                              : item.icon}
                          </span>
                          <span className="flex flex-col gap-px flex-1 min-w-0">
                            <span className={cn(
                              'text-[15px] tracking-[-0.25px] truncate',
                              active ? 'font-extrabold text-primary' : 'font-semibold text-on-surface',
                            )}>
                              {item.name}
                            </span>
                            <span className="text-[12px] text-on-surface/50 truncate">{item.meta}</span>
                          </span>
                          <span className={cn(
                            'flex-shrink-0 text-primary transition-opacity',
                            active ? 'opacity-100' : 'opacity-0',
                          )}>
                            <Check size={14} strokeWidth={3} />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )
              ))}

              <button
                type="button"
                onClick={onNewList}
                className="w-full flex items-center gap-3 px-2.5 py-2.5 mt-1 rounded-2xl text-left text-primary active:bg-primary/[0.06] transition-colors"
              >
                <span className="flex-shrink-0 w-[38px] h-[38px] rounded-[13px] border border-dashed border-primary/40 flex items-center justify-center">
                  <Plus size={16} strokeWidth={2.4} />
                </span>
                <span className="text-[15px] font-semibold tracking-[-0.25px]">{newListLabel}</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
