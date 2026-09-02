import React from 'react';
import { EmptyState } from 'goodeats';
import { Bookmark, Users, Search } from 'lucide-react';

/** The canonical shape: glyph, one line of what's missing, one of why. */
export const WithAction = () => (
  <EmptyState
    icon={<Bookmark size={44} strokeWidth={1.4} />}
    heading="Your wishlist is empty"
    description="Save places you want to try and they'll collect here."
    action={{ label: 'Find restaurants', onClick: () => {} }}
  />
);

/** No action — for states the user can't resolve from this screen. */
export const WithoutAction = () => (
  <EmptyState
    icon={<Users size={44} strokeWidth={1.4} />}
    heading="Nothing from your circle yet"
    description="Follow friends and tastemakers to see where they're eating and cooking."
  />
);

/** Heading only, for tight surfaces. */
export const HeadingOnly = () => (
  <EmptyState icon={<Search size={44} strokeWidth={1.4} />} heading="No results" />
);
