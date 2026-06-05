# AI Edge Functions

These power the AI features and run on Supabase (Deno), called from both the
web and native apps at `<VITE_SUPABASE_URL>/functions/v1/<name>`:

| Function | Purpose | Secret used |
|----------|---------|-------------|
| `location-chat` | Streaming AI chat (Anthropic) | `ANTHROPIC_API_KEY` |
| `build-recipe` | "Create with AI" recipe authoring (Anthropic) | `ANTHROPIC_API_KEY` |
| `generate-recipe-image` | Recipe hero photo (OpenAI) | `OPENAI_API_KEY` |

Each requires a signed-in Supabase user — `_shared/auth.ts` verifies the
bearer token (the functions deploy with `verify_jwt = false` so the CORS
preflight gets through; see `supabase/config.toml`).

## Deploy

```bash
# One-time: link the CLI to your project
supabase link --project-ref YOUR_PROJECT_REF

# Set the server-side keys (stored as Supabase secrets, never in the bundle)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-... OPENAI_API_KEY=sk-...

# Deploy all three
supabase functions deploy location-chat
supabase functions deploy build-recipe
supabase functions deploy generate-recipe-image
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically — no need to
set them. Tail logs with `supabase functions logs <name>`.
