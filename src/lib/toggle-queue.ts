/**
 * Per-key serialization for optimistic like/save toggles.
 *
 * Two quick taps used to fire the INSERT and the DELETE concurrently with
 * no ordering — whichever landed last won the database, which didn't have
 * to match what the UI showed. This queue runs at most one request per key
 * at a time (a new toggle awaits the previous one), skips requests whose
 * desired state the server has already confirmed, and reports a typed
 * outcome so callers can roll back only genuine failures.
 */

export type ToggleOutcome = 'confirmed' | 'skipped' | 'failed';

export interface ToggleQueue {
  /** Enqueue `desired` for `key`. `send` runs serially per key and is
   *  skipped when the last-confirmed server state already equals
   *  `desired`. Never rejects. */
  run(key: string, desired: boolean, send: () => Promise<boolean>): Promise<ToggleOutcome>;
}

export function createToggleQueue(): ToggleQueue {
  const tails = new Map<string, Promise<unknown>>();
  /** Last state the SERVER acknowledged, per key. Only `send`'s success
   *  updates it — optimistic UI state never does. */
  const confirmed = new Map<string, boolean>();
  return {
    run(key, desired, send) {
      const prev = tails.get(key) ?? Promise.resolve();
      const task = (async (): Promise<ToggleOutcome> => {
        await prev.catch(() => { /* a failed predecessor never blocks the chain */ });
        if (confirmed.get(key) === desired) return 'skipped';
        let ok = false;
        try { ok = await send(); } catch { ok = false; }
        if (!ok) return 'failed';
        confirmed.set(key, desired);
        return 'confirmed';
      })();
      tails.set(key, task);
      void task.finally(() => { if (tails.get(key) === task) tails.delete(key); });
      return task;
    },
  };
}
