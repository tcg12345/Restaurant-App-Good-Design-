// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { GroupCustomLobby, GroupRestaurantPicker } from './GroupCustomLobby';
import type { GroupRoom } from '../lib/group-swipe';
const { search }=vi.hoisted(()=>({search:vi.fn()}));
vi.mock('../lib/places',async original=>({...await original<object>(),searchPlacesByText:search}));
vi.mock('../lib/useMichelinMatch',()=>({useMichelinMatch:()=>({michelin:null})}));
let root:Root, host:HTMLDivElement, room:GroupRoom;
const run=vi.fn().mockResolvedValue({}), preview=vi.fn();
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.clearAllMocks();
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
 room={id:'room',code:'CODE1234',host:'host',source:'custom',allowGuestAdds:false,shortlistVersion:3,status:'lobby',round:1,location:{label:'City',lat:0,lng:0},count:2,radius:5000,deck:['first','second'].map(id=>({id,name:id,cuisine:'Italian',address:'1 Main St',rating:4,priceLevel:2,photoUrl:null,distance:0,fit:0,reason:'Picked',addedBy:'host'})),results:[],vetoed:[],members:{host:{name:'Host',ready:false,votes:{},vetoUsed:false},guest:{name:'Guest',ready:false,votes:{},vetoUsed:false}}};
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
async function mount(userId='host'){await act(async()=>root.render(React.createElement(GroupCustomLobby,{room,userId,busy:false,run,onPreview:preview})));}
function button(text:string){return Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find(el=>el.textContent?.includes(text))!;}
it('keeps host-only guests out of search and lets them mark ready without adding places',async()=>{
 await mount('guest');expect(button('Add a restaurant')).toBeUndefined();
 await act(async()=>button('I’m ready').click());expect(run).toHaveBeenCalledWith('custom_ready',{version:3});
 expect(run).not.toHaveBeenCalledWith('generate',expect.anything());
});
it('waits for guest readiness and starts the exact version without generation',async()=>{
 await mount();expect(button('Start swiping').disabled).toBe(true);
 room={...room,members:{...room.members,guest:{...room.members.guest,ready:true}}};await mount();
 await act(async()=>button('Start swiping').click());expect(run).toHaveBeenCalledWith('start',{version:3});
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Preview first"]')!.click());expect(preview).toHaveBeenCalledWith(room.deck[0]);
});
it('caps guests at two picks and exposes removal only for their own picks',async()=>{
 room.allowGuestAdds=true;room.deck=room.deck.map(p=>({...p,addedBy:'guest'}));await mount('guest');
 expect(button('Add a restaurant')).toBeUndefined();expect(host.textContent).toContain('Your two suggestions are in');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Remove first"]')!.click());expect(run).toHaveBeenCalledWith('custom_remove',{place:'first'});
});
it('debounces restaurant search, marks duplicate results, and adds only a place ID',async()=>{
 vi.useFakeTimers();search.mockResolvedValue([{id:'first',name:'Already added',address:'1 Main',types:['restaurant']},{id:'third',name:'New pick',address:'2 Main',types:['restaurant']}]);
 const add=vi.fn().mockResolvedValue({});await act(async()=>root.render(React.createElement(GroupRestaurantPicker,{room,userId:'host',busy:false,onAdd:add,onClose:vi.fn(),error:'A recoverable add error'})));
 const input=host.querySelector('input')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'New');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(search).not.toHaveBeenCalled();await act(async()=>vi.advanceTimersByTime(350));
 expect(host.querySelector<HTMLButtonElement>('[aria-label="Already added already in shortlist"]')!.disabled).toBe(true);
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Add New pick"]')!.click());expect(add).toHaveBeenCalledWith('third');
 expect(host.querySelector('[role="alert"]')?.textContent).toContain('recoverable');
});
