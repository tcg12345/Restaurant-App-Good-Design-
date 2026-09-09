import { expect, it } from 'vitest';
import { backShadowOpacity, backShadowFrames } from './back-shadow';

it('fades the shadow through the last 64px instead of dropping it after handoff', () => {
  expect(backShadowOpacity(200, 400)).toBe(1);
  expect(backShadowOpacity(336, 400)).toBe(1);
  expect(backShadowOpacity(368, 400)).toBe(.5);
  expect(backShadowOpacity(399.5, 400)).toBeLessThan(.01);
  expect(backShadowOpacity(400, 400)).toBe(0);
  expect(backShadowOpacity(410, 400)).toBe(0);
});
it.each(['right', 'left', 'down'] as const)('matches %s page travel and has no shadow at either end', direction => {
  const frames = backShadowFrames(0, 400, 400, direction);
  expect(frames.map(frame => frame.offset)).toEqual([0, .04, .84, 1]);
  expect(frames.map(frame => frame.opacity)).toEqual([0, 1, 1, 0]);
  expect(frames.at(-1)?.transform).toBe(direction === 'down' ? 'translateY(400px)' : `translateX(${direction === 'left' ? -400 : 400}px)`);
});
it('handles cancelling and re-grabbing without an opacity discontinuity', () => {
  const cancel = backShadowFrames(380, 0, 400, 'right');
  expect(cancel[0].opacity).toBe(backShadowOpacity(380, 400));
  expect(cancel.at(-1)?.opacity).toBe(0);
  expect(cancel.map(frame => frame.offset)).toEqual([...cancel.map(frame => frame.offset)].sort((a,b) => Number(a)-Number(b)));
  const flick = backShadowFrames(385, 400, 400, 'right');
  expect(flick).toHaveLength(2);
  expect(flick[0].opacity).toBe(15/64); expect(flick.at(-1)?.opacity).toBe(0);
});
