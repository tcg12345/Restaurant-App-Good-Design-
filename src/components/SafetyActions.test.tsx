// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
vi.mock('../contexts/AuthContext',()=>({useAuth:()=>({user:{id:'viewer'}})}));
vi.mock('../contexts/ToastContext',()=>({useToast:()=>({showToast:vi.fn()})}));
vi.mock('../lib/glass-buttons',()=>({useGlassOccluder:()=>()=>{}}));
vi.mock('../lib/community-safety',()=>({REPORT_REASONS:{harassment:'Harassment'},reportContent:vi.fn(),setUserBlock:vi.fn(),safetyError:()=>''}));
import {SafetyActions} from './SafetyActions';
let el:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(){this.setAttribute('open','');this.querySelector('button')?.focus();}});el=document.createElement('div');document.body.append(el);root=createRoot(el);});
afterEach(()=>{act(()=>root.unmount());el.remove();});
it('keeps keyboard focus inside the dialog when changing from the menu to the report form',()=>{
 act(()=>root.render(<SafetyActions target={{kind:'posts',id:'post',authorId:'author'}}/>));
 act(()=>el.querySelector<HTMLButtonElement>('[aria-label="Report or block"]')!.click());
 const report=Array.from(el.querySelectorAll('dialog button')).find(b=>b.textContent==='Report content') as HTMLButtonElement;
 act(()=>report.click());expect(document.activeElement).toBe(el.querySelector('select'));
 const cancel=Array.from(el.querySelectorAll('dialog button')).find(b=>b.textContent==='Cancel') as HTMLButtonElement;
 act(()=>cancel.click());expect(el.querySelector('dialog')).toBeNull();
});
