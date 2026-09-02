# Auth email setup — custom sender + branded template

The signup verification code email can be sent from an app-branded address
(e.g. `hello@yourdomain.com`, "GoodEats") instead of Supabase's
default `noreply@mail.app.supabase.io`. Two independent pieces:

## 1. Branded template (5 minutes, no domain needed)

Supabase Dashboard → **Authentication → Emails**:

- **Confirm signup** template → paste the contents of
  [`supabase/templates/confirm-signup-email.html`](../supabase/templates/confirm-signup-email.html).
  Subject: `Your GoodEats verification code`.
- **Magic Link** template → paste the same HTML, same subject. (Edge cases
  in the sign-in flow can deliver this template to existing accounts; both
  must contain `{{ .Token }}` for the in-app 6-digit code screen.)

## 2. Custom sender via SMTP (needs a domain you own)

Supabase's built-in mailer can't change the from-address and is rate-limited
to a handful of emails per hour — fine for testing, not for real users.
Plug in your own SMTP provider:

1. **Pick a provider.** Resend is the easiest (free tier: 3,000
   emails/month; first-class Supabase docs). Postmark and SendGrid work the
   same way.
2. **Verify your domain** with the provider: add the DNS records they give
   you (SPF + DKIM, usually 2–3 CNAME/TXT records). This is what lets your
   emails land in inboxes instead of spam. You can't send from a domain you
   don't control (no `@gmail.com`).
3. **Create an SMTP API key** in the provider dashboard.
4. **Supabase Dashboard → Project Settings → Authentication → SMTP
   Settings → Enable custom SMTP**, then (Resend values shown):
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: *(the API key)*
   - Sender email: `hello@yourdomain.com` (any address at the verified domain)
   - Sender name: `GoodEats`
5. **Raise the rate limits** — Supabase Dashboard → Authentication → Rate
   Limits: with custom SMTP enabled you can lift the per-hour email cap
   from the default (~2/hr) to something real (e.g. 100+/hr).

No app-code changes are involved — the client calls the same Supabase auth
APIs; only the delivery pipeline and template change.

## Testing

After wiring SMTP, sign up with a fresh email and check: sender name/address
are yours, the 6-digit code renders large in the terracotta card, and the
message lands in the inbox (not spam). If it spams, re-check the DKIM
records with your provider's domain-verification page.
