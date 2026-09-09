// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { selectNextMeal } from './home-next-meal';
import type { CalendarPlan } from './calendar';
import type { WishlistItem } from '../contexts/ListsContext';
const now = new Date('2026-09-09T12:00:00Z');
const saved = (id: string, address = 'New York', addedAt = 1): WishlistItem => ({ restaurantId:id, name:id, address, addedAt, cuisine:'Italian', price:'$$', image:'', notes:'', listIds:[] });
const plan = (id: string, starts_at = '2026-09-10T19:00:00Z', status: CalendarPlan['status'] = 'planned'): CalendarPlan => ({id,title:id,starts_at,ends_at:new Date(Date.parse(starts_at)+3600000).toISOString(), status,review_state:'pending',snoozed_until:null,created_at:'',updated_at:'',kind:'restaurant',details:{location:'',people:2,notes:'',reservation:'idea',confirmation:''}});
it('shows the nearest active plan this week and links directly to its details', () => {
  const result = selectNextMeal([plan('later','2026-09-12T19:00:00Z'),plan('next'),plan('cancelled','2026-09-09T19:00:00Z','cancelled')], [saved('place')], [], 'New York', now);
  expect(result.kind).toBe('plan'); expect(result.href).toBe('/calendar?plan=next'); expect(result.detail).toContain('2 people');
});
it('uses an unvisited saved place, preferring the chosen city and then recent saves', () => {
  const result = selectNextMeal([plan('past','2026-09-01T19:00:00Z'),plan('distant','2026-10-01T19:00:00Z')], [saved('visited'),saved('local-old'),saved('local-new','New York',2),saved('away','Boston',3)], ['visited'], 'New York', now);
  expect(result.title).toBe('local-new'); expect(result.href).toBe('/restaurant/local-new');
});
it('has an honest empty state with no fabricated recommendation', () => {
  expect(selectNextMeal([], [saved('visited')], ['visited'], 'New York', now)).toMatchObject({kind:'empty',href:'/search'});
});

it('offers a concise first-rating action only for a confirmed empty account', () => {
  expect(selectNextMeal([], [], [], 'New York', now, true)).toEqual({kind:'starter',title:'Rate your first place',detail:'',action:'Get started',href:'/create'});
  expect(selectNextMeal([], [], [], 'New York', now).kind).toBe('empty');
  expect(selectNextMeal([], [], ['rated'], 'New York', now, true).kind).toBe('empty');
  expect(selectNextMeal([], [saved('place')], [], 'New York', now, true).kind).toBe('saved');
  expect(selectNextMeal([plan('next')], [], [], 'New York', now, true).kind).toBe('plan');
});

import { chooseHomeCard, createHomeCardSession, homeCardChoices, type NextMeal } from './home-next-meal';
const recipeCard: NextMeal = {kind:'recipe',title:'Pasta',detail:'20 min',href:'/recipe/pasta',action:'Cook'};
it('changes topics across fresh launches and freezes the card during navigation and data changes', () => {
  localStorage.clear();
  const choices=[selectNextMeal([], [saved('place')], [], '', now),recipeCard];
  const launch=createHomeCardSession();
  const first=launch('alice',choices);
  expect(launch('alice',[{...recipeCard,title:'Changed'}])).toBe(first);
  const nextLaunch=createHomeCardSession();
  expect(nextLaunch('alice',choices).kind).not.toBe(first.kind);
  expect(launch('bob',[recipeCard])).toEqual(recipeCard);
});
it('does not let a large wishlist crowd out other topics', () => {
  const choices=[...Array.from({length:100},(_,i)=>({...recipeCard,kind:'saved' as const,href:`/restaurant/${i}`})),recipeCard];
  expect(chooseHomeCard(choices,null,()=>0.75).kind).toBe('recipe');
});
it('avoids repeating the same item when only one topic exists', () => {
  const second={...recipeCard,href:'/recipe/salmon'};
  expect(chooseHomeCard([recipeCard,second],recipeCard,()=>0).href).toBe(second.href);
});
it('keeps the new-user prompt and provides multiple useful topics for established users', () => {
  expect(homeCardChoices([],[],[],[],'',now,true).map(c=>c.kind)).toEqual(['starter']);
  expect(homeCardChoices([], [saved('place')], [], [], '', now, false).map(c=>c.kind)).toEqual(['saved','discover']);
});
