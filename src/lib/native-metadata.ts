import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { MetadataPersistence, type Metadata, type MetadataBackend } from './metadata-persistence';

export const METADATA_STORAGE_KEY = 'goodeats-restaurant-meta';
const FOLDER = 'goodeats-metadata';
export const nativeMetadataEnabled = Capacitor.isNativePlatform();
type RecordOnDisk = { version: 1; owner: string; revision: number; data: Metadata };
const revisions = new Map<string, number>();
const missing = (error: unknown) => (error as { code?: string })?.code === 'OS-PLUG-FILE-0008';
function path(owner: string, slot: number) {
  if (!/^[a-f0-9-]{36}$/i.test(owner)) throw new Error('Invalid metadata owner');
  return `${FOLDER}/${owner}-${slot}.json`;
}
function warn() {
  console.warn('[Metadata] Native persistence failed; keeping in-memory data and the previous disk copy.');
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('goodeats-metadata-save-failed'));
}

// Alternate complete snapshots. A killed/partial write leaves the other slot
// available on relaunch. Never store this durable data in Directory.Cache.
export const nativeMetadataBackend: MetadataBackend = {
  async read(owner) {
    const records: RecordOnDisk[] = [];
    let invalid = false;
    for (const slot of [0, 1]) {
      try {
        const file = await Filesystem.readFile({ path: path(owner, slot), directory: Directory.Library, encoding: Encoding.UTF8 });
        const record = JSON.parse(String(file.data)) as RecordOnDisk;
        if (record.version !== 1 || record.owner !== owner || !Number.isSafeInteger(record.revision) || record.revision < 0 || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) throw new Error('Invalid metadata snapshot');
        records.push(record);
      } catch (error) { if (!missing(error)) invalid = true; }
    }
    records.sort((a, b) => b.revision - a.revision);
    if (!records.length && invalid) throw new Error('Metadata unavailable');
    const latest = records[0];
    revisions.set(owner, latest?.revision || 0);
    return latest?.data || null;
  },
  async write(owner, data) {
    const revision = (revisions.get(owner) || 0) + 1;
    await Filesystem.writeFile({ path: path(owner, revision % 2), directory: Directory.Library, encoding: Encoding.UTF8, recursive: true,
      data: JSON.stringify({ version: 1, owner, revision, data } satisfies RecordOnDisk) });
    revisions.set(owner, revision);
  },
  async clear() {
    try { await Filesystem.rmdir({ path: FOLDER, directory: Directory.Library, recursive: true }); }
    catch (error) { if (!missing(error)) throw error; }
    revisions.clear();
  },
};
const persistence = new MetadataPersistence(nativeMetadataBackend, warn);
let activeOwner: string | null = null;
function legacy(): Metadata {
  try {
    const data = JSON.parse(localStorage.getItem(METADATA_STORAGE_KEY) || '{}');
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}
export function readNativeMetadata(): Metadata | null {
  return nativeMetadataEnabled && activeOwner ? persistence.read(activeOwner) : null;
}
export async function loadNativeMetadata(owner: string): Promise<Metadata | null> {
  if (!nativeMetadataEnabled) return null;
  activeOwner = owner;
  await persistence.open(owner, legacy());
  if (activeOwner !== owner) return null;
  return persistence.read(owner);
}
export function saveNativeMetadata(data: Metadata): void {
  if (!activeOwner) return;
  const owner = activeOwner;
  const previous = (() => { try { return localStorage.getItem(METADATA_STORAGE_KEY); } catch { return null; } })();
  void persistence.save(owner, data).then(saved => {
    if (!saved || activeOwner !== owner) return;
    // Remove the large legacy duplicate only after a confirmed native write,
    // and only if no newer legacy writer has replaced it in the meantime.
    try { if (localStorage.getItem(METADATA_STORAGE_KEY) === previous) localStorage.removeItem(METADATA_STORAGE_KEY); } catch { /* blocked storage */ }
  });
}
export function clearNativeMetadata(): Promise<void> {
  activeOwner = null;
  return nativeMetadataEnabled ? persistence.clear() : Promise.resolve();
}
