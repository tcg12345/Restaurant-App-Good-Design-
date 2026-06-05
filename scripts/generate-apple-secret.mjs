/**
 * Generate the Apple "client secret" JWT for Supabase's Apple auth provider.
 *
 * This is ONLY needed for the web Apple sign-in flow (and the in-browser
 * preview). The native iOS flow (signInWithIdToken) does not use it — for
 * native you only need the Client IDs list in the Supabase dashboard.
 *
 * The secret is an ES256-signed JWT built from your Apple Developer details
 * and your Sign in with Apple key (.p8). Apple caps its lifetime at 6 months,
 * so you'll need to regenerate and re-paste it into Supabase before it
 * expires. Zero dependencies — uses Node's built-in crypto.
 *
 * Usage (run on your Mac, from the project root):
 *
 *   node scripts/generate-apple-secret.mjs \
 *     --team 669SG3MPU7 \
 *     --key  ABCDE12345 \
 *     --services com.tylergorin.restaurantapp.web \
 *     --p8 ~/Downloads/AuthKey_ABCDE12345.p8
 *
 *   --team      Team ID (Apple Developer → Membership)
 *   --key       Key ID  (the Sign in with Apple key you created)
 *   --services  Services ID (the web identifier, e.g. *.web)
 *   --p8        path to the downloaded AuthKey_*.p8 file
 *
 * Copy the printed JWT into Supabase → Authentication → Providers → Apple →
 * "Secret Key (for OAuth)". Do NOT commit your .p8 (it's gitignored).
 */

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i === process.argv.length - 1) {
    console.error(`Missing required --${name}`);
    process.exit(1);
  }
  return process.argv[i + 1];
}

const teamId = arg('team');
const keyId = arg('key');
const servicesId = arg('services');
const p8Path = arg('p8').replace(/^~/, process.env.HOME ?? '~');

const privateKey = readFileSync(p8Path, 'utf8');

const base64url = (input) =>
  Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const now = Math.floor(Date.now() / 1000);
const sixMonths = 60 * 60 * 24 * 180; // Apple's maximum

const header = { alg: 'ES256', kid: keyId };
const payload = {
  iss: teamId,
  iat: now,
  exp: now + sixMonths,
  aud: 'https://appleid.apple.com',
  sub: servicesId,
};

const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;

// Node signs ECDSA as DER; JOSE (JWT) wants raw r||s. Convert it.
function derToJose(der) {
  let offset = 0;
  if (der[offset++] !== 0x30) throw new Error('Bad DER: expected sequence');
  if (der[offset] & 0x80) offset += 1 + (der[offset] & 0x7f);
  else offset += 1;
  const readInt = () => {
    if (der[offset++] !== 0x02) throw new Error('Bad DER: expected integer');
    const len = der[offset++];
    let buf = der.subarray(offset, offset + len);
    offset += len;
    while (buf.length > 0 && buf[0] === 0x00) buf = buf.subarray(1); // strip sign padding
    return buf;
  };
  const pad = (buf) => Buffer.concat([Buffer.alloc(32 - buf.length, 0), buf]);
  return Buffer.concat([pad(readInt()), pad(readInt())]);
}

const signer = createSign('SHA256');
signer.update(signingInput);
signer.end();
const der = signer.sign(privateKey);
const signature = base64url(derToJose(der));

const jwt = `${signingInput}.${signature}`;

console.log('\nApple client secret (paste into Supabase → Apple → Secret Key):\n');
console.log(jwt);
console.log(`\nExpires: ${new Date((now + sixMonths) * 1000).toISOString().slice(0, 10)} — regenerate before then.\n`);
