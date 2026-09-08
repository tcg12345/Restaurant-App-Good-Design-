// @vitest-environment jsdom
import React,{act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {AdminFeedback,FeedbackInbox} from './AdminFeedback';
import {useAuth} from '../contexts/AuthContext';
import {listFeedback,updateFeedbackStatus} from '../lib/feedback';
vi.mock('../contexts/AuthContext',()=>({useAuth:vi.fn()}));
vi.mock('../lib/usePageBack',()=>({usePageBack:()=>vi.fn()}));
vi.mock('../lib/feedback',async()=>({...await vi.importActual('../lib/feedback'),listFeedback:vi.fn(),updateFeedbackStatus:vi.fn()}));
let root:Root,host:HTMLDivElement;
const item={id:'one',user_id:'sender',category:'suggestion' as const,feature:'Search',message:'Please add a cuisine filter.',status:'new' as const,created_at:'2026-09-08T10:00:00Z',app_version:'1',platform:'web',device_type:'desktop',browser:'Chrome',source_page:'settings',allow_contact:false,contact_email:null};
beforeEach(()=>{(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;vi.useFakeTimers();vi.clearAllMocks();host=document.createElement('div');document.body.append(host);root=createRoot(host);vi.mocked(listFeedback).mockResolvedValue({items:[item] as any,total:1});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();});
async function settle(){await act(async()=>{await vi.advanceTimersByTimeAsync(300);});}
it('does not request submissions for a non-admin',async()=>{
 vi.mocked(useAuth).mockReturnValue({isAdmin:false,adminChecked:true,loading:false} as any);
 await act(async()=>root.render(<AdminFeedback/>));await settle();expect(listFeedback).not.toHaveBeenCalled();expect(host.textContent).toContain('Page not found');
});
it('shows messages, sends filters to the backend, and preserves details on a failed status update',async()=>{
 await act(async()=>root.render(<FeedbackInbox onBack={()=>{}}/>));await settle();
 await act(async()=>host.querySelector<HTMLButtonElement>('.feedback-item')!.click());
 expect(host.querySelector('.feedback-detail')!.textContent).toContain('Please add');
 expect(host.querySelector('.feedback-detail')!.textContent).toContain('not opted in');
 vi.mocked(updateFeedbackStatus).mockRejectedValue(new Error('offline'));
 await act(async()=>{const select=host.querySelector<HTMLSelectElement>('.feedback-detail select')!;select.value='planned';select.dispatchEvent(new Event('change',{bubbles:true}));});
 expect(host.textContent).toContain('Couldn’t update');expect(host.querySelector<HTMLSelectElement>('.feedback-detail select')!.value).toBe('new');
 await act(async()=>{const select=host.querySelector<HTMLSelectElement>('.feedback-filters select')!;select.value='reviewing';select.dispatchEvent(new Event('change',{bubbles:true}));});await settle();
 expect(listFeedback).toHaveBeenLastCalledWith(expect.objectContaining({status:'reviewing',page:0}));
});
