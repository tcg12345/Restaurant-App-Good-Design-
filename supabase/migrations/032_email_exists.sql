-- 032: email_exists() — reliable, side-effect-free check for the email-first
-- auth screen.
-- ════════════════════════════════════════════════════════════════════
-- The client used to test "does this email have an account?" by calling
-- auth.signInWithOtp({ shouldCreateUser:false }), which actually SENDS a
-- magic-link email and, once Supabase's (low) email rate limit is hit — which
-- happens fast in production — returns an error for EVERY email. The client
-- read that error as "new user" and sent returning users to the create-account
-- screen, where sign-up then failed with "user already registered."
--
-- This function answers the same question by reading auth.users directly, with
-- no email sent and no rate limit. SECURITY DEFINER so it can see auth.users;
-- it returns only a boolean (the same enumeration the two-screen UX already
-- implies), and is callable pre-auth (the welcome screen runs before sign-in).

create or replace function public.email_exists(check_email text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1 from auth.users
    where lower(email) = lower(trim(check_email))
  );
$$;

revoke all on function public.email_exists(text) from public;
grant execute on function public.email_exists(text) to anon, authenticated;
