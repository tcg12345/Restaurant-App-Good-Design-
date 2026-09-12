import { useEffect, useState, type RefObject } from 'react';

export type LandingChapter = 'the-app' | 'your-taste' | 'good-company' | 'get-goodeats';
export const chapterLabels: Record<LandingChapter, string> = {
  'the-app': 'Discover GoodEats',
  'your-taste': 'Your kind of good',
  'good-company': 'Better together',
  'get-goodeats': 'Your next bite',
};
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };

/** Layout offsets, rather than transformed rectangles, keep scroll effects
 * from feeding their own transforms back into the next animation frame. */
function documentTop(element: HTMLElement): number {
  let top = 0;
  let current: HTMLElement | null = element;
  while (current) {
    // The sticky scene's offset changes while pinned; its layout origin is
    // always the top of the scene wrapper, even when resizing mid-scroll.
    if (!current.classList.contains('lp-taste')) top += current.offsetTop;
    current = current.offsetParent as HTMLElement | null;
  }
  return top;
}

/** Native scrolling stays untouched. Only artwork is gently interpolated;
 * cached layout measurements and one RAF loop keep scroll work bounded. */
export function useLandingMotion(page: RefObject<HTMLDivElement | null>) {
  const [chapter, setChapter] = useState<LandingChapter>('the-app');
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const root = page.current;
    if (!root) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const chapterNodes = [...root.querySelectorAll<HTMLElement>('[data-chapter]')];
    const revealNodes = [...root.querySelectorAll<HTMLElement>('[data-reveal]')];
    const scene = root.querySelector<HTMLElement>('.lp-taste-scene');
    const company = root.querySelector<HTMLElement>('.lp-company');
    let chapters: Array<{ id: LandingChapter; top: number }> = [];
    let reveals: Array<{ node: HTMLElement; top: number; order: number }> = [];
    let sceneTop = 0;
    let sceneHeight = 1;
    let companyTop = 0;
    let companyHeight = 1;
    let viewport = window.innerHeight;
    let mobile = window.innerWidth <= 650;
    let documentHeight = 1;
    let actual = Math.max(0, window.scrollY);
    let visual = actual;
    let frame = 0;
    let previousTime = 0;
    let needsMeasure = true;
    let currentChapter: LandingChapter = 'the-app';
    let currentCompact = false;
    let disposed = false;

    function measure() {
      viewport = window.innerHeight;
      mobile = window.innerWidth <= 650;
      chapters = chapterNodes.map(node => ({ id: node.dataset.chapter as LandingChapter, top: documentTop(node) }));
      reveals = revealNodes.map(node => ({ node, top: documentTop(node), order: Number(node.dataset.revealOrder || 0) }));
      sceneTop = scene ? documentTop(scene) : 0;
      sceneHeight = scene?.offsetHeight || 1;
      companyTop = company ? documentTop(company) : 0;
      companyHeight = company?.offsetHeight || 1;
      documentHeight = Math.max(1, document.documentElement.scrollHeight - viewport);
      needsMeasure = false;
    }

    function paint(now: number) {
      frame = 0;
      if (disposed) return;
      if (needsMeasure) measure();
      actual = Math.max(0, window.scrollY);
      const dt = previousTime ? Math.min(now - previousTime, 64) : 16;
      previousTime = now;
      visual = media.matches ? actual : visual + (actual - visual) * (1 - Math.exp(-dt / 85));
      if (Math.abs(actual - visual) < 0.2) visual = actual;
      root!.style.setProperty('--lp-progress', String(clamp(actual / documentHeight)));
      const nextCompact = actual > (currentCompact ? 28 : 72);
      if (nextCompact !== currentCompact) { currentCompact = nextCompact; setCompact(nextCompact); }
      const nextChapter = chapters.reduce<LandingChapter>((selected, item) => item.top <= actual + viewport * 0.36 ? item.id : selected, 'the-app');
      if (nextChapter !== currentChapter) { currentChapter = nextChapter; setChapter(nextChapter); }

      if (!media.matches) {
        const heroProgress = ease(visual / Math.max(viewport * 0.85, 1));
        root!.style.setProperty('--lp-hero-shift', `${heroProgress * (mobile ? 28 : 68)}px`);
        root!.style.setProperty('--lp-hero-rotate', `${7 - heroProgress * 7}deg`);
        root!.style.setProperty('--lp-hero-copy-shift', `${-heroProgress * (mobile ? 12 : 30)}px`);
        for (const { node, top, order } of reveals) {
          const entrance = ease((visual + viewport * 0.94 - top - order * 42) / (viewport * (mobile ? 0.3 : 0.42)));
          // Do not fade content on its exit at the top: it remains readable,
          // selectable and usable while the next section takes the stage.
          node.style.setProperty('--lp-reveal-opacity', String(0.12 + entrance * 0.88));
          node.style.setProperty('--lp-reveal-y', `${(1 - entrance) * (mobile ? 28 : 64)}px`);
          node.style.setProperty('--lp-reveal-scale', String(0.975 + entrance * 0.025));
        }
        const sceneEntrance = ease((visual + viewport * 0.82 - sceneTop) / Math.max(viewport * 0.75, 1));
        const sceneExit = ease((visual - (sceneTop + sceneHeight - viewport * 0.65)) / Math.max(viewport * 0.65, 1));
        const openness = sceneEntrance * (1 - sceneExit);
        scene?.style.setProperty('--lp-panel-inset', `${(1 - openness) * (mobile ? 10 : 30)}px`);
        scene?.style.setProperty('--lp-panel-radius', `${(1 - openness) * (mobile ? 24 : 42)}px`);
        const sceneProgress = ease((visual + viewport * 0.4 - sceneTop) / Math.max(sceneHeight, 1));
        scene?.style.setProperty('--lp-taste-rotate', `${-8 + sceneProgress * 11}deg`);
        scene?.style.setProperty('--lp-taste-lift', `${(0.5 - sceneProgress) * (mobile ? 20 : 65)}px`);
        const companyProgress = clamp((visual + viewport - companyTop) / (viewport + companyHeight));
        company?.style.setProperty('--lp-photo-scale', String(1.12 - companyProgress * 0.1));
        company?.style.setProperty('--lp-photo-y', `${(0.5 - companyProgress) * 24}px`);
      }
      if (!media.matches && actual !== visual) frame = requestAnimationFrame(paint);
    }
    function schedule() { if (!disposed && !frame) frame = requestAnimationFrame(paint); }
    function resize() { needsMeasure = true; schedule(); }
    function preferenceChanged() {
      root!.dataset.motion = media.matches ? 'reduced' : 'full';
      visual = Math.max(0, window.scrollY);
      previousTime = 0;
      resize();
    }
    root.dataset.motion = media.matches ? 'reduced' : 'full';
    media.addEventListener('change', preferenceChanged);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', resize, { passive: true });
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : undefined;
    observer?.observe(root);
    if (scene) observer?.observe(scene);
    // Webfonts can change section positions without a window resize.
    void document.fonts?.ready.then(() => { if (!disposed) resize(); });
    paint(performance.now());
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      media.removeEventListener('change', preferenceChanged);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', resize);
      delete root.dataset.motion;
    };
  }, [page]);

  return { chapter, compact };
}
