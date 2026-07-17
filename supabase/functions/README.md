# AI Edge Functions

These power the AI features and run on Supabase (Deno), called from both the
web and native apps at `<VITE_SUPABASE_URL>/functions/v1/<name>`:

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

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically — no need to
set them. Tail logs with `supabase functions logs <name>`.
