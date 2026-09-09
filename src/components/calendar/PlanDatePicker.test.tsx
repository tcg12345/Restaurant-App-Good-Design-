// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { PlanDatePicker } from './PlanDatePicker';
let root: Root, host: HTMLDivElement;
function Harness() { const [date, setDate] = useState('2026-12-31'); return <><PlanDatePicker value={date} onChange={setDate} /><output>{date}</output></>; }
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function click(selector: string) { await act(async () => host.querySelector<HTMLButtonElement>(selector)!.click()); }
it('selects a custom date across a year boundary and returns focus to the date control', async () => {
  await click('button[aria-label="Choose another date"]'); await click('button[aria-label="Next month"]');
  expect(host.querySelector('.plan-date-month')!.textContent).toContain('2027');
  await click('button[data-date="2027-01-15"]');
  expect(host.querySelector('output')!.textContent).toBe('2027-01-15'); expect(host.querySelector('.plan-date-grid')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('button[aria-label="Choose another date"]'));
});
it('closes the date picker on Escape without changing the date or dismissing the event form', async () => {
  await click('button[aria-label="Choose another date"]');
  const bubble = vi.fn(); document.addEventListener('keydown', bubble);
  await act(async () => host.querySelector('.plan-date-popover')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(host.querySelector('.plan-date-grid')).toBeNull(); expect(host.querySelector('output')!.textContent).toBe('2026-12-31'); expect(bubble).not.toHaveBeenCalled(); document.removeEventListener('keydown', bubble);
});
