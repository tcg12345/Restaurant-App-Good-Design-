// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProfileSetup } from './ProfileSetup';
import { TASTE_QUESTION_ORDER } from '../lib/onboarding-progress';

const mock = vi.hoisted(() => ({
  save: vi.fn(async () => ({ success: true })), taste: vi.fn(async () => {}),
  refresh: vi.fn(async () => {}), enable: vi.fn(async () => {}), complete: vi.fn(),
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'test', user_metadata: { full_name: 'Test User' } }, profile: null, refreshProfile: mock.refresh, signOut: vi.fn() }) }));
vi.mock('../contexts/PushNotificationsContext', () => ({ usePushNotifications: () => ({ native: true, permission: 'prompt', preferences: { enabled: false }, loading: false, busy: false, error: '', enable: mock.enable }) }));
vi.mock('../lib/native-notifications', () => ({ supportsIOSNotifications: () => true }));
vi.mock('../lib/supabase-community', () => ({ saveProfile: mock.save, isUsernameTaken: async () => false }));
vi.mock('../lib/taste-quiz', () => ({ getTasteQuiz: () => ({ completedSteps: ['goal', 'city', 'cuisines', 'prices', 'atmosphere'] }), saveTasteQuiz: mock.taste }));
vi.mock('../lib/preauth', () => ({ getPreauthCity: () => null }));
vi.mock('../lib/onboarding-events', () => ({ logOnboardingEvent: vi.fn(), markOnboardingStep: vi.fn() }));
vi.mock('../components/HomeLocationBar', () => ({ geocodePlace: async () => null, savePickedLocation: vi.fn() }));
vi.mock('../lib/images', () => ({ processPhoto: vi.fn() }));

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); vi.useFakeTimers();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  HTMLElement.prototype.scrollTo = vi.fn();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function click(text: string) {
  const button = Array.from(host.querySelectorAll('button')).find(b => b.textContent === text)!;
  expect(button).toBeDefined(); expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
it('hands account setup to the notification page before completing, and saves only taste questions as answers', async () => {
  await act(async () => root.render(<ProfileSetup onComplete={mock.complete} />));
  await act(async () => vi.advanceTimersByTimeAsync(450));
  await click('Continue');
  expect(host.textContent).toContain('Enable notifications');
  expect(mock.enable).not.toHaveBeenCalled(); expect(mock.complete).not.toHaveBeenCalled();
  expect(mock.refresh).not.toHaveBeenCalled();
  await click('Not now');
  expect(mock.refresh).toHaveBeenCalledTimes(1); expect(mock.complete).toHaveBeenCalledTimes(1);
  expect(mock.taste).toHaveBeenLastCalledWith('test', expect.objectContaining({ completedSteps: [...TASTE_QUESTION_ORDER] }), { requireRemote: true });
});
