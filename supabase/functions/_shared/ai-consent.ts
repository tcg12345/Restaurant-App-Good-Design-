/** Attestation from a client that has shown and accepted the AI disclosure. */
export const AI_CONSENT_VERSION = '2026-09-12';
export function requireAiConsent(req: Request): Response | null {
  if (req.headers.get('x-ai-consent') === AI_CONSENT_VERSION) return null;
  return new Response(JSON.stringify({ error: 'Please update GoodEats and allow AI data sharing before using this feature.', code: 'ai_consent_required' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-ai-consent' },
  });
}
