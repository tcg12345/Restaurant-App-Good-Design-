import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useHomeHighlightSocial } from './useHomeHighlightSocial';

function InitialHome({ userId }: { userId?: string }) {
  const social = useHomeHighlightSocial(userId);
  return React.createElement('span', null, social.people.length + social.places.length + social.recipes.length);
}

describe('Home before social data is loaded', () => {
  it('renders safely for a guest with no account or cached social state', () => {
    expect(renderToStaticMarkup(React.createElement(InitialHome))).toBe('<span>0</span>');
  });
  it('renders safely while a signed-in account’s social data is loading', () => {
    expect(renderToStaticMarkup(React.createElement(InitialHome, { userId: 'new-user' }))).toBe('<span>0</span>');
  });
});
