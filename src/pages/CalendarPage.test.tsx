// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { CalendarPage } from './CalendarPage';
const mock = vi.hoisted(() => ({ search: '', plans: [] as any[], save: vi.fn(), rate: vi.fn(), navigate: vi.fn() }));
vi.mock('motion/react', () => {
  const cache: Record<string, any> = {};
  return { useReducedMotion: () => true, AnimatePresence: ({ children }: any) => children, motion: new Proxy({}, { get: (_, tag: string) => cache[tag] ??= React.forwardRef(({ initial, animate, exit, transition, layout, layoutId, whileTap, ...props }: any, ref: any) => React.createElement(tag, { ...props, ref })) }) };
});
vi.mock('react-router-dom', () => ({ useNavigate: () => mock.navigate, useLocation: () => ({ search: mock.search }) }));
vi.mock('../lib/usePageBack', () => ({ usePageBack: () => vi.fn() }));
vi.mock('../lib/glass-buttons', () => ({ GlassButton: ({ children, label, onClick }: any) => <button aria-label={label} onClick={onClick}>{children}</button> }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../contexts/CalendarContext', () => ({ useCalendar: () => ({ plans: mock.plans, save: mock.save, loading: false, error: '', refresh: vi.fn(), remove: vi.fn() }) }));
vi.mock('../contexts/ListsContext', () => ({ useLists: () => ({ ratings: [], openAddRestaurantModal: mock.rate }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../lib/calendar-export', () => ({ exportCalendarPlan: vi.fn() }));
vi.mock('../components/calendar/PlanEditor', () => ({ PlanEditor: ({ date }: any) => <div data-testid="editor">{date}</div> }));
vi.mock('../components/calendar/CalendarDialog', () => ({ CalendarDialog: ({ title, children }: any) => <div role="dialog"><h2>{title}</h2>{children}</div> }));
let host: HTMLDivElement, root: Root;
const plan = (id: string, title: string, date: string, kind = 'restaurant', status = 'planned') => ({ id, title, starts_at: new Date(`${date}T19:00:00`).toISOString(), ends_at: new Date(`${date}T21:00:00`).toISOString(), kind, status, review_state: 'pending', details: { location: 'Main Street', notes: '', people: 2, reservation: 'confirmed' } });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-08T12:00:00'));
  mock.navigate.mockClear(); mock.search = '';
  mock.plans = [plan('one', 'Dinner at Lilia', '2026-09-08'), plan('two', 'Lemon pasta', '2026-09-09', 'recipe'), plan('cancelled', 'Old booking', '2026-09-09', 'restaurant', 'cancelled')];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function mount() { await act(async () => root.render(<CalendarPage />)); }
async function click(selector: string) { await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click()); }
async function clickText(text: string) { const button = [...host.querySelectorAll('button')].find(b => b.textContent === text)!; expect(button).toBeTruthy(); await act(async () => button.click()); }
const events = () => host.querySelector('.meal-agenda-list')!.textContent;
it('collapses to the selected week and displays only that day’s events; expands without losing selection', async () => {
  await mount(); expect(events()).toContain('Dinner at Lilia');
  await click('[data-date="2026-09-09"]'); expect(host.querySelector('.meal-board')!.getAttribute('data-collapsed')).toBe('true');
  expect(events()).toContain('Lemon pasta'); expect(events()).not.toContain('Dinner at Lilia'); expect(events()).not.toContain('Old booking');
  expect(host.querySelectorAll('.meal-week-row:not([inert])')).toHaveLength(1);
  await clickText('Show month'); expect(host.querySelector('.meal-board')!.getAttribute('data-collapsed')).toBe('false');
  expect(host.querySelector('[data-date="2026-09-09"]')!.getAttribute('aria-pressed')).toBe('true');
});
it('moves weeks across a month boundary and returns to today', async () => {
  await mount(); await click('[data-date="2026-09-30"]'); await click('[aria-label="Next week"]');
  expect(host.querySelector('[data-date="2026-10-07"]')!.getAttribute('aria-pressed')).toBe('true');
  expect(host.querySelector('h1')!.textContent).toBe('October2026');
  await clickText('Today'); expect(host.querySelector('[data-date="2026-09-08"]')!.getAttribute('aria-pressed')).toBe('true');
});
it('shows month plans in List and opens a day from a list heading', async () => {
  await mount(); await clickText('List'); expect(events()).toContain('Dinner at Lilia'); expect(events()).toContain('Lemon pasta');
  await click('.meal-list-day:nth-child(2)>button'); expect(events()).toContain('Lemon pasta'); expect(events()).not.toContain('Dinner at Lilia');
});
it('combines search and type filters, and reveals cancelled events only when requested', async () => {
  await mount(); await clickText('List'); await clickText('Cooking'); expect(events()).not.toContain('Dinner at Lilia'); expect(events()).toContain('Lemon pasta');
  await clickText('All'); await click('[aria-label="Search plans"]');
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Search plans"]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Lilia'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(events()).toContain('Dinner at Lilia'); expect(events()).not.toContain('Lemon pasta');
  await click('[aria-label="Close plan search"]'); await click('[aria-label="Plan options"]'); await click('input[type="checkbox"]'); expect(events()).toContain('Old booking');
});
it('jumps directly to a month and preserves a valid selected day', async () => {
  await mount(); await click('[data-date="2026-09-30"]'); await click('.meal-month-title'); await clickText('Feb');
  expect(host.querySelector('h1')!.textContent).toBe('February2026'); expect(host.querySelector('[data-date="2026-02-28"]')!.getAttribute('aria-pressed')).toBe('true');
});
it('passes the focused date to the event editor and keeps detail actions available', async () => {
  await mount(); await click('.meal-plan-card'); expect(host.querySelector('[role="dialog"]')!.textContent).toContain('Edit / reschedule');
  await click('[data-date="2026-09-09"]'); await click('[aria-label="Add a plan"]'); expect(host.querySelector('[data-testid="editor"]')!.textContent).toBe('2026-09-09');
});
it('opens search in the month list so plans on other days can be found', async () => {
  await mount(); await click('[aria-label="Search plans"]');
  expect(host.querySelector('[aria-label="Month plans"]')).not.toBeNull(); expect(events()).toContain('Lemon pasta');
});
it('supports keyboard date navigation without forcing month collapse', async () => {
  await mount(); const day = host.querySelector('[data-date="2026-09-08"]')!;
  await act(async () => day.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await act(async () => vi.advanceTimersByTime(20));
  expect(host.querySelector('[data-date="2026-09-09"]')!.getAttribute('aria-pressed')).toBe('true');
  expect(document.activeElement).toBe(host.querySelector('[data-date="2026-09-09"]'));
  expect(host.querySelector('.meal-board')!.getAttribute('data-collapsed')).toBe('false');
});
it('swipes between months and suppresses the click produced by that swipe', async () => {
  await mount(); const grid = host.querySelector('.meal-date-surface')!;
  async function pointer(type: string, x: number) { await act(async () => { const e = new Event(type, { bubbles: true }); Object.assign(e, { clientX: x, clientY: 100, isPrimary: true }); grid.dispatchEvent(e); }); }
  await pointer('pointerdown', 280); await pointer('pointerup', 100);
  expect(host.querySelector('h1')!.textContent).toBe('October2026');
  await click('[data-date="2026-10-09"]');
  expect(host.querySelector('.meal-board')!.getAttribute('data-collapsed')).toBe('false');
  expect(host.querySelector('[data-date="2026-10-08"]')!.getAttribute('aria-pressed')).toBe('true');
});

it('opens the linked restaurant detail page and dismisses the plan popup', async () => {
  mock.plans[0].details.restaurant = { id: 'place/id' };
  await mount(); await click('.meal-plan-card'); await clickText('View restaurant');
  expect(mock.navigate).toHaveBeenCalledWith('/restaurant/place%2Fid');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it.each(['planned', 'completed', 'cancelled'])('opens linked recipe details for a %s plan', async status => {
  mock.plans = [{ ...plan('recipe', 'Lemon pasta', '2026-09-08', 'recipe', status), details: { ...mock.plans[1].details, recipePath: '/recipe/author/meal' } }];
  await mount();
  if (status === 'cancelled') { await click('[aria-label="Plan options"]'); await click('input[type="checkbox"]'); }
  await click('.meal-plan-card'); await clickText('View recipe');
  expect(mock.navigate).toHaveBeenCalledWith('/recipe/author/meal');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
});
it.each(['restaurant', 'recipe'])('does not offer a broken detail link for a manually named %s plan', async kind => {
  mock.plans = [plan('manual', 'Dinner idea', '2026-09-08', kind)];
  await mount(); await click('.meal-plan-card');
  expect(host.querySelector('.meal-view-details')).toBeNull();
  expect(host.querySelector('[role="dialog"]')!.textContent).toContain('Edit / reschedule');
});

it('opens the requested plan from a notification and clears the one-time link', async () => {
  mock.search = '?plan=two';
  await mount();
  expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Lemon pasta');
  expect(mock.navigate).toHaveBeenCalledWith('/calendar', { replace: true });
});
