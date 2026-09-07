// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImportRecipePanel } from './ImportRecipePanel';
import { AiRecipeGenerator } from './AiRecipeGenerator';
import { RecipeGeneration } from './RecipeGeneration';
const { importRecipe, generateRecipe, generateRecipeIdeas, combineRecipes } = vi.hoisted(() => ({ importRecipe: vi.fn(), generateRecipe: vi.fn(), generateRecipeIdeas: vi.fn(), combineRecipes: vi.fn() }));
vi.mock('../lib/import-recipe-client', () => ({ importRecipe, compressImportPhoto: async () => 'data:image/jpeg;base64,photo' }));
vi.mock('../lib/build-recipe-client', () => ({ generateRecipe, generateRecipeIdeas, combineRecipes }));
vi.mock('../contexts/PaywallContext', () => ({ usePaywall: () => ({ handleAiError: () => false, requirePro: () => true }) }));
vi.mock('../contexts/PlanContext', () => ({ usePlan: () => ({ checked: true, isPro: true }) }));
vi.mock('../hooks/useTastePreferences', () => ({ useTastePreferences: () => ({ preferences: {} }) }));
vi.mock('../lib/taste-preferences', () => ({ tastePreferenceText: () => '' }));
vi.mock('./pro/QuotaMeter', () => ({ QuotaMeter: () => null }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../lib/glass-buttons', () => ({ GlassButton: ({ children, label, onClick }: any) => React.createElement('button', { 'aria-label': label, onClick }, children) }));
vi.mock('motion/react', async () => {
  const React = await import('react'); const cache: Record<string, unknown> = {};
  return { motion: new Proxy({}, { get: (_, tag: string) => cache[tag] ||= React.forwardRef(({ children, initial, animate, exit, transition, layout, ...rest }: any, ref: any) => React.createElement(tag, { ...rest, ref }, children)) }), AnimatePresence: ({ children }: any) => children, MotionConfig: ({ children }: any) => children, useReducedMotion: () => true };
});
let root: Root, container: HTMLDivElement;
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }); container = document.createElement('div'); document.body.append(container); root = createRoot(container); vi.clearAllMocks(); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const mount = async (component: React.ReactNode) => { await act(async () => root.render(component)); };
async function click(label: string) { const button = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(el => el.getAttribute('aria-label') === label || el.textContent?.trim() === label)!; expect(button).toBeTruthy(); await act(async () => button.click()); }
async function input(selector: string, value: string) { await act(async () => { const el = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!; const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); }); }
it('keeps the source after canceling a web import and ignores a late response', async () => {
  let finish: (value: any) => void; importRecipe.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const imported = vi.fn(); await mount(React.createElement(ImportRecipePanel, { onImported: imported, onClose: vi.fn(), initialTab: 'link', phoneMode: true }));
  expect(container.querySelector<HTMLButtonElement>('.rcx-foot-cta')!.disabled).toBe(true);
  await input('[aria-label="Recipe web link"]', 'example.com/dinner'); await click('Import recipe');
  expect(importRecipe.mock.calls[0][0]).toEqual({ url: 'https://example.com/dinner' });
  expect(container.querySelector('[role="progressbar"]')?.hasAttribute('aria-valuenow')).toBe(false);
  await click('Cancel'); expect(importRecipe.mock.calls[0][1].aborted).toBe(true);
  await act(async () => finish!({ ok: true, meal: { name: 'Late draft' } })); expect(imported).not.toHaveBeenCalled();
  expect(container.querySelector<HTMLInputElement>('[aria-label="Recipe web link"]')!.value).toBe('example.com/dinner');
});
it('passes pasted recipe text through and returns the editable draft', async () => {
  const meal = { name: 'A recipe', notes: 'Source preserved' }; importRecipe.mockResolvedValue({ ok: true, meal });
  const imported = vi.fn(); await mount(React.createElement(ImportRecipePanel, { onImported: imported, onClose: vi.fn(), initialTab: 'text' }));
  await input('[aria-label="Recipe text"]', 'Soup\n2 carrots\nSimmer until tender.'); await click('Import recipe');
  expect(importRecipe.mock.calls[0][0]).toEqual({ text: 'Soup\n2 carrots\nSimmer until tender.' }); expect(imported).toHaveBeenCalledWith(meal);
});
it('accepts scanned photos and imports the selected images', async () => {
  importRecipe.mockResolvedValue({ ok: false, error: 'Try a clearer photo.' });
  await mount(React.createElement(ImportRecipePanel, { onImported: vi.fn(), onClose: vi.fn(), initialTab: 'photo', phoneMode: true }));
  expect(container.querySelector('.rcx-photo-slot')?.tagName).toBe('BUTTON');
  await act(async () => { const el = container.querySelector<HTMLInputElement>('input[type="file"]')!; Object.defineProperty(el, 'files', { value: [new File(['image'], 'recipe.jpg', { type: 'image/jpeg' })] }); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await click('Import recipe'); expect(importRecipe.mock.calls[0][0]).toEqual({ images: ['data:image/jpeg;base64,photo'] });
  expect(container.textContent).toContain('Try a clearer photo.'); expect(container.querySelector('.rcx-import-thumb img')).not.toBeNull();
});
it('can cancel ideas without losing the ability to retry', async () => {
  let finish: (value: any) => void; generateRecipeIdeas.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await mount(React.createElement(AiRecipeGenerator, { onGenerated: vi.fn(), onClose: vi.fn(), initialView: 'ideas', phoneMode: true }));
  await click('Get ideas'); expect(container.querySelector<HTMLButtonElement>('.rcxa-mode-btn')!.disabled).toBe(true);
  await click('Cancel'); expect(generateRecipeIdeas.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => finish!({ ok: true, ideas: [{ title: 'Late idea', blurb: 'Must not show' }] }));
  expect(container.textContent).not.toContain('Late idea'); expect(container.querySelector<HTMLButtonElement>('[aria-label="Get ideas"]')!.disabled).toBe(false);
});
it('labels estimated progress and never claims completion before a result', async () => {
  await mount(React.createElement(RecipeGeneration, { kind: 'recipe', progress: 1, elapsed: 45, onCancel: vi.fn() }));
  expect(container.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('99'); expect(container.textContent).toContain('taking a little longer');
});

it('reveals idea cards and cancels a combination without accepting a late draft', async () => {
  generateRecipeIdeas.mockResolvedValue({ ok: true, ideas: [{ title: 'Lemony orzo', blurb: 'Bright and simple', difficulty: 'Easy' }, { title: 'Roasted vegetables', blurb: 'Seasonal favorites', difficulty: 'Easy' }] });
  let finish: (value: any) => void; combineRecipes.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const generated = vi.fn();
  await mount(React.createElement(AiRecipeGenerator, { onGenerated: generated, onClose: vi.fn(), initialView: 'ideas', phoneMode: true }));
  await click('Get ideas'); expect(container.querySelectorAll('.rcxa-card')).toHaveLength(2);
  await act(async () => container.querySelectorAll<HTMLElement>('.rcxa-card')[0].click());
  await act(async () => container.querySelectorAll<HTMLElement>('.rcxa-card')[1].click());
  await click('Combine these 2'); await click('Combine');
  expect(container.querySelector('.rcxa-combine-sheet .recipe-generation')).not.toBeNull();
  await click('Cancel'); expect(combineRecipes.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => finish!({ ok: true, meal: { name: 'Late combination' } })); expect(generated).not.toHaveBeenCalled();
});
