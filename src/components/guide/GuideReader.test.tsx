// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { GuideReaderEntry } from './GuideReader';
vi.mock('./GuideRender', () => ({ readEntryMeta: () => ({cuisine:'French',price:'$$$'}) }));
vi.mock('../../contexts/AssistantContext', () => ({ useAskAssistantAbout: () => vi.fn() }));
vi.mock('../../lib/glass-buttons', () => ({ GlassButton: () => null }));
let root: Root, host: HTMLDivElement;
const onView=vi.fn();
const entry={id:'entry',refId:'place',name:'Juniper',subtitle:'French',image:'one.jpg',photos:['one.jpg','two.jpg','three.jpg'],hours:'5–10 PM'};
const guide={id:'guide',type:'restaurants',includePhotos:true,entries:[entry]};
const theme={visibility:{entryHours:true,entryMeta:true}};
beforeEach(()=>{
 (globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
 window.scrollTo=vi.fn(); HTMLElement.prototype.scrollTo=vi.fn();
 onView.mockClear();host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();expect(document.body.style.position).toBe('');});
async function mount(overrides={}) {await act(async()=>root.render(<GuideReaderEntry entry={entry} index={0} guide={{...guide,...overrides} as any} theme={theme as any} actions={{onView}}/>));}
async function click(label:string){await act(async()=>document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());}
it('removes hours and opens the exact photo without navigating to restaurant details',async()=>{
 await mount();expect(host.textContent).not.toContain('5–10 PM');expect(host.textContent).not.toContain('Hours');
 expect(host.querySelectorAll('.guide-reader-photo-tile')).toHaveLength(3);
 await click('Open photo 2 of 3 of Juniper');
 expect(document.querySelector('.guide-gallery-header')!.textContent).toContain('2 of 3');
 expect(document.body.style.position).toBe('fixed');expect(onView).not.toHaveBeenCalled();
 await click('Next photo');expect(document.querySelector('.guide-gallery-header')!.textContent).toContain('3 of 3');
 await click('Show all photos');expect(document.querySelectorAll('.guide-gallery-grid button')).toHaveLength(3);
 await click('Open photo 1');expect(document.querySelector('.guide-gallery-header')!.textContent).toContain('1 of 3');
 await click('Close photo gallery');
});
it('keeps photo visibility settings and restaurant navigation separate',async()=>{
 await mount({includePhotos:false});expect(host.querySelector('.guide-reader-photo-tile')).toBeNull();
 await click('Open Juniper');expect(onView).toHaveBeenCalledWith(entry);
});
it('tracks a swipe and keyboard navigation through the gallery',async()=>{
 await mount();await click('Open photo 1 of 3 of Juniper');
 const track=document.querySelector<HTMLElement>('.guide-gallery-track')!;
 Object.defineProperty(track,'clientWidth',{value:390});track.scrollLeft=780;
 await act(async()=>track.dispatchEvent(new Event('scroll',{bubbles:true})));
 expect(document.querySelector('.guide-gallery-header')!.textContent).toContain('3 of 3');
 await act(async()=>document.querySelector('.guide-gallery')!.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})));
 expect(document.querySelector('.guide-gallery-header')!.textContent).toContain('2 of 3');
});
