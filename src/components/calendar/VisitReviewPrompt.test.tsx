// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { VisitReviewPrompt } from './VisitReviewPrompt';
import type { CalendarPlan } from '../../lib/calendar';
const mock = vi.hoisted(() => ({ user: { id: 'alice' } as { id: string } | null, plans: [] as CalendarPlan[], save: vi.fn(), refresh: vi.fn(), rate: vi.fn(), ratings: [] as any[] }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }));
vi.mock('../../contexts/CalendarContext', () => ({ useCalendar: () => ({ plans: mock.plans, loading: false, save: mock.save, refresh: mock.refresh }) }));
vi.mock('../../contexts/ListsContext', () => ({ useLists: () => ({ ratings: mock.ratings, openAddRestaurantModal: mock.rate }) }));
vi.mock('./CalendarDialog', () => ({ CalendarDialog: ({ title, children, onClose }: any) => <div role="dialog"><h2>{title}</h2>{children}<button onClick={onClose}>Close</button></div> }));
const visit: CalendarPlan = { id: 'visit', kind: 'restaurant', title: 'Dinner', starts_at: '2026-09-07T19:00:00Z', ends_at: '2026-09-07T21:00:00Z', created_at: '2026-09-01T10:00:00Z', updated_at: '2026-09-01T10:00:00Z', status: 'planned', review_state: 'pending', snoozed_until: null, details: { location: '', people: 2, notes: '', confirmation: '', reservation: 'confirmed' } };
let root: Root, host: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-08T12:00:00Z')); mock.user = { id: 'alice' }; mock.plans = [visit]; mock.ratings = []; mock.save.mockReset().mockResolvedValue(visit); mock.rate.mockReset(); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function mount() { await act(async () => root.render(<VisitReviewPrompt />)); await act(async () => { await vi.advanceTimersByTimeAsync(1300); }); }
async function click(label: string) { const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); }
it('opens after a past visit and passes its actual date to the existing rating flow', async () => {
  await mount(); expect(host.textContent).toContain('How was Dinner?');
  await click(' Rate my visit');
  expect(mock.rate).toHaveBeenCalledWith(expect.objectContaining({ id: 'calendar-visit', name: 'Dinner' }), 'new-visit', '2026-09-07');
  expect(host.querySelector('[role=dialog]')).toBeNull();
});
it('snoozes durably for one day and keeps the prompt open on save failure', async () => {
  await mount(); mock.save.mockRejectedValueOnce(new Error('offline')); await click('Remind me tomorrow');
  expect(host.textContent).toContain('offline'); expect(host.querySelector('[role=dialog]')).not.toBeNull();
  await click('Remind me tomorrow'); expect(mock.save).toHaveBeenLastCalledWith(expect.objectContaining({ snoozed_until: new Date(Date.now() + 86400000).toISOString() }));
  expect(host.querySelector('[role=dialog]')).toBeNull();
});
it('records that the visit did not happen instead of collecting an inaccurate rating', async () => {
  await mount(); await click('I didn’t go'); expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' })); expect(mock.rate).not.toHaveBeenCalled();
});
it('does not interrupt guests or ask about upcoming meals', async () => {
  mock.user = null; await mount(); expect(host.textContent).toBe('');
  mock.user = { id: 'alice' }; mock.plans = [{ ...visit, ends_at: '2026-09-09T20:00:00Z' }]; await mount(); expect(host.textContent).toBe('');
});
