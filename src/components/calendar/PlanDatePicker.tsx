import React, { useId, useRef, useState } from 'react';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { localISODate } from '../../lib/utils';
import { monthDays } from '../../lib/calendar';

const labelFor = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: new Date(`${value}T12:00:00`).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });

export function PlanDatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date(`${value}T12:00:00`));
  const pickerId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const weekend = new Date(today);
  const weekendOffset = (6 - today.getDay() + 7) % 7;
  const nextWeekend = weekendOffset <= 1 || today.getDay() === 0;
  weekend.setDate(today.getDate() + weekendOffset + (weekendOffset <= 1 ? 7 : 0));
  const quickDates = [{ label: 'Today', date: today }, { label: 'Tomorrow', date: tomorrow }, { label: nextWeekend ? 'Next weekend' : 'This weekend', date: weekend }];
  const isQuickDate = quickDates.some(item => localISODate(item.date) === value);
  const choose = (date: string) => { onChange(date); setOpen(false); };
  const moveMonth = (delta: number) => setMonth(previous => new Date(previous.getFullYear(), previous.getMonth() + delta, 1, 12));
  const days = monthDays(month);

  function navigateDates(event: React.KeyboardEvent, date: Date) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -((date.getDay() + 6) % 7), End: 6 - ((date.getDay() + 6) % 7) };
    if (!(event.key in offsets)) return;
    event.preventDefault();
    const next = new Date(date); next.setDate(date.getDate() + offsets[event.key]);
    if (next.getFullYear() < 2000 || next.getFullYear() > 2100) return;
    setMonth(new Date(next.getFullYear(), next.getMonth(), 1, 12));
    requestAnimationFrame(() => grid.current?.querySelector<HTMLButtonElement>(`[data-date="${localISODate(next)}"]`)?.focus());
  }

  return <div className="plan-date-picker">
    <div className="plan-field-heading"><span><CalendarDays size={16} /> Day</span><span>{new Date(`${value}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</span></div>
    <div className="plan-date-options" role="group" aria-label="Date shortcuts">
      {quickDates.map(item => <button type="button" key={item.label} aria-pressed={localISODate(item.date) === value} onClick={() => choose(localISODate(item.date))}>
        <strong>{item.label}</strong><span>{labelFor(localISODate(item.date))}</span>
      </button>)}
      <button type="button" className="plan-date-custom" ref={trigger} aria-label="Choose another date" aria-expanded={open} aria-controls={pickerId} aria-pressed={!isQuickDate} onClick={() => { setMonth(new Date(`${value}T12:00:00`)); setOpen(!open); }}>
        <strong>{isQuickDate ? 'Pick a date' : labelFor(value)}</strong><span><CalendarDays size={13} /> Calendar <ChevronDown size={12} /></span>
      </button>
    </div>
    {open && <div className="plan-date-popover" id={pickerId} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
      <div className="plan-date-month"><button type="button" aria-label="Previous month" disabled={month.getFullYear() <= 2000 && month.getMonth() === 0} onClick={() => moveMonth(-1)}><ChevronLeft size={18} /></button><strong aria-live="polite">{month.toLocaleDateString([], { month: 'long', year: 'numeric' })}</strong><button type="button" aria-label="Next month" disabled={month.getFullYear() >= 2100 && month.getMonth() === 11} onClick={() => moveMonth(1)}><ChevronRight size={18} /></button></div>
      <div className="plan-date-weekdays" aria-hidden="true">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((day, i) => <span key={i}>{day}</span>)}</div>
      <div className="plan-date-grid" ref={grid} role="group" aria-label="Choose a date">
        {days.map(date => {
          const key = localISODate(date);
          return <button type="button" key={key} data-date={key} data-outside={date.getMonth() !== month.getMonth()} aria-pressed={key === value} aria-current={key === localISODate(today) ? 'date' : undefined}
            disabled={date.getFullYear() < 2000 || date.getFullYear() > 2100}
            aria-label={date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            onKeyDown={e => navigateDates(e, date)} onClick={() => { choose(key); trigger.current?.focus(); }}>{date.getDate()}{key === value && <Check size={9} />}</button>;
        })}
      </div>
    </div>}
  </div>;
}
