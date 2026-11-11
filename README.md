# AI Duo Chat

A unified chat interface with selectable Groq, OpenRouter, and Cloudflare Workers AI providers. Enabled providers answer in parallel, then one provider attempts a bounded synthesis so the user sees one response.

## Local setup

1. Install Node.js (20 or newer).
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Add the provider credentials to `.env.local`:
   - `GROQ_API_KEY` — https://console.groq.com/keys
   - `OPENROUTER_API_KEY` — https://openrouter.ai/keys
5. Start the app with `npm run dev`.

## Cloudflare Workers AI

Cloudflare Workers AI is available as a third selectable provider. Configure these server-side environment variables in Vercel: `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and optionally `CLOUDFLARE_MODEL` (defaults to `@cf/meta/llama-3.1-8b-instruct`). The token must have Account > Workers AI > Read permission. Never put the token in client-side code or commit it to Git. The provider remains visibly marked as setup-required until both the account ID and token are configured.

## Optional model overrides

- `GROQ_MODEL` defaults to `openai/gpt-oss-20b`.
- `OPENROUTER_MODEL` defaults to `openrouter/free`.
- `CLOUDFLARE_MODEL` defaults to `@cf/meta/llama-3.1-8b-instruct`.

## Vercel

Add `GROQ_API_KEY` and `OPENROUTER_API_KEY` to the Production environment (and Preview/Development too if you use those environments). To enable Cloudflare, also add `CLOUDFLARE_API_TOKEN`; the account ID and model are already set in this project. Redeploy after changing environment variables so the new deployment receives them.

## Request flow and limits

- Selected providers are called concurrently.
- When multiple providers return answers, one available provider makes one bounded synthesis attempt.
- If synthesis fails, the app returns the first available provider answer.
- The API route includes a best-effort per-instance rate limit. Serverless instances do not share this in-memory counter; use a shared rate-limit store or WAF rule for strict global protection.
- Provider quotas, free model availability, and rate limits are controlled by each provider and can change.

## Security

Never commit API keys, place them in client-side code, or share them in chat. Keep all credentials in server-side environment variables. The rate limiter is a lightweight abuse deterrent, not a replacement for global edge protection.
