export type Metadata = Record<string, unknown>;
export const META_CACHE_LIMIT = 400;
export const META_CACHE_BYTES = 512 * 1024;

/** Only restaurant display rows are disposable. __ slots contain user data. */
export function compactMetadata(data: Metadata): Metadata {
  const out: Metadata = {};
  const cache: [string, unknown][] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('__')) out[key] = value;
    else cache.push([key, value]);
  }
  let bytes = 2, count = 0;
  const kept: [string, unknown][] = [];
  for (const [key, value] of cache.reverse()) {
    if (count >= META_CACHE_LIMIT) break;
    // Inline photos in actual restaurant cache rows are recomputable. Never
    // strip photos from reserved recipe/review/preference records above.
    const clean = value && typeof value === 'object' && !Array.isArray(value)
      ? { ...value, ...('image' in value && typeof value.image === 'string' && /^(data:|blob:)/.test(value.image) ? { image: '' } : {}) }
      : value;
    const size = new TextEncoder().encode(JSON.stringify({ [key]: clean })).length;
    if (bytes + size > META_CACHE_BYTES) continue;
    kept.push([key, clean]); bytes += size; count++;
  }
  // Keep insertion order stable across repeated snapshots/relaunches.
  for (const [key, value] of kept.reverse()) out[key] = value;
  return out;
}

export interface MetadataBackend {
  read(owner: string): Promise<Metadata | null>;
  write(owner: string, data: Metadata): Promise<void>;
  clear(): Promise<void>;
}

/** Serial native I/O, with synchronous reads for existing list updaters. */
export class MetadataPersistence {
  private owner: string | null = null;
  private data: Metadata = {};
  private generation = 0;
  private revision = 0;
  private ready: Promise<void> = Promise.resolve();
  private writes: Promise<unknown> = Promise.resolve();
  private canWrite = true;

  constructor(private backend: MetadataBackend, private warn: () => void) {}

  read(owner: string): Metadata | null { return owner === this.owner ? this.data : null; }

  open(owner: string, legacy: Metadata): Promise<void> {
    if (owner === this.owner) return this.ready;
    this.owner = owner; this.data = legacy; this.canWrite = true;
    const generation = ++this.generation;
    const baseline = legacy;
    // Wait for earlier writes/clears so a reopen cannot race a purge.
    this.ready = this.writes.then(async () => {
      try {
        const disk = await this.backend.read(owner);
        if (generation !== this.generation) return;
        // Once a native snapshot exists it is authoritative. A legacy copy
        // whose removal was blocked must never overwrite newer native edits.
        const merged = { ...(disk ?? legacy) };
        // Preserve edits/deletions made while the read was in flight.
        for (const key of new Set([...Object.keys(baseline), ...Object.keys(this.data)])) {
          if (!(key in this.data)) delete merged[key];
          else if (this.data[key] !== baseline[key]) merged[key] = this.data[key];
        }
        this.data = merged;
      } catch {
        if (generation !== this.generation) return;
        // A failed/corrupt read must not be treated as an empty file and
        // overwritten. Preserve it for recovery and keep this session in RAM.
        this.canWrite = false; this.warn();
      }
    });
    return this.ready;
  }

  save(owner: string, data: Metadata): Promise<boolean> {
    if (owner !== this.owner) return Promise.resolve(false);
    this.data = data;
    const generation = this.generation, revision = ++this.revision;
    const ready = this.ready;
    const task = this.writes.then(async () => {
      await ready;
      if (generation !== this.generation || revision !== this.revision || !this.canWrite) return false;
      try {
        await this.backend.write(owner, compactMetadata(this.data));
        return generation === this.generation;
      } catch { if (generation === this.generation) this.warn(); return false; }
    });
    this.writes = task;
    return task;
  }

  clear(): Promise<void> {
    this.generation++; this.revision++; this.owner = null; this.data = {};
    const task = this.writes.then(() => this.backend.clear()).catch(() => { this.warn(); });
    this.writes = task;
    return task;
  }
}
