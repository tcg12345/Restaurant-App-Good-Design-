import { sanitizeTastePreferences } from '../src/lib/taste-preferences';
export const usePaywall = () => ({ handleAiError: () => false, requirePro: () => true, openPaywall: () => {} });
export const usePlan = () => ({ checked: true, isPro: true, quota: null, refreshQuota: () => {} });
export const useTastePreferences = () => ({ preferences: sanitizeTastePreferences({}) });
const pause = (signal?: AbortSignal) => new Promise<void>(resolve => { const t = setTimeout(resolve, 7000); signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true }); });
export async function importRecipe(_source: unknown, signal?: AbortSignal) { await pause(signal); return { ok: false, error: 'Preview complete. Your source is preserved for another try.' }; }
export const compressImportPhoto = async () => '/images/onboarding/contemporary-dining.jpg';
export async function generateRecipe(_prompt: string, signal?: AbortSignal) { await pause(signal); return { ok: false, error: 'Preview complete. Your prompt is preserved for another try.' }; }
export async function generateRecipeIdeas(_prompt: string, options: { signal?: AbortSignal }) { await pause(options.signal); return { ok: true, ideas: ['Lemony orzo with roasted vegetables','Crispy tofu rice bowls','Creamy mushroom toast','Herby white bean salad'].map(title => ({title,blurb:'Bright flavors, simple ingredients, and an easy weeknight rhythm.',totalTimeMin:25,difficulty:'Easy',cuisine:'Mediterranean'})) }; }
export const combineRecipes = async (_items: unknown, options: { signal?: AbortSignal }) => generateRecipe('', options.signal);
