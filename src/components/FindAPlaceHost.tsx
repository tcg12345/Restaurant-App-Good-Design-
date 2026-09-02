/**
 * App-root host for the "Find a place" sheet — see lib/find-a-place for
 * why it can't live inside the chat that opens it.
 *
 * Two ways out, and they mean different things:
 *   - CLOSE (the X, the backdrop, a drag down) — the person changed their
 *     mind, so they go back to the chat they came from. The chat unmounted
 *     itself when this sheet registered its overlay, so "back" is an open
 *     request the chat honours on its next mount (see LocationChat).
 *   - NAVIGATE (the CTA) — they're leaving for the ranked list; reopening
 *     the chat on top of it would be the wrong destination.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useAssistantContext } from '../contexts/AssistantContext';
import { subscribeFindAPlace } from '../lib/find-a-place';
import { ChatRecsSheet } from './ChatRecsSheet';

export const FindAPlaceHost: React.FC = () => {
  const { user } = useAuth();
  const { requestOpen } = useAssistantContext();
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeFindAPlace(() => setOpen(true)), []);

  const close = useCallback(() => {
    setOpen(false);
    requestOpen();
  }, [requestOpen]);
  const leave = useCallback(() => setOpen(false), []);

  return (
    <ChatRecsSheet
      open={open}
      onClose={close}
      onNavigate={leave}
      userId={user?.id ?? null}
    />
  );
};
