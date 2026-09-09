import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, List } from 'lucide-react';
import { monthDays, type CalendarPlan } from '../../lib/calendar';
import { localISODate } from '../../lib/utils';

export type CalendarView = 'month' | 'day' | 'agenda';
export function CalendarNavigator({ month, selected, view, plansByDay, onSelect, onMonth, onView, onToday }: {
  month: Date; selected: string; view: CalendarView; plansByDay: Map<string, CalendarPlan[]>;
  onSelect: (date: string, focus?: boolean) => void; onMonth: (month: Date) => void;
  onView: (view: CalendarView) => void; onToday: () => void;
}) {
  const reduced = useReducedMotion();
  const id = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(month.getFullYear());
  const titleRef = useRef<HTMLButtonElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const focusDate = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!focusDate.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-date="${focusDate.current}"]`)?.focus({ preventScroll: true });
    focusDate.current = null;
  }, [selected, month]);
  const today = localISODate();
  const days = monthDays(month);
  // Keep only the weeks that contain a day in this month.
  while (days.length > 28 && days.slice(-7).every(day => day.getMonth() !== month.getMonth())) days.splice(-7);
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7));
  const activeWeek = Math.max(0, weeks.findIndex(week => week.some(day => localISODate(day) === selected)));
  const collapsed = view !== 'month';
  const transition = reduced ? { duration: 0 } : { duration: .38, ease: [.22, 1, .36, 1] as const };
  function move(direction: number) {
    if (view === 'day') {
      const date = new Date(`${selected}T12:00:00`); date.setDate(date.getDate() + direction * 7);
      onSelect(localISODate(date));
    } else onMonth(new Date(month.getFullYear(), month.getMonth() + direction, 1, 12));
  }
  function keyboard(e: React.KeyboardEvent<HTMLButtonElement>, day: Date) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -(day.getDay() + 6) % 7, End: 6 - (day.getDay() + 6) % 7 };
    if (!(e.key in offsets)) return;
    e.preventDefault();
    const next = new Date(day); next.setDate(next.getDate() + offsets[e.key]);
    const key = localISODate(next); focusDate.current = key; onSelect(key, false);
  }
  return <section className="meal-board" aria-label="Meal calendar" data-collapsed={collapsed}>
    <div className="meal-board-toolbar">
      <button className="meal-month-title" ref={titleRef} aria-expanded={pickerOpen} aria-controls={`${id}-picker`} onClick={() => { setPickerYear(month.getFullYear()); setPickerOpen(!pickerOpen); }}>
        <h1>{month.toLocaleDateString([], { month: 'long' })}<span>{month.getFullYear()}</span></h1><ChevronDown size={17} className={pickerOpen ? 'turned' : ''} />
      </button>
      <div className="meal-month-arrows"><button className="meal-icon-button" aria-label={`Previous ${view === 'day' ? 'week' : 'month'}`} onClick={() => move(-1)}><ChevronLeft size={19} /></button><button className="meal-icon-button" aria-label={`Next ${view === 'day' ? 'week' : 'month'}`} onClick={() => move(1)}><ChevronRight size={19} /></button></div>
    </div>
    <AnimatePresence initial={false}>
      {pickerOpen && <motion.div id={`${id}-picker`} className="meal-month-picker" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={transition} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setPickerOpen(false); titleRef.current?.focus(); } }}>
        <div className="meal-picker-year"><button className="meal-icon-button" aria-label="Previous year" disabled={pickerYear <= 2000} onClick={() => setPickerYear(pickerYear - 1)}><ChevronLeft size={17} /></button><strong>{pickerYear}</strong><button className="meal-icon-button" aria-label="Next year" disabled={pickerYear >= 2100} onClick={() => setPickerYear(pickerYear + 1)}><ChevronRight size={17} /></button></div>
        <div className="meal-picker-months">{Array.from({ length: 12 }, (_, m) => <button key={m} aria-pressed={month.getMonth() === m && month.getFullYear() === pickerYear} onClick={() => { onMonth(new Date(pickerYear, m, 1, 12)); setPickerOpen(false); titleRef.current?.focus(); }}>{new Date(2000, m).toLocaleDateString([], { month: 'short' })}</button>)}</div>
      </motion.div>}
    </AnimatePresence>
    <div className="meal-calendar-controls"><button className="meal-today-button" onClick={onToday}><span />Today</button><div className="meal-view-switch" aria-label="Calendar view">
      {(['month', 'day', 'agenda'] as const).map(mode => <button key={mode} aria-pressed={view === mode} onClick={() => onView(mode)}>{view === mode && <motion.span className="meal-view-selection" layoutId={`${id}-view`} transition={transition} />}<span className="meal-view-label">{mode === 'agenda' ? <List size={14} /> : mode === 'month' ? <CalendarDays size={14} /> : null}{mode === 'month' ? 'Month' : mode === 'day' ? 'Day' : 'List'}</span></button>)}
    </div></div>
    <div ref={grid} className="meal-date-surface" onPointerDown={e => { if (!e.isPrimary) return; pointer.current = { x: e.clientX, y: e.clientY }; swiped.current = false; }} onPointerCancel={() => { pointer.current = null; }} onPointerUp={e => {
      const start = pointer.current; pointer.current = null; if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { swiped.current = true; move(dx < 0 ? 1 : -1); }
    }} onClickCapture={e => { if (swiped.current) { e.preventDefault(); e.stopPropagation(); swiped.current = false; } }}>
      <div className="meal-weekdays" aria-hidden="true">{['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i}>{d}</span>)}</div>
      {weeks.map((week, row) => <motion.div className="meal-week-row" key={row} aria-hidden={collapsed && row !== activeWeek} inert={collapsed && row !== activeWeek ? true : undefined}
        initial={false} animate={{ height: collapsed && row !== activeWeek ? 0 : 'auto', opacity: collapsed && row !== activeWeek ? 0 : 1 }} transition={transition}>
        <div className="meal-week-cells">{week.map(day => {
          const key = localISODate(day), plans = plansByDay.get(key) ?? [];
          return <button key={key} data-date={key} className={`meal-day ${day.getMonth() !== month.getMonth() ? 'outside' : ''} ${key === today ? 'today' : ''} ${key === selected ? 'selected' : ''}`}
            tabIndex={key === selected ? 0 : -1} aria-pressed={key === selected} aria-current={key === today ? 'date' : undefined}
            aria-label={`${day.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, ${plans.length} ${plans.length === 1 ? 'plan' : 'plans'}`}
            onKeyDown={e => keyboard(e, day)} onClick={() => onSelect(key)}>
            <span className="meal-day-number">{key === selected && <motion.span className="meal-selected-orb" layoutId={`${id}-day`} transition={transition} />}<span>{day.getDate()}</span></span>
            <span className="meal-day-dots" aria-hidden="true">{plans.slice(0, 3).map(plan => <i key={plan.id} className={`meal-dot ${plan.kind}`} />)}{plans.length > 3 && <i className="meal-more-dot" />}</span>
          </button>;
        })}</div>
      </motion.div>)}
    </div>
    <button className="meal-collapse-control" aria-expanded={!collapsed} onClick={() => onView(collapsed ? 'month' : 'day')}>{collapsed ? <><ChevronDown size={15} />Show month</> : <><ChevronUp size={15} />Focus on selected day</>}</button>
  </section>;
}
