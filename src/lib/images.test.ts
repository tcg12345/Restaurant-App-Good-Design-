import { describe, it, expect } from 'vitest';
import { dataUrlToBlob, MAX_INLINE_PHOTO_BYTES } from './images';

// compressImage / uploadPhoto / processPhoto need a DOM + network and are
// verified in-browser against the real module; dataUrlToBlob is pure and
// node-testable (atob/Blob/Uint8Array only).

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL to the right bytes + mime', async () => {
    // "Hi" → base64 "SGk="
    const blob = dataUrlToBlob('data:text/plain;base64,SGk=');
    expect(blob.type).toBe('text/plain');
    expect(blob.size).toBe(2);
    expect(await blob.text()).toBe('Hi');
  });

  it('handles a non-base64 (percent-encoded) data URL', async () => {
    const blob = dataUrlToBlob('data:text/plain,Hello%20world');
    expect(await blob.text()).toBe('Hello world');
    expect(blob.type).toBe('text/plain');
  });

  it('defaults the mime type when the header omits it', () => {
    const blob = dataUrlToBlob('data:,abc');
    expect(blob.type).toBe('application/octet-stream');
  });

  it('preserves an image mime type', () => {
    const oneByteJpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff]).toString('base64');
    const blob = dataUrlToBlob(oneByteJpeg);
    expect(blob.type).toBe('image/jpeg');
    expect(blob.size).toBe(1);
  });

  it('round-trips arbitrary bytes through base64', async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const b64 = Buffer.from(bytes).toString('base64');
    const blob = dataUrlToBlob(`data:application/octet-stream;base64,${b64}`);
    const out = new Uint8Array(await blob.arrayBuffer());
    expect(out.length).toBe(256);
    expect(Array.from(out)).toEqual(Array.from(bytes));
  });

  it('throws on a string that is not a data URL', () => {
    expect(() => dataUrlToBlob('https://example.com/x.jpg')).toThrow();
  });

  it('exposes a sane inline-photo byte cap', () => {
    expect(MAX_INLINE_PHOTO_BYTES).toBeGreaterThan(0);
  });
});
