// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('../contexts/CalendarContext',()=>({useCalendar:vi.fn()}));
vi.mock('../contexts/ListsContext',()=>({useLists:vi.fn()}));
vi.mock('../contexts/AuthContext',()=>({useAuth:vi.fn()}));
vi.mock('../contexts/RecipesContext',()=>({useRecipes:vi.fn()}));
vi.mock('../lib/haptics',()=>({homeHaptic:vi.fn()}));
vi.mock('../lib/home-restaurant-photo',()=>({getHomeRestaurantPhoto:vi.fn()}));
import { getHomeRestaurantPhoto } from '../lib/home-restaurant-photo';
import { NextMealCard } from './HomeNextMeal';
import type { NextMeal } from '../lib/home-next-meal';
let root: Root; let host: HTMLDivElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(async()=>{ if(root) await act(async()=>root.unmount()); host?.remove(); });
async function mount(element: React.ReactNode) { host=document.createElement('div'); document.body.append(host); root=createRoot(host); await act(async()=>root.render(element)); }
async function event(element:Element, type:string) { await act(async()=>element.dispatchEvent(new Event(type,{bubbles:true}))); }
const meal:NextMeal={kind:'saved',title:'Torrisi',detail:'Italian',action:'Take a look',href:'/restaurant/one',image:'/fallback.jpg',restaurant:{id:'one',name:'Torrisi',address:'New York'}};
it('shows Google and photographer attribution only with the displayed Google image', async()=>{
  vi.mocked(getHomeRestaurantPhoto).mockResolvedValue({url:'https://example.com/google.jpg',google:{url:'https://example.com/google.jpg',authors:[{name:'Alex',uri:'https://maps.google.com/contrib/alex'}]}});
  const open=vi.fn(); await mount(<NextMealCard meal={meal} onOpen={open}/>);
  expect(host.querySelector('img')?.src).toBe('https://example.com/google.jpg');
  await event(host.querySelector('img')!, 'load');
  expect(host.textContent).toContain('Google Maps');
  expect(host.querySelector('a')?.textContent).toBe('Alex');
  expect(host.querySelector('a')?.closest('button')).toBeNull();
  await event(host.querySelector('button')!, 'click');
  expect(open).toHaveBeenCalledWith('/restaurant/one');
  await event(host.querySelector('img')!, 'error');
  expect(host.textContent).not.toContain('Google Maps');
  expect(host.querySelector('img')?.getAttribute('src')).toBe('/fallback.jpg');
  await event(host.querySelector('img')!, 'error');
  expect(host.querySelector('img')).toBeNull();
});
it('does not request Google imagery for recipe cards',async()=>{
  vi.mocked(getHomeRestaurantPhoto).mockClear();
  await mount(<NextMealCard meal={{kind:'recipe',title:'Pasta',detail:'20 min',action:'Cook',href:'/recipe/one'}} onOpen={()=>{}}/>);
  expect(getHomeRestaurantPhoto).not.toHaveBeenCalled();
});
