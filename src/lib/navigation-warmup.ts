/** Stagger optional work after first paint; never wait for it to navigate. */
export function warmNavigation(tasks: Array<() => Promise<unknown>>, onReady: (index: number) => void) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  let idle: number | undefined;
  let index = 0;
  const schedule = () => {
    timer = setTimeout(() => {
      if (cancelled) return;
      if (document.hidden) { schedule(); return; }
      if (window.requestIdleCallback) idle = window.requestIdleCallback(run, { timeout: 1500 });
      else run();
    }, 250);
  };
  const run = () => {
    if (cancelled) return;
    const current = index++;
    void tasks[current]().then(() => { if (!cancelled) onReady(current); }, () => {
      // Offline prefetch must not poison the route's later import/retry.
    }).finally(() => { if (!cancelled && index < tasks.length) schedule(); });
  };
  if (tasks.length) schedule();
  return () => { cancelled = true; clearTimeout(timer); if (idle !== undefined) window.cancelIdleCallback?.(idle); };
}
