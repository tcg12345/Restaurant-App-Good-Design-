import { describe, it, expect } from 'vitest';
import { isNativeControlled } from './FeatureTour';

/** isNativeControlled only ever calls getAttribute/querySelector, so a
 *  plain stand-in avoids pulling jsdom into a suite this repo otherwise
 *  keeps DOM-free — see lib/suggestions.ts for the same preference. */
function el(attrs: { ariaHidden?: string; hasHiddenDescendant?: boolean }): HTMLElement {
  return {
    getAttribute: (name: string) => (name === 'aria-hidden' ? attrs.ariaHidden ?? null : null),
    querySelector: (selector: string) => (attrs.hasHiddenDescendant && selector === '[aria-hidden="true"]' ? {} : null),
  } as unknown as HTMLElement;
}

describe('isNativeControlled', () => {
  it('is false for a plain element', () => {
    expect(isNativeControlled(el({}))).toBe(false);
  });

  it('is true when the anchor itself is native-hidden (GlassButton, a GlassGroup region)', () => {
    expect(isNativeControlled(el({ ariaHidden: 'true' }))).toBe(true);
  });

  it("is true when a descendant is native-hidden (useGlassSegments' wrapper)", () => {
    expect(isNativeControlled(el({ hasHiddenDescendant: true }))).toBe(true);
  });

  it('is false when aria-hidden is present but not "true"', () => {
    expect(isNativeControlled(el({ ariaHidden: 'false' }))).toBe(false);
  });
});
