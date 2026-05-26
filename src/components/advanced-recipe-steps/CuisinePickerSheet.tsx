// Mobile cuisine bottom-sheet picker. Search + scrollable list.
// Used by StepBasics on phone-mode in place of the native <select>.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search } from 'lucide-react';
import { useBottomSheet } from '../../lib/useBottomSheet';

interface Props {
  isOpen: boolean;
  options: string[];
  selected: string;
  onClose: () => void;
  onSelect: (cuisine: string) => void;
}

export const CuisinePickerSheet: React.FC<Props> = ({ isOpen, options, selected, onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const { dragProps, startDrag } = useBottomSheet(isOpen, onClose);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset the search when the sheet opens.
  useEffect(() => {
    if (isOpen) setQuery('');
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((c) => c.toLowerCase().includes(q));
  }, [query, options]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="cuisine-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
          }}
        >
          <motion.div
            key="cuisine-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            {...dragProps}
            onClick={(e) => e.stopPropagation()}
            className="arb-cuisine-sheet"
          >
            <div className="arb-cuisine-drag" onPointerDown={startDrag} aria-hidden>
              <div className="arb-cuisine-drag-pill" />
            </div>

            <div className="arb-cuisine-head">
              <button
                type="button"
                className="arb-cuisine-close"
                onClick={onClose}
                aria-label="Close cuisine picker"
              >
                <X size={16} />
              </button>
              <div className="arb-cuisine-title">Choose a cuisine</div>
              <div style={{ width: 36 }} aria-hidden />
            </div>

            <div className="arb-cuisine-search-wrap">
              <div className="arb-cuisine-search">
                <Search size={15} />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={`Search ${options.length}+ cuisines…`}
                  autoFocus
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>

            <div className="arb-cuisine-list">
              {filtered.length === 0 ? (
                <div className="arb-cuisine-empty">No matches for "{query}".</div>
              ) : (
                filtered.map((c) => {
                  const isActive = c === selected;
                  return (
                    <button
                      key={c}
                      type="button"
                      className={`arb-cuisine-row${isActive ? ' is-active' : ''}`}
                      onClick={() => {
                        onSelect(c);
                        onClose();
                      }}
                    >
                      {c}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
