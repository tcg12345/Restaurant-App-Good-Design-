import React from 'react';
import { UNSAFE_LocationContext } from 'react-router-dom';

const TabActiveContext = React.createContext(true);
export const useTabActive = () => React.useContext(TabActiveContext);

/** Hidden tabs keep their own URL. Background mounts must not consume a
 * different page's query, deep-link state or navigation instructions. */
export function RetainedTabLocation({ path, active, children }: { path: string; active: boolean; children: React.ReactNode }) {
  const context = React.useContext(UNSAFE_LocationContext);
  const saved = React.useRef({ ...context, location: { ...context.location, pathname: path, search: '', hash: '', state: null } });
  if (active) saved.current = context;
  return <TabActiveContext.Provider value={active}><UNSAFE_LocationContext.Provider value={path === '/' || path === '/search/main' ? context : saved.current}>{children}</UNSAFE_LocationContext.Provider></TabActiveContext.Provider>;
}
