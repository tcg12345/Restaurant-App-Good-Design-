import { useCallback, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useLocation } from 'react-router-dom';

// Small presentation state only. No server data, drafts, or persistent storage.
const views = new Map<string, unknown>();

/** Keep filters and disclosures with their navigation entry, so returning to
 * the same page restores its layout as well as its scroll position. */
export function useEntryState<T>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const location = useLocation();
  const key = `${location.key}:${name}`;
  const fallback = useRef({ key, value: views.has(key) ? views.get(key) as T : initial });
  if (fallback.current.key !== key) fallback.current = { key, value: views.has(key) ? views.get(key) as T : initial };
  const [snapshot, setSnapshot] = useState(fallback.current);
  const value = snapshot.key === key ? snapshot.value : fallback.current.value;
  useLayoutEffect(() => {
    views.set(key, value);
    if (views.size > 400) views.delete(views.keys().next().value!);
  }, [key, value]);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    setSnapshot(previous => {
      const before = previous.key === key ? previous.value : fallback.current.value;
      return { key, value: typeof action === 'function' ? (action as (value: T) => T)(before) : action };
    });
  }, [key]);
  return [value, setValue];
}
