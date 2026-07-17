// Shared Mux helpers for the video Edge Functions: API auth and signed-
// playback token minting.
//
// Signed playback (followers-only reels / post videos) needs a Mux SIGNING
// KEY — separate from the API token. Create one with
//   POST https://api.mux.com/system/v1/signing-keys
// (or in the Mux dashboard under Settings → Signing Keys) and store it as:
//   supabase secrets set MUX_SIGNING_KEY_ID=...  MUX_SIGNING_PRIVATE_KEY=...
// MUX_SIGNING_PRIVATE_KEY accepts the PEM either raw or base64-encoded (the
// Mux API returns it base64-encoded).
//
// When these secrets are absent, signed playback is OFF: uploads fall back to
// the public policy (see mux-upload-init) so nothing breaks — provision the
// keys, then new followers-only uploads become signed.

/** Basic auth header value for the Mux REST API, or null if unconfigured. */
export function muxApiAuth(): string | null {
  const id = Deno.env.get('MUX_TOKEN_ID');
  const secret = Deno.env.get('MUX_TOKEN_SECRET');
  if (!id || !secret) return null;
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

export interface MuxSigningConfig {
  keyId: string;
  privateKeyPem: string;
}

/** The signing-key secrets, or null when signed playback isn't provisioned. */
export function muxSigningConfig(): MuxSigningConfig | null {
  const keyId = Deno.env.get('MUX_SIGNING_KEY_ID') ?? '';
  let pem = Deno.env.get('MUX_SIGNING_PRIVATE_KEY') ?? '';
  if (!keyId || !pem) return null;
  // The Mux API hands the key back base64-encoded; accept that or raw PEM.
  if (!pem.includes('PRIVATE KEY')) {
    try { pem = atob(pem.replace(/\s+/g, '')); } catch { return null; }
    if (!pem.includes('PRIVATE KEY')) return null;
  }
  return { keyId, privateKeyPem: pem };
}

/* ── RSA key import ─────────────────────────────────────────────────── */

function derLength(len: number): number[] {
  if (len < 0x80) return [len];
  const bytes: number[] = [];
  let v = len;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return [0x80 | bytes.length, ...bytes];
}

/** Wrap a PKCS#1 RSAPrivateKey DER in the PKCS#8 PrivateKeyInfo envelope
 *  (WebCrypto only imports PKCS#8; Mux keys may be either). */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = [0x02, 0x01, 0x00];
  // AlgorithmIdentifier for rsaEncryption (1.2.840.113549.1.1.1) + NULL.
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const octetString = [0x04, ...derLength(pkcs1.length), ...pkcs1];
  const body = [...version, ...algId, ...octetString];
  return new Uint8Array([0x30, ...derLength(body.length), ...body]);
}

async function importRsaPrivateKey(pem: string): Promise<CryptoKey> {
  const isPkcs1 = pem.includes('RSA PRIVATE KEY');
  const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  let der: Uint8Array = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  if (isPkcs1) der = pkcs1ToPkcs8(der);
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer as ArrayBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/* ── JWT minting ────────────────────────────────────────────────────── */

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const keyCache = new Map<string, Promise<CryptoKey>>();

/**
 * Mint one Mux playback JWT for `playbackId`. `aud` selects the resource:
 * 'v' video (stream.mux.com), 't' thumbnail, 's' storyboard. Extra query
 * params for image URLs (width, time, …) must ride as claims, not URL params.
 */
export async function signPlaybackToken(
  cfg: MuxSigningConfig,
  playbackId: string,
  aud: 'v' | 't' | 's',
  expiresAtSeconds: number,
  extraClaims: Record<string, unknown> = {},
): Promise<string> {
  let keyPromise = keyCache.get(cfg.privateKeyPem);
  if (!keyPromise) {
    keyPromise = importRsaPrivateKey(cfg.privateKeyPem);
    keyCache.set(cfg.privateKeyPem, keyPromise);
  }
  const key = await keyPromise;

  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: cfg.keyId })));
  const payload = b64url(enc.encode(JSON.stringify({
    sub: playbackId,
    aud,
    exp: expiresAtSeconds,
    ...extraClaims,
  })));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${payload}`));
  return `${header}.${payload}.${b64url(new Uint8Array(sig))}`;
}
