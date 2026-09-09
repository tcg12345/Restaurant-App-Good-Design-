import { describe, it, expect, vi } from 'vitest';
const bridge = vi.hoisted(() => ({ setOwner: vi.fn().mockResolvedValue(undefined), sync: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => 'ios' }, registerPlugin: () => bridge }));
import { clearWidgets, setWidgetOwner, syncWidgets } from './native-widgets';
import type { WidgetSnapshot } from './widget-data';
describe('widget account isolation', () => {
  it('drops queued stale writes when the account is cleared', async () => {
    await setWidgetOwner('alice');
    bridge.sync.mockClear();
    const stale = syncWidgets({ owner: 'alice' } as WidgetSnapshot);
    await clearWidgets(); await stale;
    expect(bridge.sync).not.toHaveBeenCalled();
    expect(bridge.setOwner).toHaveBeenLastCalledWith({ owner: '' });
  });
  it('ignores wrong-owner data and resumes for the new account', async () => {
    await setWidgetOwner('bob'); bridge.sync.mockClear();
    await syncWidgets({ owner: 'alice' } as WidgetSnapshot);
    expect(bridge.sync).not.toHaveBeenCalled();
    await syncWidgets({ owner: 'bob' } as WidgetSnapshot);
    expect(bridge.sync).toHaveBeenCalledWith({ owner: 'bob', snapshot: '{"owner":"bob"}' });
  });
  it('recovers the queue after a native write failure', async () => {
    bridge.sync.mockRejectedValueOnce(new Error('temporarily unavailable'));
    await expect(syncWidgets({ owner: 'bob' } as WidgetSnapshot)).rejects.toThrow();
    await expect(clearWidgets()).resolves.toBeUndefined();
  });
});
