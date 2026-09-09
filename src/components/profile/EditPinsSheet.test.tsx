// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditPinsSheet, type PinCandidate } from './EditPinsSheet';
const mock = vi.hoisted(() => ({ replace: vi.fn(), toggle: vi.fn(), close: vi.fn() }));
vi.mock('../../contexts/SettingsContext', () => ({ useSettings: () => ({ phoneMode: true }) }));
vi.mock('../../lib/pins-store', async () => {
 const { useState } = await import('react');
 const { togglePin } = await import('../../lib/pins');
 return { usePins: () => {
  const [pins,setPins] = useState([] as any[]);
  return { pins, toggle: async (pin: any) => { mock.toggle(pin);setPins(previous => togglePin(previous,pin) ?? previous); }, replace: async (next: any[]) => { mock.replace(next);setPins(next);return true; } };
 } };
});
const candidates: PinCandidate[] = [
 { pin: {type:'restaurant',id:'1'},title:'Juniper',subtitle:'Italian'},
 { pin: {type:'restaurant',id:'2'},title:'Garden',subtitle:'French'},
 { pin: {type:'meal',id:'3'},title:'Tomato pasta'},
 { pin: {type:'guide',id:'4'},title:'A weekend away'},
 { pin: {type:'recipe',id:'5'},title:'Legacy recipe'},
];
let host: HTMLDivElement, root: Root;
beforeEach(async () => {
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
 vi.clearAllMocks(); window.scrollTo=vi.fn();
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(<EditPinsSheet open onClose={mock.close} candidates={candidates}/>));
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();expect(document.body.style.overflow).toBe('');});
async function clickRow(index:number) { await act(async()=>host.querySelectorAll<HTMLButtonElement>('.pins-editor-row')[index].click()); }
it('previews up to three pins and lets users remove one to make room',async()=>{
 expect(host.querySelectorAll('.pins-editor-slot.is-empty')).toHaveLength(3);
 await clickRow(0);await clickRow(1);await clickRow(2);
 expect(host.querySelectorAll('.pins-editor-slot.is-filled')).toHaveLength(3);
 expect(host.querySelectorAll<HTMLButtonElement>('.pins-editor-row')[3].disabled).toBe(true);
 expect(host.textContent).toContain('Unpin one to add another');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Unpin Juniper"]')!.click());
 expect(host.querySelectorAll('.pins-editor-slot.is-filled')).toHaveLength(2);
 expect(host.querySelectorAll<HTMLButtonElement>('.pins-editor-row')[3].disabled).toBe(false);
});
it('searches every content type and includes both recipe formats in Recipes',async()=>{
 const input=host.querySelector('input')!;
 await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'weekend');input.dispatchEvent(new Event('input',{bubbles:true}));});
 expect(host.querySelectorAll('.pins-editor-row')).toHaveLength(1);
 expect(host.querySelector('.pins-editor-row')!.textContent).toContain('A weekend away');
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!.click());
 await act(async()=>{const select=host.querySelector('select')!;select.value='meal';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(host.querySelectorAll('.pins-editor-row')).toHaveLength(2);
});
it('reorders pins with arrow keys and saves the new order once',async()=>{
 await clickRow(0);await clickRow(1);
 await act(async()=>host.querySelector('.pins-editor-slot.is-filled')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true})));
 expect(mock.replace).toHaveBeenCalledTimes(1);
 expect(mock.replace).toHaveBeenCalledWith([candidates[1].pin,candidates[0].pin]);
 expect(host.querySelector('.pins-editor-slot-title')!.textContent).toBe('Garden');
});
it('closes with Done or Escape',async()=>{
 await act(async()=>host.querySelector<HTMLButtonElement>('.pins-editor-done')!.click());
 expect(mock.close).toHaveBeenCalledTimes(1);
 await act(async()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(mock.close).toHaveBeenCalledTimes(2);
});
