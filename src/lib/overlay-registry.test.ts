import { describe, expect, it, vi } from 'vitest';
import { isOverlayOpen, pushOverlay, subscribeOverlay, subscribePresenterOverlay } from './overlay-registry';

describe('overlay presentation ownership', () => {
  it('keeps gallery gestures blocked while a nested sheet independently dims and restores the presenter', () => {
    const overlays = vi.fn(), presenter = vi.fn();
    const unsubscribe = subscribeOverlay(overlays), unpresent = subscribePresenterOverlay(presenter);
    const closeGallery = pushOverlay({ dimPresenter: false });
    const closeSheet = pushOverlay();
    const closeSecondSheet = pushOverlay();
    closeSheet(); closeSheet();
    expect(isOverlayOpen()).toBe(true);
    expect(presenter.mock.calls).toEqual([[false], [true]]);
    closeSecondSheet();
    expect(presenter.mock.calls).toEqual([[false], [true], [false]]);
    expect(isOverlayOpen()).toBe(true);
    closeGallery();
    expect(overlays.mock.calls).toEqual([[false], [true], [false]]);
    expect(isOverlayOpen()).toBe(false);
    unsubscribe(); unpresent();
  });
});
