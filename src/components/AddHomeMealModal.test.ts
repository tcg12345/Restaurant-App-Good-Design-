// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AddHomeMealModal } from './AddHomeMealModal';
const state = vi.hoisted(() => ({ homeMealModalOpen: true, homeMealModalInitialMethod: undefined as string | undefined, closeHomeMealModal: vi.fn() }));
vi.mock('../contexts/ListsContext', () => ({ useLists: () => state }));
vi.mock('../contexts/SettingsContext', () => ({ useSettings: () => ({ phoneMode: true }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../contexts/ToastContext', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('../contexts/AiChatHistoryContext', () => ({ useAiChatHistory: () => ({ addGeneratedRecipeChat: vi.fn() }) }));
vi.mock('../contexts/PaywallContext', () => ({ usePaywall: () => ({ requirePro: () => true, handleAiError: () => false }) }));
vi.mock('../contexts/PlanContext', () => ({ usePlan: () => ({ checked: true, isPro: true }) }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../lib/glass-buttons', () => ({ wakeGlassButtons: vi.fn(), GlassButton: ({ label, onClick }: any) => React.createElement('button', { onClick }, label) }));
vi.mock('./ImportRecipePanel', () => ({ ImportRecipePanel: ({ initialTab, tabSlot }: any) => React.createElement('main', null, initialTab, tabSlot) }));
vi.mock('./AiRecipeGenerator', () => ({ AiRecipeGenerator: ({ tabSlot }: any) => React.createElement('main', null, 'ai', tabSlot) }));
vi.mock('./DishPhotoGenerator', () => ({ DishPhotoGenerator: ({ tabSlot }: any) => React.createElement('main', null, 'dish', tabSlot) }));
vi.mock('./AdvancedRecipeBuilder', () => ({ AdvancedRecipeBuilder: ({ tabSlot }: any) => React.createElement('main', null, 'custom', tabSlot) }));
vi.mock('./chat/RecipeDraftSheet', () => ({ RecipeDraftSheet: () => null }));
vi.mock('motion/react', async original => ({ ...await original<object>(), useReducedMotion: () => true }));
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  state.homeMealModalOpen = true; state.homeMealModalInitialMethod = undefined;
  window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() });
  window.scrollTo = vi.fn();
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render() { await act(async () => root.render(React.createElement(AddHomeMealModal))); }
async function click(text: string) { await act(async () => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes(text))!.click()); }
it.each(['link', 'photo', 'text', 'custom', 'ai', 'dish'])('opens %s directly, without presenting the chooser first', async method => {
  state.homeMealModalInitialMethod = method; await render();
  expect(container.querySelector('main')?.textContent).toContain(method);
  expect(container.querySelector('.rcx-choose')).toBeNull();
  expect(container.querySelector('.recipe-builder-surface')?.hasAttribute('data-sheet-capped')).toBe(false);
});
it('switches every method immediately in one surface and removes the chooser height cap', async () => {
  await render(); const surface = container.querySelector('.recipe-builder-surface');
  for (const name of ['From a web link', 'Scan a recipe', 'From text', 'Start from scratch', 'Create with AI', 'Recreate a dish']) {
    await click(name);
    expect(container.querySelector('.rcx-choose')).toBeNull(); expect(container.querySelector('main')).not.toBeNull();
    expect(container.querySelector('.recipe-builder-surface')).toBe(surface);
    expect(surface?.hasAttribute('data-sheet-capped')).toBe(false);
    await click('Back to new recipe'); expect(container.querySelector('.rcx-choose')).not.toBeNull();
  }
});
