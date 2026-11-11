# AI Duo

A Next.js app that sends one prompt to Google Gemini and Groq in parallel, displays both independent responses, then synthesizes a combined answer.

## Setup

1. Install dependencies: `npm install`
2. Copy `.env.example` to `.env.local`
3. Add API keys:
   - `GEMINI_API_KEY` from https://aistudio.google.com/apikey
   - `GROQ_API_KEY` from https://console.groq.com/keys
4. Optional model overrides: `GEMINI_MODEL` (default `gemini-2.5-flash`) and `GROQ_MODEL` (default `openai/gpt-oss-20b`)
5. Run: `npm run dev`

## Vercel

Add `GEMINI_API_KEY` and `GROQ_API_KEY` under Project Settings → Environment Variables for Production, Preview, and Development, then redeploy.

**Free tier note:** Both providers enforce model-specific quotas and rate limits. Free access is not unlimited and may change. The app does not automatically switch to paid usage.

**Security:** Never commit API keys or expose them in browser code. Keep them in server-side environment variables only.

## How it works

- Gemini and Groq are called concurrently from a server-side route.
- Their answers are returned separately for comparison.
- Gemini synthesizes the combined answer; if Gemini's first response fails, Groq does the synthesis.
- If synthesis fails, the app falls back to the available independent answer(s).
