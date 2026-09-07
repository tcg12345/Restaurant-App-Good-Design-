import { describe, expect, it } from 'vitest';
import { photoPullDestination, photoPullIntent } from './restaurant-photo-gesture';
describe('restaurant photo pull', () => {
 it('yields to normal scrolling when the details are not at the top', () => {
  expect(photoPullIntent(false, 2, 90, false)).toBe('scroll');
  expect(photoPullIntent(false, 2, -90, true)).toBe('scroll');
 });
 it('does not steal taps or horizontal photo swipes', () => {
  expect(photoPullIntent(false, 2, 5, true)).toBe('wait');
  expect(photoPullIntent(false, 80, 20, true)).toBe('scroll');
 });
 it('pulls down to photos and up to details', () => {
  expect(photoPullIntent(false, 3, 50, true)).toBe('pull');
  expect(photoPullIntent(true, 3, -50, true)).toBe('pull');
 });
 it('snaps short drags back but accepts deliberate pulls and flicks', () => {
  expect(photoPullDestination(false, .1, 0)).toBe(false);
  expect(photoPullDestination(false, .3, 0)).toBe(true);
  expect(photoPullDestination(false, .05, .7)).toBe(true);
  expect(photoPullDestination(false, .01, .7)).toBe(false);
  expect(photoPullDestination(true, .9, 0)).toBe(true);
  expect(photoPullDestination(true, .6, 0)).toBe(false);
  expect(photoPullDestination(true, .9, -.7)).toBe(false);
 });
});
