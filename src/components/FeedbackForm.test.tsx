// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {FeedbackComposer} from './FeedbackForm';
vi.mock('../contexts/AuthContext',()=>({useAuth:vi.fn()}));
vi.mock('../contexts/SettingsContext',()=>({useSettings:vi.fn()}));
const context={user_id:'user',platform:'web' as const,device_type:'desktop' as const,app_version:'1.0.0',browser:'Chrome',source_page:'settings'};
let host:HTMLDivElement,root:Root;
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();});
async function type(selector:string,value:string){await act(async()=>{const element=host.querySelector(selector)!;const prototype=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));});}
async function send(){await act(async()=>{host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});}
it('submits only after sufficient detail and excludes the email unless follow-up is chosen',async()=>{
 const submit=vi.fn().mockResolvedValue(undefined);
 await act(async()=>root.render(<FeedbackComposer context={context} email="person@example.com" onSubmit={submit}/>));
 await send();expect(submit).not.toHaveBeenCalled();expect(host.textContent).toContain('at least 10');
 await type('textarea','Please improve the restaurant search filters.');await send();
 expect(submit).toHaveBeenCalledWith(expect.objectContaining({message:'Please improve the restaurant search filters.',allow_contact:false,contact_email:null}),null);
 expect(host.textContent).toContain('Message received');expect(document.activeElement?.textContent).toContain('Thanks for helping');
});
it('keeps failed submissions intact and retries the same identity without a false success',async()=>{
 const submit=vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
 await act(async()=>root.render(<FeedbackComposer context={context} onSubmit={submit}/>));
 await type('textarea','An idea that should survive a failed request.');await send();
 expect(host.textContent).toContain('couldn’t confirm');expect(host.querySelector('textarea')!.value).toContain('survive');
 expect(host.querySelector('fieldset')!.disabled).toBe(true);
 await send();expect(submit.mock.calls[0][0].id).toBe(submit.mock.calls[1][0].id);expect(host.textContent).toContain('Message received');
});
it('includes follow-up email only when permission is checked',async()=>{
 const submit=vi.fn().mockResolvedValue(undefined);
 await act(async()=>root.render(<FeedbackComposer context={context} email="person@example.com" onSubmit={submit}/>));
 await type('textarea','Please contact me about this issue.');
 await act(async()=>host.querySelector<HTMLInputElement>('input[type=checkbox]')!.click());await send();
 expect(submit.mock.calls[0][0]).toMatchObject({allow_contact:true,contact_email:'person@example.com'});
});
