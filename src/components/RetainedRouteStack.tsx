import React, { useEffect, useState, type ReactElement } from 'react';

/** Reading pages stay alive in a bounded history stack. Back reveals the
 * existing instance (including loaded images, form selections and scroll),
 * rather than mounting a loading screen underneath a departing snapshot.
 * Media players, maps, composers and sensitive forms still unmount normally. */
export function canRetainRoute(path: string): boolean {
  if (/^\/guides\/[^/]+\/edit$/.test(path)) return false;
  return /^\/(restaurant|user|recipe|meal|guides|profile\/taste|profile\/top|pantry\/recommended|recipes-for-you|circle|experts|activity)(\/|$)/.test(path)
    || /^\/settings(?:\/(?:account|appearance|notifications|privacy|preferences|support|about))?$/.test(path);
}

type Entry = { key: string; index: number; retain: boolean; element: ReactElement };
interface Props {
  entryKey: string | null;
  index: number;
  pathname: string;
  pop: boolean;
  instant: boolean;
  children: ReactElement | false;
}
export function RetainedRouteStack({ entryKey, index, pathname, pop, instant, children }: Props) {
  const [state, setState] = useState<{ key: string | null; entries: Entry[]; departing: string | null }>({ key: entryKey, entries: [], departing: null });
  let entries = state.entries;
  let departing = state.departing;
  if (state.key !== entryKey || (entryKey && !entries.some(e => e.key === entryKey))) {
    departing = !instant && pop ? state.key : null;
    // New forward branches invalidate cached entries at/after their index.
    entries = entries.filter(e => (e.retain || e.key === departing) && (pop || e.index < index || e.key === entryKey || e.key === departing));
    if (entryKey && children && !entries.some(e => e.key === entryKey)) entries = [...entries, { key: entryKey, index, retain: canRetainRoute(pathname), element: children }];
    entries = entries.slice(-6);
    setState({ key: entryKey, entries, departing });
  }
  useEffect(() => {
    if (!departing) return;
    const timer = setTimeout(() => setState(previous => ({ ...previous, departing: null, entries: previous.entries.filter(e => e.retain || e.key === previous.key) })), 400);
    return () => clearTimeout(timer);
  }, [departing, entryKey]);
  return <>{entries.map(entry => {
    const active = entry.key === entryKey;
    const leaving = entry.key === departing;
    const element = active && children ? children : entry.element;
    return <div key={entry.key} data-retained-route={entry.key} aria-hidden={!active} inert={!active}
      style={active ? { position: 'relative' } : { position: 'absolute', inset: 0, overflow: 'hidden', visibility: leaving ? 'visible' : 'hidden', opacity: leaving ? 1 : 0, pointerEvents: 'none', zIndex: leaving ? 10 : undefined }}>
      {React.cloneElement(element, active ? {} : { initial: false, animate: leaving ? 'exit' : 'center', custom: { instant: !leaving, pop: true, toSheet: false, fromSheet: false } })}
    </div>;
  })}</>;
}
