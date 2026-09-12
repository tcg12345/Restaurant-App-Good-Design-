// @vitest-environment jsdom
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({getSession:vi.fn(),permission:vi.fn()}));
vi.mock('./supabase',()=>({supabase:{auth:{getSession:state.getSession}}}));
vi.mock('./ai-consent',()=>({AI_CONSENT_VERSION:'version',requestAiConsent:state.permission}));
import {apiHeaders} from './api-base';
beforeEach(()=>{vi.clearAllMocks();state.getSession.mockResolvedValue({data:{session:{user:{id:'alice'},access_token:'alice-token'}}});});
it('does not create authorized AI headers after declining',async()=>{state.permission.mockResolvedValue(false);await expect(apiHeaders(true)).rejects.toThrow('not enabled');});
it('uses a refreshed token only after acceptance and checks account identity',async()=>{state.permission.mockResolvedValue(true);state.getSession.mockResolvedValueOnce({data:{session:{user:{id:'alice'},access_token:'old'}}});expect(await apiHeaders(true)).toMatchObject({'x-ai-consent':'version',Authorization:'Bearer alice-token'});expect(state.permission).toHaveBeenCalledWith('alice');});
it('rejects a request if the account changes while permission is open',async()=>{state.permission.mockResolvedValue(true);state.getSession.mockResolvedValueOnce({data:{session:{user:{id:'bob'},access_token:'bob-token'}}});await expect(apiHeaders(true)).rejects.toThrow('account changed');});
it('does not interrupt non-AI features or attach AI consent to their headers',async()=>{const headers=await apiHeaders();expect(state.permission).not.toHaveBeenCalled();expect(headers['x-ai-consent']).toBeUndefined();});
