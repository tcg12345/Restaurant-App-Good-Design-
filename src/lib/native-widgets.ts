import { Capacitor, registerPlugin } from '@capacitor/core';
import type { WidgetSnapshot } from './widget-data';
const Bridge = registerPlugin<{
  setOwner(options: { owner: string }): Promise<void>;
  sync(options: { owner: string; snapshot: string }): Promise<void>;
}>('GoodEatsWidgets');
export const supportsWidgets = () => Capacitor.getPlatform() === 'ios';
// Serialize writes across account changes. A pending old snapshot cannot follow a clear.
let queue = Promise.resolve();
let owner = '';
let generation = 0;
export function setWidgetOwner(next: string): Promise<void> {
  owner = next; generation++;
  if (!supportsWidgets()) return Promise.resolve();
  queue = queue.catch(() => {}).then(() => Bridge.setOwner({ owner: next }));
  return queue;
}
export function clearWidgets(): Promise<void> { return setWidgetOwner(''); }
export function syncWidgets(snapshot: WidgetSnapshot): Promise<void> {
  const revision = generation;
  if (!supportsWidgets() || snapshot.owner !== owner || !owner) return Promise.resolve();
  queue = queue.catch(() => {}).then(async () => {
    if (generation === revision && snapshot.owner === owner) await Bridge.sync({ owner, snapshot: JSON.stringify(snapshot) });
  });
  return queue;
}
