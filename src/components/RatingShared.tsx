/* Shared constants and components for rating modals */

export const ALL_TAGS = [
  // Positive – Atmosphere
  'Casual Vibes',
  'Charming Decor',
  'Cozy Atmosphere',
  'Great Views',
  'Hip & Trendy',
  'Intimate',
  'Lively Energy',
  'Outdoor Seating',
  'Quiet & Peaceful',
  'Romantic',
  'Rooftop',
  'Upscale',

  // Positive – Food & Drink
  'Amazing Desserts',
  'Creative Menu',
  'Farm to Table',
  'Fresh Ingredients',
  'Generous Portions',
  'Good Brunch',
  'Good Vegetarian Options',
  'Great Bread',
  'Great Cocktails',
  'Great Coffee',
  'Great Seafood',
  'Great Wine List',
  'Healthy Options',
  'Unique Flavors',

  // Positive – Service & Experience
  'Attentive Staff',
  'Fast Service',
  'Friendly Staff',
  'Good for Groups',
  'Good for Solo Dining',
  'Good Value',
  'Great Service',
  'Kid Friendly',
  'Late Night',
  'Pet Friendly',
  'Quick Bite',
  'Special Occasion',
  'Worth the Wait',

  // Negative
  'Cramped Seating',
  'Inconsistent Quality',
  'Long Wait Times',
  'Noisy',
  'Overpriced',
  'Overhyped',
  'Poor Service',
  'Small Portions',
  'Slow Service',
  'Too Salty',
  'Underwhelming',
];

export const PRICE_RANGES: { signs: string; label: string }[] = [
  { signs: '$', label: '$1–20' },
  { signs: '$$', label: '$20–50' },
  { signs: '$$$', label: '$50–100' },
  { signs: '$$$$', label: '$100+' },
];

export function priceIndexFromAmount(amount: number): number {
  if (amount <= 20) return 0;
  if (amount <= 50) return 1;
  if (amount <= 100) return 2;
  return 3;
}

export const EMOJI_OPTIONS = ['📋', '🍕', '🍣', '🥂', '🕯️', '💎', '⚡', '🌮', '🍜', '☕', '🎉', '🌿', '🔥', '👨‍🍳', '🏖️', '🌃'];

/* ── Custom Calendar ── */
import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronDown, X } from 'lucide-react';
import { cn } from '../lib/utils';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

export const Calendar: React.FC<{
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  onClear?: () => void;
}> = ({ value, onChange, onClear }) => {
  const selected = value ? new Date(value + 'T12:00:00') : null;
  const today = new Date();

  const [viewYear, setViewYear] = useState(selected?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.getMonth() ?? today.getMonth());
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [showYearPicker, setShowYearPicker] = useState(false);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);

  const prevMonth = () => {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1); }
    else setViewMonth(viewMonth - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1); }
    else setViewMonth(viewMonth + 1);
  };

  const handleDayClick = (day: number) => {
    const m = String(viewMonth + 1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    onChange(`${viewYear}-${m}-${d}`);
  };

  const isSelected = (day: number) =>
    selected && selected.getFullYear() === viewYear && selected.getMonth() === viewMonth && selected.getDate() === day;

  const isToday = (day: number) =>
    today.getFullYear() === viewYear && today.getMonth() === viewMonth && today.getDate() === day;

  const isFuture = (day: number) => {
    const d = new Date(viewYear, viewMonth, day);
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return d > todayStart;
  };

  const selectedLabel = selected
    ? selected.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="w-full max-w-xs mx-auto">
      {/* Selected date chip */}
      {selectedLabel && (
        <div className="flex mb-4">
          <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 text-primary text-sm font-semibold">
            {selectedLabel}
            {onClear && (
              <button onClick={onClear} className="text-primary/50 hover:text-primary transition-colors">
                <X size={14} />
              </button>
            )}
          </span>
        </div>
      )}

      {/* Month nav */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-1">
          {/* Month dropdown */}
          <div className="relative">
            <button onClick={() => { setShowMonthPicker(!showMonthPicker); setShowYearPicker(false); }}
              className="flex items-center gap-1 font-serif font-bold text-base hover:text-primary transition-colors">
              {MONTHS[viewMonth]}
              <ChevronDown size={14} className={cn("text-on-surface/40 transition-transform", showMonthPicker && "rotate-180")} />
            </button>
            {showMonthPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMonthPicker(false)} />
                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-xl border border-on-surface/8 z-20 max-h-52 overflow-y-auto min-w-[140px]">
                  {MONTHS.map((m, i) => (
                    <button key={m} onClick={() => { setViewMonth(i); setShowMonthPicker(false); }}
                      className={cn("w-full text-left px-3.5 py-2 text-sm font-medium transition-colors",
                        i === viewMonth ? "text-primary bg-primary/5" : "text-on-surface/70 hover:bg-on-surface/3")}>
                      {m}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* Year dropdown */}
          <div className="relative">
            <button onClick={() => { setShowYearPicker(!showYearPicker); setShowMonthPicker(false); }}
              className="flex items-center gap-1 font-serif font-bold text-base hover:text-primary transition-colors">
              {viewYear}
              <ChevronDown size={14} className={cn("text-on-surface/40 transition-transform", showYearPicker && "rotate-180")} />
            </button>
            {showYearPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowYearPicker(false)} />
                <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-xl border border-on-surface/8 z-20 max-h-52 overflow-y-auto min-w-[80px]">
                  {Array.from({ length: 10 }, (_, i) => today.getFullYear() - 9 + i).map((y) => (
                    <button key={y} onClick={() => { setViewYear(y); setShowYearPicker(false); }}
                      className={cn("w-full text-left px-3.5 py-2 text-sm font-medium transition-colors",
                        y === viewYear ? "text-primary bg-primary/5" : "text-on-surface/70 hover:bg-on-surface/3")}>
                      {y}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={prevMonth} className="p-2 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
            <ChevronLeft size={18} />
          </button>
          <button onClick={nextMonth} className="p-2 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-2">
        {DAYS.map((d) => (
          <div key={d} className="text-center text-[10px] font-bold uppercase tracking-wider text-on-surface/35 py-1">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7">
        {/* Empty cells for offset */}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const sel = isSelected(day);
          const tod = isToday(day);
          const fut = isFuture(day);
          return (
            <button
              key={day}
              onClick={() => !fut && handleDayClick(day)}
              disabled={fut}
              className={cn(
                "relative flex items-center justify-center py-2.5 text-sm font-semibold transition-all rounded-full mx-auto w-10 h-10",
                sel
                  ? "bg-primary text-white"
                  : tod
                    ? "text-primary font-bold"
                    : fut
                      ? "text-on-surface/20 cursor-default"
                      : "text-on-surface/70 hover:bg-on-surface/5"
              )}
            >
              {day}
            </button>
          );
        })}
      </div>
    </div>
  );
};
