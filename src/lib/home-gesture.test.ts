import { describe, expect, it } from 'vitest';
import { homeSwipeDestination } from './home-gesture';
describe('Home navigation gestures', () => {
  it('opens the feed upwards and search downwards from Home', () => {
    expect(homeSwipeDestination('home', 4, -90, 0)).toBe('feed');
    expect(homeSwipeDestination('home', 4, 90, 0)).toBe('search');
  });
  it('keeps scrolling Home until a new pull starts at the top', () => {
    expect(homeSwipeDestination('home', 0, 90, 200)).toBeNull();
    expect(homeSwipeDestination('home', 0, -90, 200, 500)).toBeNull();
  });
  it('does not intercept taps, short pulls or horizontal carousels', () => {
    expect(homeSwipeDestination('home', 0, 20, 0)).toBeNull();
    expect(homeSwipeDestination('home', 100, 90, 0)).toBeNull();
  });
  it('returns home only on a downward swipe starting at the feed top', () => {
    expect(homeSwipeDestination('feed', 0, 90, 0)).toBe('home');
    expect(homeSwipeDestination('feed', 2, 52, 1.5)).toBe('home');
    expect(homeSwipeDestination('feed', 0, 90, 200)).toBeNull();
    expect(homeSwipeDestination('feed', 0, -90, 0)).toBeNull();
  });
});

it('opens the feed only from the bottom of scrollable Home content', () => {
  expect(homeSwipeDestination('home', 0, -90, 0, 300)).toBeNull();
  expect(homeSwipeDestination('home', 0, -90, 300, 300)).toBe('feed');
  expect(homeSwipeDestination('home', 0, 90, 300, 300)).toBeNull();
  expect(homeSwipeDestination('home', 0, 90, 0, 300)).toBe('search');
});
