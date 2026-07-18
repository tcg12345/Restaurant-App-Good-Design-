import { describe, it, expect } from 'vitest';
import { moveWithinCustomOrder } from './customOrder';

describe('moveWithinCustomOrder', () => {
  it('behaves like a plain splice when nothing is filtered', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(moveWithinCustomOrder(order, order, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveWithinCustomOrder(order, order, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('leaves hidden (filtered-out) restaurants exactly where they were', () => {
    // Full ranking a..f; a cuisine filter shows only b, d, f.
    const order = ['a', 'b', 'c', 'd', 'e', 'f'];
    const visible = ['b', 'd', 'f'];
    // Drag f (visible #3) up to b's spot (visible #1).
    const next = moveWithinCustomOrder(order, visible, 2, 0);
    expect(next).toEqual(['a', 'f', 'b', 'c', 'd', 'e']);
    // a, c, e keep their relative global positions — the old rebuild
    // produced ['b','d','f','a','c','e'], shoving every hidden id to the back.
  });

  it('moving down inserts after the visible target', () => {
    const order = ['a', 'b', 'c', 'd', 'e', 'f'];
    const visible = ['b', 'd', 'f'];
    // Drag b (visible #1) down to d's spot (visible #2).
    expect(moveWithinCustomOrder(order, visible, 0, 1)).toEqual(['a', 'c', 'd', 'b', 'e', 'f']);
  });

  it('appends ratings missing from the saved order before splicing', () => {
    // z was rated on another device and never entered this order.
    const order = ['a', 'b'];
    const visible = ['a', 'b', 'z'];
    expect(moveWithinCustomOrder(order, visible, 2, 0)).toEqual(['z', 'a', 'b']);
  });

  it('no-ops on same-position or out-of-range moves', () => {
    expect(moveWithinCustomOrder(['a', 'b'], ['a', 'b'], 1, 1)).toBeNull();
    expect(moveWithinCustomOrder(['a', 'b'], ['a', 'b'], 0, 5)).toBeNull();
  });
});
