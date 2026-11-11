# AI Duo

A Next.js app that sends one prompt to OpenAI and DeepSeek in parallel, displays both independent responses, then asks one provider to synthesize a combined answer.

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local`
3. Add fresh API keys to `.env.local`:
   - `OPENAI_API_KEY`
   - `DEEPSEEK_API_KEY`
4. Optional model overrides: `OPENAI_MODEL` (default `gpt-4.1-mini`) and `DEEPSEEK_MODEL` (default `deepseek-chat`)
5. Run: `npm run dev`

## Vercel

Import this GitHub repository into Vercel. Add both API keys under Project Settings → Environment Variables for Production, Preview, and Development, then redeploy.

**Security:** Never commit API keys or expose them in browser code. Use newly generated keys; revoke any key previously pasted into a chat or public place.

## How it works

- Both providers are called concurrently from a server-side route.
- Their answers are returned separately for comparison.
- OpenAI (or DeepSeek if OpenAI fails) synthesizes the final answer.
- If synthesis fails, the app falls back to the available independent answer(s).
