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
export const RequireAuthRoute: React.FC<{
  reason?: string;
  /** When false (hidden keep-alive layers), render null instead of
   *  <Navigate> — a mounted Navigate in a hidden layer re-fires on every
   *  location change and hijacks ALL navigation back to Home for guests. */
  redirect?: boolean;
  children: React.ReactNode;
}> = ({ reason, redirect = true, children }) => {
  const { isSignedIn } = useAuth();
  const { requireSignIn } = useSignInModal();

  useEffect(() => {
    if (!isSignedIn && redirect) requireSignIn(reason);
  }, [isSignedIn, requireSignIn, reason, redirect]);

  if (!isSignedIn) return redirect ? <Navigate to="/" replace /> : null;
  return <>{children}</>;
};
