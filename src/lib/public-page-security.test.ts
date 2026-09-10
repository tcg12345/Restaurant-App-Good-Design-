import { describe, expect, it, vi } from 'vitest';
import { fetchPublicPage, isPublicAddress, pinnedRequestOptions, publicPageUrl, type PageTransport } from '../../supabase/functions/_shared/public-page';

describe('recipe URL destination boundary', () => {
  it.each(['127.0.0.1','10.1.2.3','172.31.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','198.18.0.1','192.0.2.1','224.0.0.1','255.255.255.255','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::'])('rejects reserved address %s', address => expect(isPublicAddress(address)).toBe(false));
  it.each(['1.1.1.1','8.8.8.8','2001:4860:4860::8888','2606:4700:4700::1111'])('allows public unicast %s', address => expect(isPublicAddress(address)).toBe(true));
  it.each(['file:///etc/passwd','http://localhost/','http://localhost./','http://host.local/','http://127.1/','http://2130706433/','http://0x7f000001/','http://user:pass@example.com/','http://example.com:8080/'])('rejects unsafe URL syntax %s', url => expect(publicPageUrl(url)).toBeNull());
  it('blocks a redirect to internal metadata without making that request', async () => {
    const io: PageTransport = { resolve:vi.fn(async()=>['8.8.8.8']), request:vi.fn(async()=>({status:302,location:'http://169.254.169.254/'})) };
    expect(await fetchPublicPage('https://example.com/',io)).toHaveProperty('error');
    expect(io.request).toHaveBeenCalledTimes(1);
  });
  it('rejects mixed public/private DNS answers before connecting', async () => {
    const io: PageTransport = { resolve:vi.fn(async()=>['8.8.8.8','10.0.0.1']), request:vi.fn() };
    expect(await fetchPublicPage('https://example.com/',io)).toHaveProperty('error');
    expect(io.request).not.toHaveBeenCalled();
  });
  it('pins the checked address and revalidates relative redirects', async () => {
    const resolve=vi.fn().mockResolvedValueOnce(['8.8.8.8']).mockResolvedValueOnce(['127.0.0.1']);
    const request=vi.fn(async()=>({status:302,location:'/recipe'}));
    expect(await fetchPublicPage('https://example.com/',{resolve,request})).toHaveProperty('error');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(expect.any(URL), '8.8.8.8', expect.any(AbortSignal));
  });
  it('preserves host/certificate verification while connecting to the IP, without cookies or auth', () => {
    const opts=pinnedRequestOptions(new URL('https://example.com/recipe?q=1'),'8.8.8.8',new AbortController().signal);
    expect(opts).toMatchObject({hostname:'8.8.8.8',servername:'example.com',rejectUnauthorized:true,agent:false,path:'/recipe?q=1'});
    expect(opts.headers).toMatchObject({Host:'example.com','Accept-Encoding':'identity'});
    expect(opts.headers).not.toHaveProperty('Authorization'); expect(opts.headers).not.toHaveProperty('Cookie');
    expect(opts.checkServerIdentity('8.8.8.8',{subjectaltname:'DNS:attacker.example'} as never)).toBeInstanceOf(Error);
  });
  it('allows a normal public redirect and stops redirect loops', async () => {
    const request=vi.fn().mockResolvedValueOnce({status:301,location:'/recipe'}).mockResolvedValueOnce({status:200,html:'<p>Recipe</p>'});
    expect(await fetchPublicPage('https://example.com/',{resolve:async()=>['8.8.8.8'],request})).toEqual({html:'<p>Recipe</p>'});
    const loop=vi.fn(async()=>({status:302,location:'/again'}));
    expect((await fetchPublicPage('https://example.com/',{resolve:async()=>['8.8.8.8'],request:loop})).error).toContain('too many');
    expect(loop).toHaveBeenCalledTimes(6);
  });
});

import { readPageResponse } from '../../supabase/functions/_shared/pinned-http';
const connection = (response: string, width = 7) => {
  const bytes = new TextEncoder().encode(response); let offset = 0;
  return {
    read: async (buffer: Uint8Array) => {
      if (offset >= bytes.length) return null;
      const n = Math.min(width, buffer.length, bytes.length - offset);
      buffer.set(bytes.subarray(offset, offset + n)); offset += n; return n;
    },
    write: async (buffer: Uint8Array) => buffer.length,
    close: () => {},
  };
};
describe('bounded HTTP page reader', () => {
  it.each([
    ['Content-Length: 5\r\n', 'hello'],
    ['Transfer-Encoding: chunked\r\n', '2\r\nhe\r\n3;extension=yes\r\nllo\r\n0\r\n\r\n'],
    ['', 'hello'],
  ])('reads fragmented responses with %s', async (headers, body) => {
    expect(await readPageResponse(connection(`HTTP/1.1 200 OK\r\n${headers}\r\n${body}`), 100)).toEqual({status:200,html:'hello'});
  });
  it.each([
    'Content-Length: 99999999\r\n\r\n',
    'Transfer-Encoding: chunked\r\n\r\nfffffffffffffff\r\n',
    '\r\n' + 'x'.repeat(101),
    'Content-Length: 6\r\n\r\nshort',
    'Content-Length: 5\r\nContent-Length: 6\r\n\r\nhello',
    'Transfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n',
    'Transfer-Encoding: gzip\r\n\r\n',
    'Content-Encoding: gzip\r\n\r\n',
    'Content-Type: application/octet-stream\r\n\r\n',
    'X-Oversize: ' + 'x'.repeat(33_000) + '\r\n\r\n',
    'Transfer-Encoding: chunked\r\n\r\n3\r\nab',
    'Transfer-Encoding: chunked\r\n\r\nnope\r\n',
  ])('rejects oversized, incomplete, or ambiguous response %#', async body => {
    await expect(readPageResponse(connection('HTTP/1.1 200 OK\r\n' + body, 4096), 100)).rejects.toThrow();
  });
  it('returns redirect headers without consuming an unbounded body', async () => {
    expect(await readPageResponse(connection('HTTP/1.1 302 Found\r\nLocation: /recipe\r\n\r\n'), 100)).toEqual({status:302,location:'/recipe'});
  });
});
