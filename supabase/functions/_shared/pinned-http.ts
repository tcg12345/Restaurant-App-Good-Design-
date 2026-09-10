// HTTP/1.1 over a connection to a validated IP. Deno's Node HTTPS shim
// does not support custom lookup/SNI consistently, so use native TLS.
interface Connection {
  read(buffer: Uint8Array): Promise<number | null>;
  write(buffer: Uint8Array): Promise<number>;
  close(): void;
}
interface NativeNet {
  connect(options: { hostname: string; port: number }): Promise<Connection>;
  startTls(connection: Connection, options: { hostname: string }): Promise<Connection>;
}
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_HEADERS = 32_768;

class Reader {
  private pending = new Uint8Array(0);
  constructor(private connection: Connection) {}
  async more() {
    const buffer = new Uint8Array(16_384);
    const n = await this.connection.read(buffer);
    if (n === null) return false;
    const next = new Uint8Array(this.pending.length + n);
    next.set(this.pending); next.set(buffer.subarray(0, n), this.pending.length);
    this.pending = next;
    return true;
  }
  async line(limit: number): Promise<string> {
    for (;;) {
      const end = this.pending.findIndex((b, i, bytes) => b === 13 && bytes[i + 1] === 10);
      if (end >= 0) {
        if (end > limit) throw new Error('That page has oversized HTTP headers.');
        const line = decoder.decode(this.pending.subarray(0, end));
        this.pending = this.pending.slice(end + 2); return line;
      }
      if (this.pending.length > limit) throw new Error('That page has oversized HTTP headers.');
      if (!await this.more()) throw new Error('That page could not be downloaded completely.');
    }
  }
  async take(length: number): Promise<Uint8Array> {
    while (!this.pending.length && await this.more()) { /* refill */ }
    const chunk = this.pending.slice(0, length);
    this.pending = this.pending.slice(chunk.length); return chunk;
  }
}

export async function readPageResponse(connection: Connection, maxBytes: number) {
  const reader = new Reader(connection);
  const statusLine = await reader.line(MAX_HEADERS);
  const match = /^HTTP\/1\.[01] ([0-9]{3})(?: |$)/.exec(statusLine);
  if (!match) throw new Error('That site returned an invalid HTTP response.');
  const status = Number(match[1]);
  const headers = new Map<string, string>(); let headerBytes = statusLine.length;
  for (;;) {
    const line = await reader.line(MAX_HEADERS - headerBytes);
    headerBytes += line.length + 2;
    if (!line) break;
    const colon = line.indexOf(':');
    if (colon <= 0 || /^[ \t]/.test(line)) throw new Error('That site returned invalid HTTP headers.');
    const key = line.slice(0, colon).toLowerCase(), value = line.slice(colon + 1).trim();
    if (headers.has(key) && ['content-length', 'transfer-encoding', 'content-encoding', 'location'].includes(key)) throw new Error('That site returned ambiguous HTTP headers.');
    headers.set(key, value);
  }
  if ([301,302,303,307,308].includes(status)) return {status, location: headers.get('location')};
  if (status < 200 || status >= 300) throw new Error(`That link answered with HTTP ${status}.`);
  const type = headers.get('content-type')?.toLowerCase();
  if (type && !type.includes('html') && !type.startsWith('text/')) throw new Error('That link is not a web page.');
  const encoding = headers.get('content-encoding')?.toLowerCase();
  if (encoding && encoding !== 'identity') throw new Error('That site returned an unsupported page encoding.');
  const transfer = headers.get('transfer-encoding')?.toLowerCase();
  const length = headers.get('content-length');
  if (transfer && (transfer !== 'chunked' || length !== undefined)) throw new Error('That site returned ambiguous HTTP framing.');
  if (length !== undefined && !/^\d+$/.test(length)) throw new Error('That site returned an invalid page length.');
  if (length !== undefined && Number(length) > maxBytes) throw new Error('That page is too large to import.');
  const chunks: Uint8Array[] = []; let total = 0;
  const append = (chunk: Uint8Array) => {
    total += chunk.length;
    if (total > maxBytes) throw new Error('That page is too large to import.');
    chunks.push(chunk);
  };
  const exact = async (count: number) => {
    if (!Number.isSafeInteger(count) || count + total > maxBytes) throw new Error('That page is too large to import.');
    while (count > 0) {
      const chunk = await reader.take(Math.min(count, 16_384));
      if (!chunk.length) throw new Error('That page could not be downloaded completely.');
      append(chunk); count -= chunk.length;
    }
  };
  if (transfer === 'chunked') {
    for (;;) {
      const line = await reader.line(1024);
      if (!/^[0-9a-f]+(?:;[^\r\n]*)?$/i.test(line)) throw new Error('That site returned invalid HTTP chunks.');
      const size = parseInt(line.split(';')[0], 16);
      if (size === 0) break; // Trailers cannot affect the already parsed page.
      await exact(size);
      if (await reader.line(0) !== '') throw new Error('That site returned invalid HTTP chunks.');
    }
  } else if (length !== undefined) { await exact(Number(length)); }
  else {
    for (;;) { const chunk = await reader.take(16_384); if (!chunk.length) break; append(chunk); }
  }
  const body = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return {status, html: decoder.decode(body)};
}

export async function nativePinnedRequest(url: URL, address: string, signal: AbortSignal, maxBytes: number) {
  const runtime = (globalThis as unknown as {Deno: NativeNet}).Deno;
  let connection: Connection | undefined;
  const close = () => { try { connection?.close(); } catch { /* already closed */ } };
  signal.addEventListener('abort', close, {once:true});
  try {
    connection = await runtime.connect({hostname: address, port: url.protocol === 'https:' ? 443 : 80});
    if (signal.aborted) throw new Error('That site took too long to respond.');
    if (url.protocol === 'https:') {
      // startTls verifies the original hostname and sends its SNI, without
      // resolving it again: the underlying TCP socket is already connected.
      connection = await runtime.startTls(connection, {hostname: url.hostname.replace(/^\[|\]$/g, '')});
    }
    if (signal.aborted) throw new Error('That site took too long to respond.');
    const bytes = encoder.encode(`GET ${url.pathname + url.search} HTTP/1.1\r\nHost: ${url.host}\r\nConnection: close\r\nAccept: text/html,application/xhtml+xml,text/plain\r\nAccept-Encoding: identity\r\nUser-Agent: Mozilla/5.0 GoodEatsImporter/1.0\r\n\r\n`);
    let sent = 0;
    while (sent < bytes.length) sent += await connection.write(bytes.subarray(sent));
    return await readPageResponse(connection, maxBytes);
  } finally { signal.removeEventListener('abort', close); close(); }
}
