import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Keep the before-paint theme bootstrap authorized without unsafe-inline.
// A changed/new inline script requires an explicitly reviewed CSP hash.
const root = new URL('../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const hosting = JSON.parse(readFileSync(new URL('vercel.json', root), 'utf8'));
const policy = hosting.headers.flatMap(rule => rule.headers).find(header => header.key.toLowerCase() === 'content-security-policy')?.value ?? '';
const scripts = policy.split(';').find(part => part.trim().startsWith('script-src '))?.trim().split(/\s+/).slice(1) ?? [];
if (!scripts.includes("'self'") || scripts.includes("'unsafe-inline'") || scripts.includes("'unsafe-eval'")) {
  throw new Error('CSP must allow app modules without unrestricted inline scripts or JavaScript eval.');
}
for (const [, attributes, code] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
  if (/\bsrc=/.test(attributes)) continue;
  const hash = `'sha256-${createHash('sha256').update(code).digest('base64')}'`;
  if (!scripts.includes(hash)) throw new Error(`Unapproved inline bootstrap. Review the script and update script-src in vercel.json with ${hash}`);
}
console.log('Security policy bootstrap checks passed.');
