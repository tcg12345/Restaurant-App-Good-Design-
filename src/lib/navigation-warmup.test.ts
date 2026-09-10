// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { warmNavigation } from './navigation-warmup';
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it('stages work after first paint, continues after a failed preload, and cancels queued work', async () => {
  vi.useFakeTimers();
  const tasks = [vi.fn().mockRejectedValue(new Error('offline')), vi.fn().mockResolvedValue(null), vi.fn().mockResolvedValue(null)];
  const ready = vi.fn(); const cancel = warmNavigation(tasks, ready);
  expect(tasks[0]).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250); expect(tasks[0]).toHaveBeenCalledTimes(1); expect(ready).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250); expect(ready).toHaveBeenCalledWith(1);
  cancel(); await vi.advanceTimersByTimeAsync(5000); expect(tasks[2]).not.toHaveBeenCalled();
});
it('does not mount anything after cancellation of an in-flight preload', async () => {
  vi.useFakeTimers(); let resolve!: () => void;
  const ready = vi.fn(); const cancel = warmNavigation([() => new Promise<void>(r => { resolve = r; })], ready);
  await vi.advanceTimersByTimeAsync(250); cancel(); resolve(); await Promise.resolve(); expect(ready).not.toHaveBeenCalled();
});
it('defers optional work while the document is hidden', async () => {
  vi.useFakeTimers(); const visibility = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  const task = vi.fn().mockResolvedValue(null); const cancel = warmNavigation([task], vi.fn());
  await vi.advanceTimersByTimeAsync(1000); expect(task).not.toHaveBeenCalled();
  visibility.mockReturnValue(false); await vi.advanceTimersByTimeAsync(250); expect(task).toHaveBeenCalledTimes(1); cancel();
});
