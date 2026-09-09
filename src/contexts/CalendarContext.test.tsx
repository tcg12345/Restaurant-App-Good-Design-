// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { CalendarProvider, useCalendar } from './CalendarContext';
import type { CalendarPlan, PlanDraft } from '../lib/calendar';
const mock = vi.hoisted(() => ({ user: null as null | { id: string }, query: vi.fn() }));
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: mock.user }) }));
vi.mock('../lib/supabase', () => ({ supabaseConfigured: true, supabase: { from: () => {
  const builder: any = {};
  for (const key of ['select', 'eq', 'order', 'upsert', 'delete']) builder[key] = () => builder;
  builder.range = () => mock.query(); builder.single = () => mock.query();
  builder.then = (resolve: any, reject: any) => mock.query().then(resolve, reject);
  return builder;
} } }));
const draft: PlanDraft = { id: 'one', title: 'Dinner', kind: 'restaurant', starts_at: '2026-09-08T19:00:00Z', ends_at: '2026-09-08T21:00:00Z', status: 'planned', review_state: 'pending', snoozed_until: null,
  details: { location: '', people: 2, notes: '', reservation: 'idea', confirmation: '' } };
const stored = { ...draft, created_at: draft.starts_at, updated_at: draft.starts_at };
let root: Root, host: HTMLDivElement, context: ReturnType<typeof useCalendar>;
function Consumer() { context = useCalendar(); return <div>{context.plans.map(p => p.title).join(',')}</div>; }
async function render() { await act(async () => root.render(<CalendarProvider><Consumer /></CalendarProvider>)); }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); mock.user = null; mock.query.mockReset(); mock.query.mockResolvedValue({ data: [], error: null }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it('persists guest create/edit/delete without sending requests to the cloud', async () => {
  await render();
  await act(async () => { await context.save(draft); });
  expect(host.textContent).toBe('Dinner'); expect(JSON.parse(localStorage.getItem('goodeats-calendar-v1:guest')!)).toHaveLength(1);
  await act(async () => { await context.save({ ...draft, title: 'Lunch' }); });
  expect(context.plans).toHaveLength(1); expect(context.plans[0].title).toBe('Lunch');
  await act(async () => { await context.remove('one'); });
  expect(context.plans).toEqual([]); expect(mock.query).not.toHaveBeenCalled();
});
it('isolates caches by account and rejects a late response after switching accounts', async () => {
  let resolveOld!: (result: unknown) => void;
  mock.user = { id: 'alice' }; mock.query.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
  localStorage.setItem('goodeats-calendar-v1:alice', JSON.stringify([stored])); await render(); expect(host.textContent).toBe('Dinner');
  mock.user = { id: 'bob' }; await render(); expect(host.textContent).toBe('');
  await act(async () => resolveOld({ data: [stored], error: null }));
  expect(host.textContent).toBe(''); expect(localStorage.getItem('goodeats-calendar-v1:bob')).toBe('[]');
});
it('keeps cached plans on fetch failure and never presents failed writes as saved', async () => {
  mock.user = { id: 'alice' }; localStorage.setItem('goodeats-calendar-v1:alice', JSON.stringify([stored]));
  mock.query.mockResolvedValue({ data: null, error: new Error('offline') });
  await render(); expect(context.error).toContain('Couldn’t sync'); expect(context.plans).toHaveLength(1);
  await act(async () => { await expect(context.save({ ...draft, title: 'Changed' })).rejects.toThrow('Couldn’t save'); });
  expect(context.plans[0].title).toBe('Dinner');
  await act(async () => { await expect(context.remove('one')).rejects.toThrow('Couldn’t delete'); });
  expect(context.plans).toHaveLength(1);
});
it('surfaces unavailable guest storage without pretending a plan is durable', async () => {
  await render(); vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
  await act(async () => { await expect(context.save(draft)).rejects.toThrow('Device storage'); });
  expect(context.plans).toEqual([]);
});
