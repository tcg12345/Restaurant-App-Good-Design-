/**
 * Thin wrapper over ShareDialog kept for backwards-compatibility. The
 * unified ShareDialog handles the friends list, multi-select, and
 * auto-creating chats.
 */
import React from 'react';
import { ShareDialog } from './ShareDialog';
import type { SharedReel } from '../contexts/ChatContext';

interface ShareReelDialogProps {
  open: boolean;
  onClose: () => void;
  reel: SharedReel | null;
}

export const ShareReelDialog: React.FC<ShareReelDialogProps> = ({ open, onClose, reel }) => (
  <ShareDialog
    open={open && !!reel}
    payload={reel ? { sharedReel: reel } : null}
    onClose={onClose}
  />
);
