import { describe, expect, it, vi } from 'vitest';
import { compactMetadata, META_CACHE_BYTES, META_CACHE_LIMIT, MetadataPersistence, type Metadata } from './metadata-persistence';

const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
function fixture() {
  const disk = new Map<string, Metadata>();
  const backend = { read: vi.fn(async (owner: string) => disk.get(owner) || null), write: vi.fn(async (owner: string, data: Metadata) => { disk.set(owner, structuredClone(data)); }), clear: vi.fn(async () => { disk.clear(); }) };
  const warn = vi.fn();
  return { disk, backend, warn, store: new MetadataPersistence(backend, warn) };
}
describe('metadata persistence', () => {
  it('bounds restaurant rows and bytes without changing any reserved user records', () => {
    const data: Metadata = { __home_meals__: [{ photos: ['data:large-photo'] }], __deleted_meals__: ['deleted'], __taste__: { likes: ['Thai'] } };
    for (let i = 0; i < 1200; i++) data[`r${i}`] = { name: 'Place', address: 'x'.repeat(2000), image: 'data:large-cache-photo' };
    const result = compactMetadata(data);
    expect(result.__home_meals__).toBe(data.__home_meals__);
    expect(result.__deleted_meals__).toEqual(['deleted']);
    const cache = Object.fromEntries(Object.entries(result).filter(([k]) => !k.startsWith('__')));
    expect(Object.keys(cache).length).toBeLessThanOrEqual(META_CACHE_LIMIT);
    expect(new TextEncoder().encode(JSON.stringify(cache)).length).toBeLessThanOrEqual(META_CACHE_BYTES);
    expect(cache.r1199).toEqual({ name: 'Place', address: 'x'.repeat(2000), image: '' });
    expect(compactMetadata(result)).toEqual(result);
  });
  it('preserves large unsynced photos across an offline relaunch', async () => {
    const f = fixture(); const data = { __home_meals__: [{ photos: ['data:' + 'a'.repeat(6 * 1024 * 1024)] }], __reviews__: [{ notes: 'Keep me' }] };
    await f.store.open('owner', {});
    expect(await f.store.save('owner', data)).toBe(true);
    const relaunched = new MetadataPersistence(f.backend, f.warn);
    await relaunched.open('owner', {});
    expect(relaunched.read('owner')).toEqual(data);
  });
  it('coalesces same-tick writes while keeping the newest data', async () => {
    const f = fixture(); await f.store.open('owner', {});
    await Promise.all([f.store.save('owner', { r: 1 }), f.store.save('owner', { r: 2 }), f.store.save('owner', { r: 3 })]);
    expect(f.backend.write).toHaveBeenCalledTimes(1); expect(f.disk.get('owner')).toEqual({ r: 3 });
  });
  it('does not restore a stale legacy duplicate over a newer native snapshot', async () => {
    const f = fixture(); f.disk.set('owner', { __notes__: 'new' });
    await f.store.open('owner', { __notes__: 'old', removed: true });
    expect(f.store.read('owner')).toEqual({ __notes__: 'new' });
  });
  it('retains disk data and edits made during hydration', async () => {
    const f = fixture(); const read = deferred<Metadata>(); f.backend.read.mockReturnValueOnce(read.promise);
    const ready = f.store.open('owner', { remove: 1, edit: 1 });
    const write = f.store.save('owner', { edit: 2 });
    read.resolve({ __archive__: ['preserved'], remove: 1, edit: 0 });
    await ready; await write;
    expect(f.disk.get('owner')).toEqual({ __archive__: ['preserved'], edit: 2 });
  });
  it('reports write failure, preserves the previous snapshot and can retry', async () => {
    const f = fixture(); f.disk.set('owner', { __notes__: 'old' }); await f.store.open('owner', {});
    f.backend.write.mockRejectedValueOnce(new Error('disk full'));
    expect(await f.store.save('owner', { __notes__: 'new' })).toBe(false);
    expect(f.disk.get('owner')).toEqual({ __notes__: 'old' }); expect(f.warn).toHaveBeenCalledOnce();
    expect(await f.store.save('owner', f.store.read('owner')!)).toBe(true);
    expect(f.disk.get('owner')).toEqual({ __notes__: 'new' });
  });
  it('does not overwrite an unreadable file with empty data', async () => {
    const f = fixture(); f.backend.read.mockRejectedValueOnce(new Error('read failure'));
    await f.store.open('owner', {});
    expect(await f.store.save('owner', {})).toBe(false); expect(f.backend.write).not.toHaveBeenCalled();
  });
  it('purges after an in-flight write and rejects old-account work', async () => {
    const f = fixture(); await f.store.open('a', {}); const pending = deferred<void>();
    f.backend.write.mockImplementationOnce(async (owner, data) => { await pending.promise; f.disk.set(owner, data); });
    const write = f.store.save('a', { __private__: true }); await vi.waitFor(() => expect(f.backend.write).toHaveBeenCalled());
    const clear = f.store.clear(); expect(f.store.read('a')).toBeNull();
    pending.resolve(); await write; await clear;
    await f.store.open('b', {}); expect(await f.store.save('a', { __private__: true })).toBe(false);
    expect(f.disk.size).toBe(0); expect(f.store.read('b')).toEqual({});
  });
  it('discards a read completing after account switch', async () => {
    const f = fixture(); const read = deferred<Metadata>(); f.backend.read.mockReturnValueOnce(read.promise);
    const old = f.store.open('a', {}); await Promise.resolve();
    await f.store.open('b', {}); read.resolve({ __private__: true }); await old;
    expect(f.store.read('a')).toBeNull(); expect(f.store.read('b')).toEqual({});
  });
});
