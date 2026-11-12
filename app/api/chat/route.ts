import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;


type ProviderConfig = {
  id: string;
  name: string;
  model: string;
  baseUrl: string;
  apiKeyEnv: string;
  accent?: "blue" | "purple";
};
type ChatResult = { text?: string; error?: string };
type HistoryMessage = { role: "user" | "assistant"; content: string };

const DEFAULT_PROVIDERS: ProviderConfig[] = [
  { id: "groq", name: "Astra Core", model: process.env.GROQ_MODEL || "qwen/qwen3.8-27b", baseUrl: "https://api.groq.com/openai/v1/chat/completions", apiKeyEnv: "GROQ_API_KEY", accent: "blue" },
  { id: "openrouter", name: "Nova Reasoner", model: process.env.OPENROUTER_MODEL || "openrouter/free", baseUrl: "https://openrouter.ai/api/v1/chat/completions", apiKeyEnv: "OPENROUTER_API_KEY", accent: "purple" },
  { id: "claude", name: "Agnes Free", model: process.env.NARAROUTER_MODEL || "agnes-2.5-flash", baseUrl: "https://router.bynara.id/v1/chat/completions", apiKeyEnv: "NARAROUTER_API_KEY", accent: "purple" },
  { id: "cloudflare", name: "Cloudflare Workers AI", model: process.env.CLOUDFLARE_MODEL || "@cf/qwen/qwen3.8-27b", baseUrl: `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID || "missing"}/ai/v1/chat/completions`, apiKeyEnv: "CLOUDFLARE_API_TOKEN", accent: "blue" },
];

const SYSTEM_PROMPT = [
  "You are AI Duo, one unified AI assistant created by Hades, the BFHades YouTuber.",
  "If asked who you are, who created you, or who made you, answer exactly: I am an AI assistant created by Hades, the BFHades YouTuber.",
  "Answer naturally as one helpful AI. Use the conversation context, be clear and accurate, concise when appropriate, and state uncertainty rather than inventing facts.",
].join(" ");

function getProviders(): ProviderConfig[] {
  const raw = process.env.AI_PROVIDERS_JSON;
  if (!raw) return DEFAULT_PROVIDERS;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PROVIDERS;
    const configured = parsed.filter((item): item is ProviderConfig =>
      item && typeof item.id === "string" && /^[a-z0-9_-]{1,40}$/i.test(item.id) &&
      typeof item.name === "string" && typeof item.model === "string" &&
      typeof item.baseUrl === "string" && item.baseUrl.startsWith("https://") &&
      typeof item.apiKeyEnv === "string" && /^[A-Z0-9_]{3,80}$/.test(item.apiKeyEnv)
    );
    return configured.length ? configured.slice(0, 12) : DEFAULT_PROVIDERS;
  } catch { return DEFAULT_PROVIDERS; }
}

function conversationMessages(prompt: string, history: HistoryMessage[], images: string[] = []) {
  const userContent = images.length
    ? [{ type: "text", text: prompt }, ...images.slice(0, 3).map((url) => ({ type: "image_url", image_url: { url } }))]
    : prompt;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.slice(-10).map((message) => ({ role: message.role, content: message.content.slice(0, 12000) })),
    { role: "user", content: userContent },
  ];
}

async function askCloudflareFallback(
  messages: { role: string; content: any }[],
  originalError: string,
): Promise<ChatResult | null> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) return null;

  // The configured fallback model is text-only; keep image prompts on the primary provider.
  const containsImage = messages.some((message) =>
    Array.isArray(message.content) && message.content.some((part: any) => part?.type === "image_url")
  );
  if (containsImage) return null;

  try {
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          model: process.env.CLOUDFLARE_MODEL || "@cf/qwen/qwen3.8-27b",
          messages,
          temperature: 0.5,
          max_tokens: 2048,
        }),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const fallbackError = data?.errors?.[0]?.message || data?.error?.message || "HTTP " + response.status;
      return { error: originalError + " · Cloudflare backup: " + fallbackError };
    }
    const answer = data?.choices?.[0]?.message?.content;
    return typeof answer === "string" && answer.trim()
      ? { text: answer.trim() }
      : { error: originalError + " · Cloudflare backup returned an empty response." };
  } catch (error) {
    const fallbackError = error instanceof Error ? error.message : "request failed";
    return { error: originalError + " · Cloudflare backup: " + fallbackError };
  }
}

async function askProvider(provider: ProviderConfig, messages: { role: string; content: any }[]): Promise<ChatResult> {
  if (provider.id === "cloudflare" && !process.env.CLOUDFLARE_ACCOUNT_ID) return { error: "Missing server environment variable CLOUDFLARE_ACCOUNT_ID" };
  const key = process.env[provider.apiKeyEnv];
  if (!key) {
    const missingKeyError = "Missing server environment variable " + provider.apiKeyEnv;
    if (provider.id === "groq") {
      const fallback = await askCloudflareFallback(messages, missingKeyError);
      if (fallback) return fallback;
    }
    return { error: missingKeyError };
  }
  try {
    const isOpenRouter = provider.baseUrl.includes("openrouter.ai");
    const response = await fetch(provider.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(isOpenRouter ? {
          "HTTP-Referer": "https://ai-duo-chat-mdzihadss509-1195.vercel.app",
          "X-Title": "AI Duo Chat",
        } : {}),
      },
      body: JSON.stringify({ model: provider.model, messages, temperature: 0.5 }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const providerError = data?.error?.message || provider.name + " returned HTTP " + response.status;
      if (provider.id === "groq") {
        const fallback = await askCloudflareFallback(messages, providerError);
        if (fallback) return fallback;
      }
      return { error: providerError };
    }
    const answer = data?.choices?.[0]?.message?.content;
    return typeof answer === "string" && answer.trim() ? { text: answer.trim() } : { error: provider.name + " returned an empty response." };
  } catch (error) {
    const providerError = error instanceof Error ? error.message : provider.name + " request failed.";
    if (provider.id === "groq") {
      const fallback = await askCloudflareFallback(messages, providerError);
      if (fallback) return fallback;
    }
    return { error: providerError };
  }
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const current = rateBuckets.get(ip);
  if (!current || current.resetAt <= now) { rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 }); return false; }
  current.count += 1;
  return current.count > 12;
}

export async function GET() {
  return NextResponse.json({
    models: getProviders().map(({ id, name, model, accent, apiKeyEnv }) => ({
      id,
      name,
      model: id === "groq" && process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN
        ? model + " · Cloudflare backup enabled"
        : model,
      configured: Boolean(process.env[apiKeyEnv] && (id !== "cloudflare" || process.env.CLOUDFLARE_ACCOUNT_ID)),
      accent: accent || "blue",
    })),
  });
}

export async function POST(request: Request) {
  if (isRateLimited(request)) return NextResponse.json({ error: "Too many messages. Please wait a minute and try again." }, { status: 429 });
  try {
    const body = await request.json();
    const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return NextResponse.json({ error: "Please enter a message." }, { status: 400 });
    if (prompt.length > 12000) return NextResponse.json({ error: "Message is too long (12,000 character limit)." }, { status: 400 });

    const providers = getProviders();
    const requestedIds: string[] = Array.isArray(body.enabledProviders)
      ? body.enabledProviders.filter((id: unknown): id is string => typeof id === "string")
      : [providers[0]?.id].filter(Boolean) as string[];
    const selected = providers.filter((provider) => requestedIds.includes(provider.id));
    if (!selected.length) return NextResponse.json({ error: "Turn on at least one AI first." }, { status: 400 });

    const history: HistoryMessage[] = Array.isArray(body.history)
      ? body.history.slice(-10).filter((item: unknown): item is HistoryMessage =>
          !!item && typeof item === "object" &&
          (((item as HistoryMessage).role === "user") || ((item as HistoryMessage).role === "assistant")) &&
          typeof (item as HistoryMessage).content === "string"
        ).map((item: HistoryMessage) => ({ role: item.role, content: item.content.slice(0, 12000) }))
      : [];

    const images: string[] = Array.isArray(body.images) ? body.images.filter((image: unknown): image is string => typeof image === "string" && /^data:image\/(png|jpeg|jpg|webp|gif);base64,/.test(image)).slice(0, 3) : [];
    if (images.some((image) => image.length > 12_000_000)) return NextResponse.json({ error: "Each image must be under 8 MB." }, { status: 400 });
    const messages = conversationMessages(prompt, history, images);
    const results = await Promise.all(selected.map(async (provider) => ({
      provider,
      result: await askProvider(provider, messages),
    })));
    const available = results.filter((item) => item.result.text);
    const errors = results.filter((item) => item.result.error).map((item) => item.provider.name + ": " + item.result.error);

    if (!available.length) return NextResponse.json({
      error: errors.join(" | ") || "The selected AIs couldn't respond. Please try again.",
    }, { status: 502 });

    let final = available[0].result.text!;
    if (available.length > 1) {
      const drafts = available.map((item, index) => "DRAFT " + (index + 1) + ":\n" + item.result.text).join("\n\n");
      const synthesisMessages = [
        { role: "system", content: SYSTEM_PROMPT + " You are also the answer composer. Compare independent drafts, keep accurate and useful points, remove repetition, resolve contradictions carefully, and produce one natural, complete answer. Do not mention models, providers, or that answers were combined." },
        { role: "user", content: "Original user message:\n" + prompt + "\n\n" + drafts },
      ];
      const synthesis = await askProvider(available[0].provider, synthesisMessages);
      if (synthesis.text) final = synthesis.text;
      else errors.push("Synthesis unavailable; showing the best available response.");
    }

    return NextResponse.json({ final, errors });
  } catch {
    return NextResponse.json({ error: "Invalid request. Please try again." }, { status: 400 });
  }
}
