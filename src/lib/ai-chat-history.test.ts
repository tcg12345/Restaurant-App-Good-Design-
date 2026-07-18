import { describe, it, expect } from 'vitest';
import {
  mergeChats,
  mergeTombstones,
  boundTombstones,
  sameChatSet,
  sameTombstoneSet,
  encodeCloudChatPayload,
  decodeCloudChatPayload,
  CHAT_TOMBSTONE_SENTINEL_ID,
  MAX_CHAT_TOMBSTONES,
  MAX_SAVED_CHATS,
  type SavedChat,
  type ChatTombstone,
} from './ai-chat-history';

/* ── Fixtures ──────────────────────────────────────────────────────────── */

function chat(id: string, updatedAt: number, over: Partial<SavedChat> = {}): SavedChat {
  return {
    id,
    title: `chat ${id}`,
    createdAt: updatedAt - 10,
    updatedAt,
    messages: [{ role: 'user', blocks: [{ type: 'text', text: 'hi' }] }],
    chatPlaces: {},
    ...over,
  };
}

const tomb = (id: string, deletedAt: number): ChatTombstone => ({ id, deletedAt });
const ids = (chats: SavedChat[]) => chats.map((c) => c.id).sort();

/* ── mergeChats ────────────────────────────────────────────────────────── */

describe('mergeChats', () => {
  it('unions local + cloud, newest copy of a shared id winning', () => {
    const merged = mergeChats(
      [chat('a', 200), chat('b', 100)],
      [chat('a', 150), chat('c', 300)],
    );
    expect(ids(merged)).toEqual(['a', 'b', 'c']);
    expect(merged.find((c) => c.id === 'a')?.updatedAt).toBe(200);
  });

  it('suppresses tombstoned ids from BOTH sides', () => {
    const merged = mergeChats(
      [chat('a', 100)],
      [chat('a', 100), chat('b', 100)],
      [tomb('a', 150)],
    );
    expect(ids(merged)).toEqual(['b']);
  });

  it('lets a chat updated AFTER its tombstone survive (continued on another device)', () => {
    const merged = mergeChats([], [chat('a', 200)], [tomb('a', 150)]);
    expect(ids(merged)).toEqual(['a']);
  });

  it('deletion at the exact updatedAt still deletes', () => {
    const merged = mergeChats([], [chat('a', 150)], [tomb('a', 150)]);
    expect(merged).toEqual([]);
  });
});

/* ── Tombstone list maintenance ────────────────────────────────────────── */

describe('tombstones', () => {
  it('mergeTombstones unions by id, newest deletedAt winning', () => {
    const merged = mergeTombstones([tomb('a', 100), tomb('b', 50)], [tomb('a', 200), tomb('c', 75)]);
    expect(merged.find((t) => t.id === 'a')?.deletedAt).toBe(200);
    expect(merged.map((t) => t.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('caps at MAX_CHAT_TOMBSTONES, dropping the oldest', () => {
    const many = Array.from({ length: MAX_CHAT_TOMBSTONES + 20 }, (_, i) => tomb(`t${i}`, i));
    const bounded = boundTombstones(many);
    expect(bounded).toHaveLength(MAX_CHAT_TOMBSTONES);
    // Newest survive; the 20 oldest fell off.
    expect(bounded.some((t) => t.deletedAt < 20)).toBe(false);
  });

  it('drops malformed entries', () => {
    const bounded = boundTombstones([tomb('a', 1), { id: 5, deletedAt: 'x' } as unknown as ChatTombstone]);
    expect(bounded).toEqual([tomb('a', 1)]);
  });
});

/* ── Cloud payload codec ───────────────────────────────────────────────── */

describe('cloud payload codec', () => {
  it('round-trips chats + tombstones through the sentinel element', () => {
    const chats = [chat('a', 200), chat('b', 100)];
    const tombstones = [tomb('x', 150)];
    const decoded = decodeCloudChatPayload(encodeCloudChatPayload(chats, tombstones));
    expect(ids(decoded.chats)).toEqual(['a', 'b']);
    expect(decoded.tombstones).toEqual(tombstones);
  });

  it('decodes a legacy bare chat array (no sentinel) with empty tombstones', () => {
    const decoded = decodeCloudChatPayload([chat('a', 100)]);
    expect(ids(decoded.chats)).toEqual(['a']);
    expect(decoded.tombstones).toEqual([]);
  });

  it('emits no sentinel when there are no tombstones (payload stays legacy-shaped)', () => {
    const encoded = encodeCloudChatPayload([chat('a', 100)], []);
    expect(encoded).toHaveLength(1);
  });

  it('old clients filter the sentinel out via their "has messages array" check', () => {
    const encoded = encodeCloudChatPayload([chat('a', 100)], [tomb('x', 50)]);
    // The exact validity predicate deployed clients apply to the column.
    const oldClientView = (encoded as Array<{ id?: unknown; messages?: unknown }>).filter(
      (c) => c && typeof c.id === 'string' && Array.isArray(c.messages),
    );
    expect(oldClientView).toHaveLength(1);
    expect((oldClientView[0] as SavedChat).id).toBe('a');
  });

  it('never lets the sentinel masquerade as a chat', () => {
    const decoded = decodeCloudChatPayload([
      { id: CHAT_TOMBSTONE_SENTINEL_ID, deletedIds: [tomb('x', 1)], messages: [] },
    ]);
    expect(decoded.chats).toEqual([]);
    expect(decoded.tombstones).toEqual([tomb('x', 1)]);
  });

  it('tolerates garbage input', () => {
    expect(decodeCloudChatPayload(null)).toEqual({ chats: [], tombstones: [] });
    expect(decodeCloudChatPayload({ chats: [] })).toEqual({ chats: [], tombstones: [] });
    expect(decodeCloudChatPayload([{ nonsense: true }, 42]).chats).toEqual([]);
  });
});

/* ── Change detection ──────────────────────────────────────────────────── */

describe('change detection', () => {
  it('sameChatSet keys on id + updatedAt in canonical order', () => {
    const a = [chat('a', 200), chat('b', 100)];
    expect(sameChatSet(a, [chat('a', 200), chat('b', 100)])).toBe(true);
    expect(sameChatSet(a, [chat('a', 201), chat('b', 100)])).toBe(false);
    expect(sameChatSet(a, [chat('a', 200)])).toBe(false);
  });

  it('sameTombstoneSet keys on id + deletedAt', () => {
    expect(sameTombstoneSet([tomb('a', 1)], [tomb('a', 1)])).toBe(true);
    expect(sameTombstoneSet([tomb('a', 1)], [tomb('a', 2)])).toBe(false);
  });
});

/* ── The H7 scenario: two devices, one deletion ────────────────────────── */

describe('cross-device deletion (read-merge-write simulation)', () => {
  /** One device's sync cycle against the shared cloud copy — mirrors
   *  AiChatHistoryContext.syncWithCloud. */
  function sync(
    device: { chats: SavedChat[]; tombstones: ChatTombstone[] },
    cloud: { payload: unknown[] },
  ) {
    const cloudCopy = decodeCloudChatPayload(cloud.payload);
    device.tombstones = mergeTombstones(device.tombstones, cloudCopy.tombstones);
    device.chats = mergeChats(device.chats, cloudCopy.chats, device.tombstones);
    cloud.payload = encodeCloudChatPayload(device.chats, device.tombstones);
  }

  it('a chat deleted on device A stays deleted after B syncs — and never resurrects', () => {
    // Both devices start in sync with chats X and Y.
    const start = [chat('x', 100), chat('y', 110)];
    const cloud = { payload: encodeCloudChatPayload(start, []) };
    const A = { chats: [...start], tombstones: [] as ChatTombstone[] };
    const B = { chats: [...start], tombstones: [] as ChatTombstone[] };

    // A deletes X (tombstone + local removal, as deleteChat does) and syncs.
    A.tombstones = mergeTombstones(A.tombstones, [tomb('x', 200)]);
    A.chats = A.chats.filter((c) => c.id !== 'x');
    sync(A, cloud);

    // B still holds X locally; before the fix its sync would union X back
    // in and re-upload it. Now the tombstone wins on B too...
    sync(B, cloud);
    expect(ids(B.chats)).toEqual(['y']);
    // ...and B's own push kept X out of the cloud, so A stays clean as well.
    sync(A, cloud);
    expect(ids(A.chats)).toEqual(['y']);
    expect(decodeCloudChatPayload(cloud.payload).tombstones.map((t) => t.id)).toEqual(['x']);
  });

  it('two live devices no longer clobber each other: chats made on both survive', () => {
    const cloud = { payload: encodeCloudChatPayload([], []) };
    const A = { chats: [chat('a1', 100)], tombstones: [] as ChatTombstone[] };
    const B = { chats: [chat('b1', 105)], tombstones: [] as ChatTombstone[] };
    sync(A, cloud); // old behavior: cloud = A's array
    sync(B, cloud); // old behavior: cloud = B's array, a1 GONE
    sync(A, cloud);
    expect(ids(A.chats)).toEqual(['a1', 'b1']);
    expect(ids(decodeCloudChatPayload(cloud.payload).chats)).toEqual(['a1', 'b1']);
  });

  it('a conversation continued on B after A deleted it survives with the newer content', () => {
    const cloud = { payload: encodeCloudChatPayload([chat('x', 100)], []) };
    const A = { chats: [chat('x', 100)], tombstones: [] as ChatTombstone[] };
    const B = { chats: [chat('x', 100)], tombstones: [] as ChatTombstone[] };
    // A deletes at t=200 and syncs; B keeps chatting in X at t=300 offline.
    A.tombstones = mergeTombstones(A.tombstones, [tomb('x', 200)]);
    A.chats = [];
    sync(A, cloud);
    B.chats = [chat('x', 300)];
    sync(B, cloud);
    expect(ids(B.chats)).toEqual(['x']);
    sync(A, cloud);
    expect(A.chats.find((c) => c.id === 'x')?.updatedAt).toBe(300);
  });

  it('caps still hold after merging (chats ≤ MAX_SAVED_CHATS)', () => {
    const many = Array.from({ length: MAX_SAVED_CHATS + 10 }, (_, i) => chat(`c${i}`, i));
    const merged = mergeChats(many.slice(0, 20), many.slice(15), []);
    expect(merged.length).toBeLessThanOrEqual(MAX_SAVED_CHATS);
  });
});
