/**
 * Thin wrapper over ShareDialog kept for backwards-compatibility with
 * existing call sites. The unified ShareDialog handles the friends list,
 * multi-select, and auto-creating chats.
 */
import React from 'react';
import { ShareDialog } from './ShareDialog';
import type { SharedRecipe } from '../contexts/ChatContext';

export const ShareRecipeSheet: React.FC<{
  open: boolean;
  recipe: SharedRecipe | null;
  onClose: () => void;
}> = ({ open, recipe, onClose }) => (
  <ShareDialog
    open={open && !!recipe}
    payload={recipe ? { sharedRecipe: recipe } : null}
    onClose={onClose}
  />
);
