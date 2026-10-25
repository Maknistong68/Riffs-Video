# AI import (phase 4) — setup

The app sends the text a user pastes to one Supabase **Edge Function**, `convert-tab`, which calls
Claude and returns alphaTex + a confidence per note. The Claude API key exists **only** as a secret
of that function. The app re-parses every answer with alphaTab and validates the timeline; anything
that fails lands in Riff Review with a message — never straight to export.

## 1. Supabase project (no tables needed)
1. Create a project at supabase.com (free tier is fine).
2. Install the CLI and link this repo: `npx supabase login` → `npx supabase link --project-ref <ref>`.

## 2. Secrets (server side only)
```bash
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...            # required
npx supabase secrets set ALLOWED_ORIGINS=https://your-app.example  # your PWA origin(s), comma-separated
# optional:
npx supabase secrets set CLAUDE_MODEL=claude-opus-5-5 CLAUDE_EFFORT=medium
```

## 3. Deploy the function
```bash
npx supabase functions deploy convert-tab
```
`supabase/config.toml` keeps JWT verification on: the app calls the function with the project's
public **anon** key, so random scripts without it are refused.

## 4. Point the app at it
Copy `.env.example` to `.env` (or set the same variables in your static host's build settings):
```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```
Rebuild. `npm run build` ends with `check-bundle-secrets`, which fails the build if an API key,
the Anthropic endpoint or the function's code ever ends up in the client bundle.

## 5. Check it end to end (costs API credits)
```bash
CONVERT_TAB_URL=https://<ref>.supabase.co/functions/v1/convert-tab SUPABASE_ANON_KEY=<anon key> npm run ai:eval
```
Converts the 10 hand-checked ASCII tabs from Phase 3 through the deployed function and scores the
notes (target: mean F1 ≥ 0.9).

## How it behaves
| Situation | Where the user ends up |
|---|---|
| Good answer | Riff Review; notes the model was unsure of (< 0.7) are amber; guessed rhythm/tempo are flagged |
| Answer alphaTab can't read | Riff Review: alphaTab's line/column errors + "Fix the tab by hand", "Paste as text tab", "Try AI again" |
| Unreadable / refused / not a tab | Riff Review with the reason and the same ways on |
| Offline, rate-limited, too long, not configured | Stays on the AI import screen with the reason (nothing to review) |

Rate limit: 10 conversions per device per 10 min and 40 per IP per hour, in memory per function
instance (cost guard, not a hard quota — no database). Device ids are random, anonymous UUIDs.

Model: `claude-opus-5-5` with structured outputs (JSON schema) and server-side refusal fallback
(`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`): if the model's safety
classifiers decline a request, the API retries it on a suitable model inside the same call.
