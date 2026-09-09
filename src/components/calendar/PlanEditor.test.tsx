// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { PlanEditor } from './PlanEditor';
const mock = vi.hoisted(() => ({ save: vi.fn(), saved: vi.fn(), search: vi.fn() }));
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'alice' } }) }));
vi.mock('../../contexts/CalendarContext', () => ({ useCalendar: () => ({ plans: [], save: mock.save }) }));
vi.mock('../../contexts/ListsContext', () => ({ useLists: () => ({ wishlist: [], ratings: [], homeMeals: [], lists: [] }) }));
vi.mock('../../contexts/RecipesContext', () => ({ useRecipes: () => ({ myRecipes: [{ id: 'pasta', title: 'Lemon pasta', prepTimeMinutes: 10, cookTimeMinutes: 20 }] }) }));
vi.mock('../../contexts/HomeLocationContext', () => ({ useHomeLocation: () => null }));
vi.mock('../../lib/cuisine', () => ({ cuisineLabel: () => '' }));
vi.mock('../../lib/places', () => ({ searchPlacesByText: mock.search, priceLevelToString: () => '$$' }));
vi.mock('./CalendarDialog', () => ({ CalendarDialog: ({ title, children }: any) => <div><h2>{title}</h2>{typeof children === 'function' ? children(() => {}) : children}</div> }));
let root: Root, host: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; mock.save.mockReset().mockImplementation(async p => p); mock.saved.mockReset(); mock.search.mockReset().mockResolvedValue([]); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function mount(kind: 'recipe' | 'restaurant' = 'restaurant') { await act(async () => root.render(<PlanEditor date="2026-09-08" initialKind={kind} onClose={() => {}} onSaved={mock.saved} />)); }
async function input(selector: string, value: string) { const field = host.querySelector<HTMLInputElement>(selector)!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function submit() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
async function click(text: string) { const button = [...host.querySelectorAll('button')].find(b => b.textContent?.includes(text))!; await act(async () => button.click()); }
it('saves a cooking plan with a linked recipe and its prep/cook duration', async () => {
  await mount('recipe'); await input('input[maxlength="160"]', 'Lemon'); await click('Lemon pasta'); await click('Continue'); await submit();
  expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'recipe', title: 'Lemon pasta', details: expect.objectContaining({ recipePath: '/recipe/pasta' }) }));
  const p = mock.save.mock.calls[0][0]; expect(+new Date(p.ends_at) - +new Date(p.starts_at)).toBe(30 * 60000);
});
it('retains the draft and its stable id after a failed save so retries cannot duplicate it', async () => {
  await mount(); await input('input[maxlength="160"]', 'Dinner'); await click('Continue'); mock.save.mockRejectedValueOnce(new Error('offline')); await submit();
  expect(host.textContent).toContain('offline'); expect(mock.saved).not.toHaveBeenCalled(); expect(host.querySelector('.plan-selection-summary')!.textContent).toContain('Dinner');
  await click('Back'); expect(host.querySelector<HTMLInputElement>('input[maxlength="160"]')!.value).toBe('Dinner'); await click('Continue');
  await submit(); expect(mock.save.mock.calls[0][0].id).toBe(mock.save.mock.calls[1][0].id); expect(mock.saved).toHaveBeenCalledTimes(1);
});
it('does not crash while invalid or extreme duration input is being edited', async () => {
  await mount(); await input('input[maxlength="160"]', 'Dinner'); await click('Continue'); await act(async () => host.querySelector<HTMLButtonElement>('.plan-duration-options .plan-custom-choice')!.click()); await input('input[max="1440"]', '999999999999999'); await submit();
  expect(mock.save).not.toHaveBeenCalled(); expect(host.textContent).toContain('Choose a valid date');
});
it('links a searched restaurant to its real identifier', async () => {
  mock.search.mockResolvedValue([{ id: 'place-123', name: 'Local Table', address: 'Main St', fullAddress: '1 Main St', types: [], priceLevel: 2 }]);
  await mount(); await input('input[maxlength="160"]', 'Local Table'); await click('Find this restaurant'); await click('1 Main St'); await click('Continue'); await submit();
  expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ restaurant: expect.objectContaining({ id: 'place-123' }), location: '1 Main St' }) }));
});

it('preserves a completed review when an unchanged cloud timestamp uses a different ISO offset', async () => {
  const plan: any = { id: 'past', title: 'Dinner', kind: 'restaurant', starts_at: '2026-09-07T19:00:00+00:00', ends_at: '2026-09-07T21:00:00+00:00', status: 'completed', review_state: 'reviewed', snoozed_until: null, details: { location: '', people: 2, notes: '', reservation: 'confirmed', confirmation: '' } };
  await act(async () => root.render(<PlanEditor date="2026-09-08" plan={plan} onClose={() => {}} onSaved={mock.saved} />));
  await click('Continue'); await submit();
  expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', review_state: 'reviewed' }));
});

it('requires a name before continuing and keeps optional fields out of the initial step', async () => {
  await mount(); await click('Continue');
  expect(mock.save).not.toHaveBeenCalled(); expect(host.textContent).toContain('Add a restaurant or a name');
  expect(host.querySelector('.plan-date-picker')).toBeNull(); expect(host.querySelector('textarea')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('input'));
});
it('saves tapped scheduling, duration, people and reservation choices, preserving them when going back', async () => {
  await mount(); await input('input[maxlength="160"]', 'Dinner'); await click('Continue');
  await click('Tomorrow');
  await act(async () => host.querySelector<HTMLButtonElement>('.plan-time-options button:nth-child(3)')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('.plan-duration-options button:nth-child(2)')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="More people"]')!.click());
  await click('Booked'); await click('A few extra details'); await input('input[maxlength="160"]', 'TABLE-42');
  await click('Back'); await click('Continue'); await submit();
  const p = mock.save.mock.calls[0][0], expected = new Date(); expected.setDate(expected.getDate() + 1);
  expect(new Date(p.starts_at).getDate()).toBe(expected.getDate());
  expect(new Date(p.starts_at).getHours()).toBe(18); expect(new Date(p.starts_at).getMinutes()).toBe(30);
  expect(+new Date(p.ends_at) - +new Date(p.starts_at)).toBe(90 * 60000);
  expect(p.details).toMatchObject({ people: 3, reservation: 'confirmed', confirmation: 'TABLE-42' });
});
it('keeps separate drafts when switching dining and cooking choices', async () => {
  await mount(); await input('input[maxlength="160"]', 'Favorite table'); await click('Cooking at home');
  await input('input[maxlength="160"]', 'Lemon pasta'); await click('Dining out');
  expect(host.querySelector<HTMLInputElement>('input[maxlength="160"]')!.value).toBe('Favorite table');
  await click('Cooking at home'); expect(host.querySelector<HTMLInputElement>('input[maxlength="160"]')!.value).toBe('Lemon pasta');
});
it('accepts custom times and durations while keeping the summary accurate', async () => {
  await mount(); await input('input[maxlength="160"]', 'Breakfast'); await click('Continue');
  await click('Other time'); await input('input[type="time"]', '09:15');
  await act(async () => host.querySelector<HTMLButtonElement>('.plan-duration-options .plan-custom-choice')!.click());
  await input('input[max="1440"]', '75'); await submit();
  const p = mock.save.mock.calls[0][0]; expect(new Date(p.starts_at).getHours()).toBe(9); expect(new Date(p.starts_at).getMinutes()).toBe(15);
  expect(+new Date(p.ends_at) - +new Date(p.starts_at)).toBe(75 * 60000);
});
