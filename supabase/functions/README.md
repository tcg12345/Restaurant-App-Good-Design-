# Edge Functions

These run on Supabase (Deno), called from both the web and native apps at
`<VITE_SUPABASE_URL>/functions/v1/<name>`.

## AI functions

| Function | Purpose | Secret used |
|----------|---------|-------------|
| `location-chat` | Streaming AI chat (Anthropic) | `ANTHROPIC_API_KEY` |
| `build-recipe` | "Create with AI" recipe authoring (Anthropic) | `ANTHROPIC_API_KEY` |
| `import-recipe` | Import tab — transcribe a recipe from a URL / photos / pasted text (Anthropic) | `ANTHROPIC_API_KEY` |
| `generate-recipe-image` | Recipe hero photo (OpenAI) | `OPENAI_API_KEY` |

Each requires a signed-in Supabase user — `_shared/auth.ts` verifies the
bearer token (the functions deploy with `verify_jwt = false` so the CORS
preflight gets through; see `supabase/config.toml`).

## Abuse guards

On top of the auth check, every function counts requests against a per-user
hourly quota (the `consume_ai_rate_limit` RPC — apply migration
`047_ai_rate_limits.sql` before deploying) and rejects oversized request
bodies; `location-chat` also caps the `messages[]` length. The mechanics live
in `_shared/limits.ts` (inlined into `import-recipe`, which is deliberately
self-contained); each function's limits are constants at the top of its
`index.ts`.

These Supabase functions are the ONLY deployment of the AI endpoints. A
parallel copy once lived in `/api` (Vercel serverless); it drifted, shipped
without any auth check, and was deleted — do not reintroduce a second copy.

## Deploy

```bash
# One-time: link the CLI to your project
supabase link --project-ref YOUR_PROJECT_REF

# Set the server-side keys (stored as Supabase secrets, never in the bundle)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... OPENAI_API_KEY=sk-...

# Apply the rate-limit migration first (SQL Editor or `supabase db push`):
#   supabase/migrations/047_ai_rate_limits.sql

# Deploy all four
supabase functions deploy location-chat
supabase functions deploy build-recipe
supabase functions deploy import-recipe
supabase functions deploy generate-recipe-image
```

## Video (Mux) functions

| Function | Purpose | Secrets used |
|----------|---------|--------------|
| `mux-upload-init` | Mint a direct-upload URL (owner-bound passthrough; signed playback policy for followers-only content) | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` (+ signing key, see below) |
| `mux-webhook` | Record playback ids as Mux transcodes (HMAC-verified, owner-checked) | `MUX_WEBHOOK_SECRET` |
| `mux-playback-token` | Mint short-lived playback tokens for signed assets after an owner/follower access check | `MUX_SIGNING_KEY_ID`, `MUX_SIGNING_PRIVATE_KEY` |
| `mux-set-visibility` | Swap an asset's playback policy when a reel/post flips public ↔ followers-only | `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` |

Followers-only reels/posts use Mux's **signed playback policy** so the media
itself is private — RLS alone only hides the DB row while the stream and
thumbnail URLs stay publicly fetchable. Signed playback needs a Mux signing
key (Mux dashboard → Settings → Signing Keys, or
`POST https://api.mux.com/system/v1/signing-keys`):

```bash
supabase secrets set MUX_SIGNING_KEY_ID=... MUX_SIGNING_PRIVATE_KEY=...
```

Until those secrets exist the functions fall back to public playback (with a
warning in the logs) so uploads never break. Rollout order: apply migrations
`047`/`048`, deploy all the functions, set the signing key, then convert
already-uploaded followers-only content with
`node scripts/mux-backfill-signed-playback.mjs --apply`.

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically — no need to
set them. Tail logs with `supabase functions logs <name>`.
