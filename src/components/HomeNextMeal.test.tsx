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

import { MemoryRouter } from 'react-router-dom';
import { HomeNextMeal } from './HomeNextMeal';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useCalendar } from '../contexts/CalendarContext';
import { useRecipes } from '../contexts/RecipesContext';
function homeData(id:string, extra:Record<string,unknown>={}) {
 vi.mocked(useAuth).mockReturnValue({user:{id}} as any);
 vi.mocked(useLists).mockReturnValue({wishlist:[],ratings:[],homeMeals:[],lists:[],cloudSyncReady:false,cloudLoaded:false,...extra} as any);
 vi.mocked(useRecipes).mockReturnValue({myRecipes:[],cloudSyncReady:false,loading:true} as any);
 vi.mocked(useCalendar).mockReturnValue({plans:[],loading:true,error:false} as any);
 vi.mocked(getHomeRestaurantPhoto).mockResolvedValue(null);
}
it('paints a cached restaurant card before cloud sync completes and keeps it stable afterward',async()=>{
 homeData('cached-user',{wishlist:[{restaurantId:'one',name:'Cached place',address:'New York'}]});
 await mount(<MemoryRouter><HomeNextMeal city="New York" now={new Date()}/></MemoryRouter>);
 expect(host.textContent).toContain('Cached place');expect(host.querySelector('[role="status"]')).toBeNull();
 homeData('cached-user',{wishlist:[{restaurantId:'two',name:'Cloud place',address:'New York'}],cloudSyncReady:true,cloudLoaded:true});
 vi.mocked(useRecipes).mockReturnValue({myRecipes:[],cloudSyncReady:true,loading:false} as any);
 vi.mocked(useCalendar).mockReturnValue({plans:[],loading:false,error:false} as any);
 await act(async()=>root.render(<MemoryRouter><HomeNextMeal city="New York" now={new Date()}/></MemoryRouter>));
 expect(host.textContent).toContain('Cached place');
});
it('does not leave an empty cache on an endless skeleton after failed syncs',async()=>{
 homeData('failed-user',{cloudLoaded:true});
 vi.mocked(useRecipes).mockReturnValue({myRecipes:[],cloudSyncReady:false,loading:false} as any);
 vi.mocked(useCalendar).mockReturnValue({plans:[],loading:false,error:true} as any);
 await mount(<MemoryRouter><HomeNextMeal city="New York" now={new Date()}/></MemoryRouter>);
 expect(host.querySelector('[role="status"]')).toBeNull();expect(host.textContent).toContain('Something new for dinner');expect(host.textContent).not.toContain('Rate your first place');
});
