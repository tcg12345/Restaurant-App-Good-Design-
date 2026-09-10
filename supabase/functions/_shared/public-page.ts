import { nativePinnedRequest } from './pinned-http.ts';
// Server-only web-page fetcher. Resolve once, reject non-public addresses,
// then connect to that exact IP while preserving the HTTP/TLS hostname.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { checkServerIdentity } from 'node:tls';

export const MAX_PAGE_BYTES = 2_500_000;
const TIMEOUT_MS = 12_000;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
const blockedV4 = [
  [0, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8],
  [0xa9fe0000, 16], [0xac100000, 12], [0xc0000000, 24], [0xc0000200, 24],
  [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
  [0xcb007100, 24], [0xe0000000, 3],
];

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const n = address.split('.').reduce((value, octet) => value * 256 + Number(octet), 0);
    return !blockedV4.some(([network, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(network / 2 ** (32 - bits)));
  }
  if (isIP(address) !== 6 || address.includes('%')) return false;
  // Only native global unicast. Excludes mapped/compatible IPv4, local,
  // multicast, NAT64, Teredo, 6to4 and documentation allocations.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [first, second] = canonical.split(':').map(part => parseInt(part || '0', 16));
  return first >= 0x2000 && first <= 0x3fff
    && !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
    && first !== 0x2002 && first !== 0x3fff;
}

export function publicPageUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return null;
    if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) return null;
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!host || host === 'localhost' || /\.(localhost|local|internal|test|invalid|onion)$/.test(host)) return null;
    if (isIP(host) ? !isPublicAddress(host) : !host.includes('.')) return null;
    url.hostname = isIP(host) === 6 ? `[${host}]` : host;
    url.hash = '';
    return url;
  } catch { return null; }
}

export interface PageReply { status: number; location?: string; html?: string }
export interface PageTransport {
  resolve(host: string): Promise<string[]>;
  request(url: URL, address: string, signal: AbortSignal): Promise<PageReply>;
}

/** Exported to allow connection-level tests without contacting private hosts. */
export function pinnedRequestOptions(url: URL, address: string, signal: AbortSignal) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  return {
    protocol: url.protocol, hostname: address, port: url.protocol === 'https:' ? 443 : 80,
    path: url.pathname + url.search, method: 'GET', agent: false as const, signal,
    servername: isIP(host) ? undefined : host, rejectUnauthorized: true,
    checkServerIdentity: (_hostname: string, cert: Parameters<typeof checkServerIdentity>[1]) => checkServerIdentity(host, cert),
    headers: {
      Host: url.host, Accept: 'text/html,application/xhtml+xml,text/plain',
      'Accept-Encoding': 'identity', 'Accept-Language': 'en',
      'User-Agent': 'Mozilla/5.0 GoodEatsImporter/1.0',
    },
  };
}

const transport: PageTransport = {
  resolve: async host => (await lookup(host, { all: true, verbatim: true })).map(item => item.address),
  request: (url, address, signal) => 'Deno' in globalThis ? nativePinnedRequest(url, address, signal, MAX_PAGE_BYTES) : new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(pinnedRequestOptions(url, address, signal), res => {
      const status = res.statusCode ?? 502;
      if (REDIRECTS.has(status)) { resolve({ status, location: res.headers.location }); res.destroy(); return; }
      const type = (res.headers['content-type'] ?? '').toLowerCase();
      const encoding = res.headers['content-encoding'];
      if (status < 200 || status >= 300) { reject(new Error(`That link answered with HTTP ${status}.`)); res.destroy(); return; }
      if (type && !type.includes('html') && !type.startsWith('text/')) { reject(new Error('That link is not a web page.')); res.destroy(); return; }
      if (encoding && encoding !== 'identity') { reject(new Error('That site returned an unsupported page encoding.')); res.destroy(); return; }
      if (Number(res.headers['content-length']) > MAX_PAGE_BYTES) { reject(new Error('That page is too large to import.')); res.destroy(); return; }
      const chunks: Uint8Array[] = []; let total = 0;
      res.on('data', (chunk: Uint8Array) => {
        total += chunk.byteLength;
        if (total > MAX_PAGE_BYTES) { reject(new Error('That page is too large to import.')); res.destroy(); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error('That page could not be downloaded completely.')));
      res.on('end', () => {
        if (total > MAX_PAGE_BYTES) return;
        const body = new Uint8Array(total); let offset = 0;
        for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
        resolve({ status, html: new TextDecoder().decode(body) });
      });
    });
    request.on('error', reject); request.end();
  }),
};

export async function fetchPublicPage(raw: string, io: PageTransport = transport): Promise<{ html?: string; error?: string }> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout>;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(new Error('That site took too long to respond.')); }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([expired, (async () => {
      let current = raw;
      for (let hop = 0; hop <= 5; hop++) {
        const url = publicPageUrl(current);
        if (!url) throw new Error('Only public web-page links are supported.');
        const host = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(host) ? [host] : await io.resolve(host);
        if (controller.signal.aborted) throw new Error('That site took too long to respond.');
        if (!addresses.length || addresses.some(address => !isPublicAddress(address))) throw new Error('That link does not resolve to a public website.');
        const address = addresses.find(value => isIP(value) === 4) ?? addresses[0];
        const reply = await io.request(url, address, controller.signal);
        if (!REDIRECTS.has(reply.status)) return { html: reply.html };
        if (!reply.location) throw new Error('That link has an invalid redirect.');
        current = new URL(reply.location, url).href;
      }
      throw new Error('That link redirects too many times.');
    })()]);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    // Do not expose resolved IPs, certificate details, or transport internals.
    return { error: /^(That |Only public)/.test(message) ? message : 'Could not reach that link.' };
  } finally { clearTimeout(timeout!); controller.abort(); }
}
