// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { submitFeedback, validateScreenshot, type FeedbackDraft } from './feedback';
const mocks=vi.hoisted(()=>({from:vi.fn(),upload:vi.fn(),storageFrom:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{from:mocks.from,storage:{from:mocks.storageFrom}}}));
const draft:FeedbackDraft={id:'submission',user_id:'sender',category:'feedback',feature:'Home',message:'Improve home search.',allow_contact:false,contact_email:null,app_version:'1',platform:'web',device_type:'desktop',browser:'Chrome',source_page:'settings'};
beforeEach(()=>{vi.clearAllMocks();mocks.storageFrom.mockReturnValue({upload:mocks.upload});});
function setup(prior:unknown=null,insertError:unknown=null){
 const insert=vi.fn().mockResolvedValue({error:insertError});const maybeSingle=vi.fn().mockResolvedValue({data:prior,error:null});
 mocks.from.mockReturnValue({select:()=>({eq:()=>({maybeSingle})}),insert});return {insert,maybeSingle};
}
it('recognizes an already accepted retry without uploading or inserting again',async()=>{
 const {insert}=setup({id:draft.id});await submitFeedback(draft,new File(['image'],'shot.png',{type:'image/png'}));
 expect(insert).not.toHaveBeenCalled();expect(mocks.upload).not.toHaveBeenCalled();
});
it('keeps the screenshot private and never saves contact data without consent',async()=>{
 const {insert}=setup();mocks.upload.mockResolvedValue({error:null});
 await submitFeedback({...draft,contact_email:'should-not-save@example.com'},new File(['image'],'personal-file-name.png',{type:'image/png'}));
 expect(mocks.storageFrom).toHaveBeenCalledWith('feedback-screenshots');
 expect(mocks.upload.mock.calls[0][0]).toBe('sender/submission.png');
 expect(insert.mock.calls[0][0]).toMatchObject({contact_email:null,screenshot_path:'sender/submission.png'});
});
it('does not accept the message if the screenshot failed to upload',async()=>{
 const {insert}=setup();mocks.upload.mockResolvedValue({error:new Error('offline')});
 await expect(submitFeedback(draft,new File(['image'],'shot.png',{type:'image/png'}))).rejects.toThrow('offline');
 expect(insert).not.toHaveBeenCalled();
});
it('reuses an uploaded attachment after a lost response and still surfaces database failure',async()=>{
 const {insert}=setup(null,new Error('database unavailable'));mocks.upload.mockResolvedValue({error:{statusCode:'409'}});
 await expect(submitFeedback(draft,new File(['image'],'shot.png',{type:'image/png'}))).rejects.toThrow('database unavailable');expect(insert).toHaveBeenCalledOnce();
});
it('rejects unsupported and oversized attachments before upload',()=>{
 expect(validateScreenshot(new File(['<svg>'],'x.svg',{type:'image/svg+xml'}))).toContain('PNG');
 expect(validateScreenshot(new File([new Uint8Array(5*1024*1024+1)],'x.png',{type:'image/png'}))).toContain('5 MB');
 expect(validateScreenshot(new File(['image'],'x.jpg',{type:'image/jpeg'}))).toBeNull();
});
