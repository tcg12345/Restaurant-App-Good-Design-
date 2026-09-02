import { describe, it, expect } from 'vitest';
import { isAllowedAppPath } from './app-routes';

describe('isAllowedAppPath', () => {
  it('accepts static in-app routes', () => {
    for (const p of ['/', '/pantry', '/experts', '/location', '/location/map', '/activity/saved', '/profile/taste']) {
      expect(isAllowedAppPath(p)).toBe(true);
    }
  });

  it('accepts dynamic routes with a non-empty segment', () => {
    expect(isAllowedAppPath('/restaurant/ChIJabc123')).toBe(true);
    expect(isAllowedAppPath('/user/jamie')).toBe(true);
    expect(isAllowedAppPath('/user/jamie/taste')).toBe(true);
    expect(isAllowedAppPath('/recipe/user-1/recipe-9')).toBe(true);
    expect(isAllowedAppPath('/restaurant/xyz/circle')).toBe(true);
  });

  it('ignores query string and hash', () => {
    expect(isAllowedAppPath('/user/jamie?ref=chat')).toBe(true);
    expect(isAllowedAppPath('/pantry#top')).toBe(true);
  });

  it('tolerates a single trailing slash', () => {
    expect(isAllowedAppPath('/pantry/')).toBe(true);
  });

  it('rejects unknown routes', () => {
    expect(isAllowedAppPath('/totally-made-up')).toBe(false);
    expect(isAllowedAppPath('/restaurant')).toBe(false); // missing :id
    expect(isAllowedAppPath('/user/')).toBe(false);      // empty :username
  });

  it('rejects off-app and malicious targets', () => {
    expect(isAllowedAppPath('//evil.example')).toBe(false);
    expect(isAllowedAppPath('https://evil.example')).toBe(false);
    expect(isAllowedAppPath('/../secret')).toBe(false);
    expect(isAllowedAppPath('/pantry/../admin/verification/..')).toBe(false);
    expect(isAllowedAppPath('javascript:alert(1)')).toBe(false);
    expect(isAllowedAppPath('')).toBe(false);
    expect(isAllowedAppPath(null as unknown as string)).toBe(false);
  });
});
