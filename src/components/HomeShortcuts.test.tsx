// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { HomeShortcuts } from './HomeShortcuts';
vi.mock('../lib/glass-buttons', () => ({
  GlassButton: ({label,onClick,children}:any) => <button aria-label={label} onClick={onClick}>{children}</button>,
  GlassGroup: ({items}:any) => <div data-glass-group="">{items.map((i:any)=><button key={i.id} aria-label={i.label} data-badge={i.badge} onClick={i.onClick}>{i.icon}</button>)}</div>,
}));
function RouteProbe(){ const l=useLocation();return <output>{l.pathname}{l.search}</output>; }
it('puts calendar and unread notifications in one capsule with direct routes and no overflow menu', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
  try {
    await act(async()=>root.render(<MemoryRouter><HomeShortcuts notificationCount={3}/><RouteProbe/></MemoryRouter>));
    expect(host.querySelector('[aria-label="More"]')).toBeNull();
    expect(host.querySelectorAll('[data-glass-group] button')).toHaveLength(2);
    expect(host.querySelector('[aria-label="Notifications"]')?.getAttribute('data-badge')).toBe('3');
    for(const [name,path] of [['Create','/create'],['Calendar','/calendar'],['Notifications','/settings/notifications?view=activity']]) {
      await act(async()=>host.querySelector<HTMLButtonElement>(`[aria-label="${name}"]`)!.click());
      expect(host.querySelector('output')?.textContent).toBe(path);
    }
  } finally { await act(async()=>root.unmount());host.remove(); }
});
