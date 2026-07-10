import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useBottomSheet } from '../lib/useBottomSheet';

// iOS-style wheel picker. A scroll-snap container with five visible rows; the
// center row is the selection. Items above/below fade out via a mask gradient,
// and a subtle pill highlights the center row so the selected value reads at a
// glance. Used by TimeWheelPicker (hours+minutes) and NumberWheelPicker
// (single value like servings).

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 5;
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS;
const PADDING = ((VISIBLE_ITEMS - 1) / 2) * ITEM_HEIGHT;

// The fade mask that makes edge items drop off gently.
const WHEEL_MASK =
  'linear-gradient(to bottom, transparent 0%, rgba(0,0,0,0.15) 14%, rgba(0,0,0,0.6) 32%, black 44%, black 56%, rgba(0,0,0,0.6) 68%, rgba(0,0,0,0.15) 86%, transparent 100%)';

interface WheelProps {
  values: number[];
  initialIdx: number;
  onChange: (idx: number) => void;
  format?: (value: number) => string;
  ariaLabel?: string;
}

const Wheel: React.FC<WheelProps> = ({ values, initialIdx, onChange, format, ariaLabel }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(initialIdx);

  // Set the initial scroll position exactly once on mount. Mounting happens
  // inside AnimatePresence so the parent picker gives us a fresh start each
  // time it opens.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = initialIdx * ITEM_HEIGHT;
    setActiveIdx(initialIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const rawIdx = el.scrollTop / ITEM_HEIGHT;
    const idx = Math.max(0, Math.min(values.length - 1, Math.round(rawIdx)));
    if (idx !== activeIdx) {
      setActiveIdx(idx);
      onChange(idx);
    }
  };

  const handleRowTap = (idx: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: idx * ITEM_HEIGHT, behavior: 'smooth' });
    setActiveIdx(idx);
    onChange(idx);
  };

  return (
    <div className="relative flex-1" aria-label={ariaLabel}>
      {/* Center selection pill */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-2 top-1/2 -translate-y-1/2 rounded-xl bg-on-surface/[0.05]"
        style={{ height: ITEM_HEIGHT }}
      />
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative overflow-y-auto scrollbar-hide overscroll-contain"
        style={{
          height: WHEEL_HEIGHT,
          scrollSnapType: 'y mandatory',
          WebkitMaskImage: WHEEL_MASK,
          maskImage: WHEEL_MASK,
        }}
      >
        <div style={{ height: PADDING }} aria-hidden />
        {values.map((v, i) => (
          <button
            key={v}
            type="button"
            onClick={() => handleRowTap(i)}
            className="w-full flex items-center justify-center"
            style={{ height: ITEM_HEIGHT, scrollSnapAlign: 'center' }}
            tabIndex={-1}
          >
            <span
              className={cn(
                'text-[30px] font-serif font-semibold tabular-nums transition-colors duration-150',
                i === activeIdx ? 'text-on-surface' : 'text-on-surface/35',
              )}
            >
              {format ? format(v) : v}
            </span>
          </button>
        ))}
        <div style={{ height: PADDING }} aria-hidden />
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────────────────────────
   Shared bottom-sheet shell used by every picker in this file.
   ─────────────────────────────────────────────────────────────── */
const PickerSheet: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  onConfirm: () => void;
  confirmLabel?: string;
}> = ({ isOpen, onClose, title, children, onConfirm, confirmLabel = 'Done' }) => {
  const { dragProps } = useBottomSheet(isOpen, onClose);
  return (
  <AnimatePresence>
    {isOpen && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[200] flex items-end justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          {...dragProps}
          onClick={(e) => e.stopPropagation()}
          className="bg-surface w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl pt-3 pb-safe-6 px-6"
        >
          <div className="flex items-center justify-center mb-3">
            <div className="w-10 h-1 rounded-full bg-on-surface/15" />
          </div>
          <p className="text-center font-serif font-bold text-lg mb-5">{title}</p>
          {children}
          <button
            type="button"
            onClick={onConfirm}
            className="w-full mt-6 py-3.5 bg-primary text-white rounded-full font-semibold text-sm shadow-[0_6px_20px_-6px_rgba(188,108,97,0.55)] active:scale-[0.98] transition-transform"
          >
            {confirmLabel}
          </button>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
  );
};

/* ─────────────────────────────────────────────────────────────────
   TimeWheelPicker — two wheels (hours + minutes) for prep/cook time.
   Minutes step in intervals of 5 so the wheel stays scannable.
   ─────────────────────────────────────────────────────────────── */
const snapMinutes = (m: number) => {
  const snapped = Math.round(m / 5) * 5;
  return Math.max(0, Math.min(55, snapped));
};

const HOURS_VALUES = Array.from({ length: 13 }, (_, i) => i); // 0..12
const MINUTES_VALUES = Array.from({ length: 12 }, (_, i) => i * 5); // 0, 5, 10 … 55

export const TimeWheelPicker: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (hours: number, minutes: number) => void;
  initialHours: number;
  initialMinutes: number;
  title: string;
}> = ({ isOpen, onClose, onConfirm, initialHours, initialMinutes, title }) => {
  const startHoursIdx = Math.max(0, Math.min(12, initialHours));
  const startMinutesIdx = Math.max(0, MINUTES_VALUES.indexOf(snapMinutes(initialMinutes)));

  const [hoursIdx, setHoursIdx] = useState(startHoursIdx);
  const [minutesIdx, setMinutesIdx] = useState(startMinutesIdx);

  // When the sheet reopens with new initial values, sync local state. The
  // Wheel children also remount on open thanks to AnimatePresence, so their
  // internal scroll positions line up.
  useEffect(() => {
    if (isOpen) {
      setHoursIdx(startHoursIdx);
      setMinutesIdx(startMinutesIdx);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleConfirm = () => {
    onConfirm(HOURS_VALUES[hoursIdx], MINUTES_VALUES[minutesIdx]);
    onClose();
  };

  return (
    <PickerSheet isOpen={isOpen} onClose={onClose} title={title} onConfirm={handleConfirm}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col items-center">
          <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-semibold mb-2">Hours</p>
          <Wheel
            values={HOURS_VALUES}
            initialIdx={startHoursIdx}
            onChange={setHoursIdx}
            ariaLabel="Hours"
          />
        </div>
        <div className="flex flex-col items-center">
          <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-semibold mb-2">Minutes</p>
          <Wheel
            values={MINUTES_VALUES}
            initialIdx={startMinutesIdx}
            onChange={setMinutesIdx}
            format={(v) => String(v).padStart(2, '0')}
            ariaLabel="Minutes"
          />
        </div>
      </div>
    </PickerSheet>
  );
};

/* ─────────────────────────────────────────────────────────────────
   NumberWheelPicker — single wheel for values like servings.
   ─────────────────────────────────────────────────────────────── */
export const NumberWheelPicker: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (value: number) => void;
  initialValue: number;
  min?: number;
  max?: number;
  title: string;
  unitLabel?: string;
}> = ({ isOpen, onClose, onConfirm, initialValue, min = 1, max = 24, title, unitLabel }) => {
  const values = React.useMemo(
    () => Array.from({ length: max - min + 1 }, (_, i) => min + i),
    [min, max],
  );
  const startIdx = Math.max(0, Math.min(values.length - 1, values.indexOf(initialValue)));
  const [idx, setIdx] = useState(startIdx >= 0 ? startIdx : 0);

  useEffect(() => {
    if (isOpen) setIdx(startIdx >= 0 ? startIdx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const handleConfirm = () => {
    onConfirm(values[idx]);
    onClose();
  };

  return (
    <PickerSheet isOpen={isOpen} onClose={onClose} title={title} onConfirm={handleConfirm}>
      <div className="flex flex-col items-center">
        {unitLabel && (
          <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-semibold mb-2">{unitLabel}</p>
        )}
        <div className="w-40">
          <Wheel values={values} initialIdx={startIdx} onChange={setIdx} ariaLabel={title} />
        </div>
      </div>
    </PickerSheet>
  );
};
