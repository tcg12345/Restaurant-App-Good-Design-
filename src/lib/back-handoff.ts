/** Keep the destination preview over the live page until UIKit has received
 * its controls and the browser has painted the restored layout. */
export async function handoffBackPreview({ page, preview, syncNative, signal, reduced }: {
  page: HTMLElement; preview: HTMLElement; syncNative: () => Promise<void>;
  signal: AbortSignal; reduced: boolean;
}): Promise<void> {
  if (signal.aborted) return;
  preview.style.zIndex = '19';
  preview.dataset.glassHandoff = '';
  page.style.opacity = '';
  let timeout: ReturnType<typeof setTimeout>;
  await Promise.race([
    Promise.resolve().then(syncNative).catch(() => {}),
    new Promise<void>(resolve => { timeout = setTimeout(resolve, 200); }),
  ]);
  clearTimeout(timeout!);
  if (signal.aborted) return;
  // Two frames: one to apply restored scroll/layout, one to present it.
  // A backgrounded WebView may pause rAF; never leave navigation locked.
  await new Promise<void>(resolve => {
    let frame = 0;
    const finish = () => { clearTimeout(timer); cancelAnimationFrame(frame); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, 100);
    signal.addEventListener('abort', finish, { once: true });
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); });
  });
  if (signal.aborted) return;
  if (!reduced) await new Promise<void>(resolve => {
    const animation = preview.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, easing: 'ease-out', fill: 'forwards' });
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      animation.onfinish = null; animation.oncancel = null;
      if (!signal.aborted) preview.style.opacity = '0';
      animation.cancel();
      resolve();
    };
    const timer = setTimeout(finish, 160);
    animation.onfinish = finish; animation.oncancel = finish;
    signal.addEventListener('abort', finish, { once: true });
  });
}
