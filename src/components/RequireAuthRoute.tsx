import React, { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useSignInModal } from '../contexts/SignInModalContext';

/**
 * Wraps account-only routes (profile, messages, activity, pantry, circle,
 * create, …). A guest who navigates to one is bounced back to Discover with
 * the sign-in overlay opened, so the app never dead-ends on a screen that
 * needs an account. Signed-in users see the route normally.
 */
export const RequireAuthRoute: React.FC<{ reason?: string; children: React.ReactNode }> = ({
  reason,
  children,
}) => {
  const { isSignedIn } = useAuth();
  const { requireSignIn } = useSignInModal();

  useEffect(() => {
    if (!isSignedIn) requireSignIn(reason);
  }, [isSignedIn, requireSignIn, reason]);

  if (!isSignedIn) return <Navigate to="/" replace />;
  return <>{children}</>;
};
