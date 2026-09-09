/** The social hub's query parameters select content inside the same page.
 * REPLACE changes the router key but keeps the history slot; retain the
 * page (and its native glass control) in that slot. A pushed conversation
 * still gets its own instance and normal Back behavior. */
export function routeInstanceKey(pathname: string, locationKey: string, historyIndex: number | null): string {
  return pathname === '/messages' && historyIndex !== null
    ? `social-hub-entry-${historyIndex}`
    : locationKey;
}
