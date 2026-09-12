# Subscription release switch

GoodEats currently ships fully free. Billing implementation and visual designs are retained; do not delete them to prepare a free release.

## Controls

- `supabase/functions/_shared/subscription-release.ts`: `SUBSCRIPTIONS_ENABLED = false`. The app imports the same switch through `src/lib/subscription-release.ts`; billing-checkout imports it directly. It is a build/deployment setting, not a reviewer-specific or remote-hidden feature.
- `public.billing_settings.gates_enabled = false`: existing server configuration makes every authenticated user’s effective plan `pro`, without creating a subscription, grant, or payment record. Standard authentication, privacy checks, and the existing Pro-tier usage/rate limits remain enforced. Free means no payment is needed, not unbounded provider usage.

With the release switch off, the app grants access immediately without fetching plans or initializing RevenueCat. Paywall requests do nothing; Pro tags, subscription settings, restore FAQ, and group upsells disappear. `/pro`, `/pro/welcome`, and `/pro/intro` redirect Home. `/settings/subscription` shows the settings index. Billing calls cannot launch purchases, restore, management, or checkout. The authenticated checkout endpoint returns HTTP 409 with `subscriptions_disabled` before creating any Stripe customer or checkout session.

The database plan fields, grants, receipts, webhooks, reconciliation, product definitions, SDK dependency, subscription designs and CSS remain intact. Disabling the release does not cancel an existing Apple/Stripe subscription or invalidate an already-issued Stripe Checkout URL. Before disabling billing on a future paid release, reconcile actual provider subscriptions and handle renewals explicitly. At this release’s inspection no profile had `plan = 'pro'`; complimentary grants are distinct from paid plans.

## Re-enable for a later reviewed release

1. Configure and verify the App Store Connect products, Paid Apps agreement/tax/banking, RevenueCat entitlement and offerings, and web Stripe products if web purchases are offered. Preserve the existing product identifiers and webhook secrets.
2. Change the shared release switch to `true` on the release branch. This restores the existing UI and SDK paths. Existing billing tests explicitly exercise enabled mode even while the shipping default is false.
3. Deploy `billing-checkout` from that revision and build new web/iOS clients. Test purchase, cancellation, restore, renewal, expiry, transfers and webhook reconciliation in sandbox/TestFlight. The switch alone does not configure payment providers.
4. Submit the new iOS version with its subscription products and accurate pricing/disclosures for Apple review. Keep existing free client versions in mind when introducing restrictions; plan an upgrade path before enabling server gates globally.
5. When the paid release is ready, an authorized administrator can call `public.set_billing_gates(true)`. This is the existing server enforcement toggle; it is deliberately separate from publishing a new app binary. Confirm `get_plan_context()` and quota behavior for subscribed and unsubscribed accounts.

To keep/revert server access to fully free using a privileged administrative SQL connection:

```sql
update public.billing_settings
set gates_enabled = false, updated_at = now()
where id = true;
```

No schema migration is necessary for this existing configuration row. New databases already default the flag to false in migration 087.
