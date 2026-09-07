// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GuidesBrowser } from './GuidesBrowser';
vi.mock('../lib/glass-buttons', () => ({ GlassButton: ({children,onClick,label}: any) => React.createElement('button',{onClick,'aria-label':label},children), useGlassOccluder: () => () => {} }));
let root: Root, host: HTMLDivElement;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true; host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
it('opens a reader without dismissing the routed collection underneath it',async()=>{
 const close=vi.fn(), open=vi.fn();
 await act(async()=>root.render(React.createElement(GuidesBrowser,{open:true,variant:'page',isMobile:true,onClose:close,onOpenGuide:open,realGuides:[{id:'one',title:'A guide',author:'Alex',count:3,type:'restaurants',image:'',daysAgo:1}]})));
 await act(async()=>host.querySelector('article')!.click());
 expect(open).toHaveBeenCalledWith('one');expect(close).not.toHaveBeenCalled();
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Close guides"]')!.click());
 expect(close).toHaveBeenCalledOnce();
});
