// @vitest-environment jsdom
import {beforeEach,expect,it} from 'vitest';
import {isCommunityWrite,rememberScreeningConsent,remembersScreeningConsent} from './community-screening';
import {frameTimes,ManualReview,moderationFlagged,needsPrivacyReview,photoObject,screeningInput} from '../../supabase/functions/screen-content/policy';
beforeEach(()=>localStorage.clear());
it('keeps publishing consent separate by account and revocable',()=>{
 expect(remembersScreeningConsent('alice')).toBe(false);rememberScreeningConsent('alice',true);expect(remembersScreeningConsent('alice')).toBe(true);expect(remembersScreeningConsent('bob')).toBe(false);rememberScreeningConsent('alice',false);expect(remembersScreeningConsent('alice')).toBe(false);
});
it('only wakes screening after content writes, never messaging, login or reads',()=>{
 expect(isCommunityWrite('https://app.supabase.co/rest/v1/posts','POST')).toBe(true);
 for(const path of ['messages','content_moderation','rpc/request_content_screening'])expect(isCommunityWrite('https://app.supabase.co/rest/v1/'+path,'POST')).toBe(false);
 expect(isCommunityWrite('https://app.supabase.co/rest/v1/posts','GET')).toBe(false);
});
it('never treats arbitrary URLs or another owner’s storage path as screening media',()=>{
 const origin='https://app.supabase.co';const base=origin+'/storage/v1/object/public/photos/';
 expect(photoObject(base+'alice/a.jpg',origin,'alice')).toEqual({bucket:'photos',path:'alice/a.jpg'});
 for(const path of [base+'bob/a.jpg','http://127.0.0.1/a.jpg','https://app.supabase.co.evil.test/a.jpg',base+'alice/%2e%2e%2fbob/a.jpg'])expect(photoObject(path,origin,'alice')).toBeNull();
});
it('does not transmit signing tokens as text and never truncates unreviewed material',()=>{
 const input=screeningInput({caption:'Nice meal',photo_url:'https://app.supabase.co/storage/v1/object/sign/photos/alice/a.jpg?token=secret',mux_playback_id:'private-id'});
 expect(input.text).toBe('Nice meal');expect(input.photos).toHaveLength(1);
 expect(()=>screeningInput({caption:'x'.repeat(25000)})).toThrow(ManualReview);
 expect(()=>screeningInput({photo_url:'data:image/png;base64,hidden'})).toThrow(ManualReview);
});
it('fails closed on malformed provider output and holds privacy concerns for manual review',()=>{
 expect(moderationFlagged({results:[{flagged:false}]})).toBe(false);expect(moderationFlagged({results:[{flagged:false},{flagged:true}]})).toBe(true);
 for(const value of [{},{results:[]},{results:[{flagged:'false'}]}])expect(()=>moderationFlagged(value)).toThrow();
 expect(needsPrivacyReview('Email this person: private@example.com')).toBe(true);expect(needsPrivacyReview('Great dinner and kind staff')).toBe(false);
});
it('samples across short videos and routes unsupported durations to human review',()=>{
 expect(frameTimes(60)).toHaveLength(12);expect(frameTimes(60)[0]).toBe(2.5);expect(frameTimes(60)[11]).toBe(57.5);expect(()=>frameTimes(90)).toThrow(ManualReview);
});
