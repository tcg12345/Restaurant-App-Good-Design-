import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ files: new Map<string, string>(), fail: false }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/filesystem', () => ({ Directory: { Library: 'LIBRARY' }, Encoding: { UTF8: 'utf8' }, Filesystem: {
  readFile: vi.fn(async ({ path }) => { if (!mocks.files.has(path)) throw { code: 'OS-PLUG-FILE-0008' }; return { data: mocks.files.get(path) }; }),
  writeFile: vi.fn(async ({ path, data }) => { if (mocks.fail) throw new Error('Disk full'); mocks.files.set(path, data); }),
  rmdir: vi.fn(async () => { mocks.files.clear(); }),
} }));
import { Filesystem } from '@capacitor/filesystem';
import { nativeMetadataBackend, clearNativeMetadata, loadNativeMetadata, readNativeMetadata, saveNativeMetadata, METADATA_STORAGE_KEY } from './native-metadata';
const owner = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
let local: Map<string, string>;
beforeEach(async () => {
  await clearNativeMetadata(); mocks.fail = false; vi.clearAllMocks(); local = new Map();
  vi.stubGlobal('localStorage', { getItem: k => local.get(k) ?? null, removeItem: k => local.delete(k) });
});
it('writes alternate owner-scoped snapshots to Library and recovers the prior copy after a partial write', async () => {
  await nativeMetadataBackend.read(owner);
  await nativeMetadataBackend.write(owner, { __notes__: 'first' });
  await nativeMetadataBackend.write(owner, { __notes__: 'second' });
  expect(Filesystem.writeFile).toHaveBeenLastCalledWith(expect.objectContaining({ directory: 'LIBRARY', recursive: true, encoding: 'utf8' }));
  mocks.files.set(`goodeats-metadata/${owner}-0.json`, '{incomplete');
  expect(await nativeMetadataBackend.read(owner)).toEqual({ __notes__: 'first' });
  await nativeMetadataBackend.write(owner, { __notes__: 'recovered' });
  expect(await nativeMetadataBackend.read(owner)).toEqual({ __notes__: 'recovered' });
});
it('rejects mismatched ownership and corruption instead of treating it as empty', async () => {
  mocks.files.set(`goodeats-metadata/${owner}-0.json`, JSON.stringify({ version: 1, owner: other, revision: 1, data: { private: true } }));
  await expect(nativeMetadataBackend.read(owner)).rejects.toThrow('unavailable');
  expect(await nativeMetadataBackend.read(other)).toBeNull();
});
it('removes the legacy localStorage duplicate only after migration succeeds', async () => {
  const data = { __photos__: ['data:unsynced'], restaurant: { name: 'Place' } }; local.set(METADATA_STORAGE_KEY, JSON.stringify(data));
  expect(await loadNativeMetadata(owner)).toEqual(data);
  mocks.fail = true; const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  saveNativeMetadata(data); await vi.waitFor(() => expect(warning).toHaveBeenCalled());
  expect(local.has(METADATA_STORAGE_KEY)).toBe(true); expect(readNativeMetadata()).toEqual(data);
  mocks.fail = false; saveNativeMetadata(data);
  await vi.waitFor(() => expect(local.has(METADATA_STORAGE_KEY)).toBe(false));
  expect(await nativeMetadataBackend.read(owner)).toEqual(data); warning.mockRestore();
});
it('clears both disk slots and memory on sign-out', async () => {
  await loadNativeMetadata(owner); saveNativeMetadata({ __private__: true });
  await vi.waitFor(() => expect(mocks.files.size).toBe(1));
  await clearNativeMetadata(); expect(mocks.files.size).toBe(0); expect(readNativeMetadata()).toBeNull();
});
