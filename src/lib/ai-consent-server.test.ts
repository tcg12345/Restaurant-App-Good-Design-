import {expect,it} from 'vitest';
import {requireAiConsent,AI_CONSENT_VERSION} from '../../supabase/functions/_shared/ai-consent';
it('requires the current explicit consent attestation and provides an actionable response',async()=>{
 for(const consent of ['', 'old-version']){const r=requireAiConsent(new Request('https://example.invalid',{headers:{'x-ai-consent':consent}}));expect(r?.status).toBe(403);expect(await r?.json()).toMatchObject({code:'ai_consent_required'});}
 expect(requireAiConsent(new Request('https://example.invalid',{headers:{'x-ai-consent':AI_CONSENT_VERSION}}))).toBeNull();
});
