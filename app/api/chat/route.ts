import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Provider = "groq" | "openrouter" | "cloudflare" | "cohere";
type ChatResult = { text?: string; error?: string };
type HistoryMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = "You are a thoughtful, accurate assistant. Answer naturally as one helpful AI. Use the conversation context, be concise when appropriate, and state uncertainty rather than inventing facts.";

function chatMessages(input: string) {
  return [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: input }];
}

async function askCompatible(provider: "groq" | "openrouter", input: string, key: string, model: string, timeout = 24000): Promise<ChatResult> {
  try {
    const isOpenRouter = provider === "openrouter";
    const response = await fetch(isOpenRouter ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        ...(isOpenRouter ? { "HTTP-Referer": "https://ai-duo-chat.vercel.app", "X-Title": "AI Duo Chat" } : {})
      },
      body: JSON.stringify({ model, messages: chatMessages(input), temperature: 0.5 }),
      signal: AbortSignal.timeout(timeout)
    });
    const data = await response.json();
    if (!response.ok) return { error: data?.error?.message || `${provider} returned HTTP ${response.status}` };
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? { text: text.trim() } : { error: `${provider} returned an empty response.` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : `${provider} request failed.` };
  }
}

async function askCloudflare(input: string, accountId: string, token: string, model: string, timeout = 24000): Promise<ChatResult> {
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${encodeURIComponent(model)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messages: chatMessages(input), max_tokens: 1200 }),
      signal: AbortSignal.timeout(timeout)
    });
    const data = await response.json();
    if (!response.ok || data?.success === false) {
      const detail = data?.errors?.map((e: { message?: string }) => e.message).filter(Boolean).join("; ");
      return { error: detail || `Cloudflare AI returned HTTP ${response.status}` };
    }
    const text = data?.result?.response || data?.result?.output_text;
    return typeof text === "string" && text.trim() ? { text: text.trim() } : { error: "Cloudflare AI returned an empty response." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Cloudflare AI request failed." };
  }
}

async function askCohere(input: string, key: string, model: string, timeout = 24000): Promise<ChatResult> {
  try {
    const response = await fetch("https://api.cohere.com/v2/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages: chatMessages(input), temperature: 0.5 }),
      signal: AbortSignal.timeout(timeout)
    });
    const data = await response.json();
    if (!response.ok) return { error: data?.message || `Cohere returned HTTP ${response.status}` };
    const text = Array.isArray(data?.message?.content)
      ? data.message.content.filter((part: { type?: string; text?: string }) => part.type === "text" && typeof part.text === "string").map((part: { text?: string }) => part.text || "").join("\n").trim()
      : "";
    return text ? { text } : { error: "Cohere returned an empty response." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Cohere request failed." };
  }
}

function buildConversation(prompt: string, history: HistoryMessage[]) {
  const context = history.slice(-10).map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n\n");
  return `${context ? `CONVERSATION SO FAR:\n${context}\n\n` : ""}USER'S NEW MESSAGE:\n${prompt}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return NextResponse.json({ error: "Please enter a message." }, { status: 400 });
    if (prompt.length > 12000) return NextResponse.json({ error: "Message is too long (12,000 character limit)." }, { status: 400 });

    const validProviders: Provider[] = ["groq", "openrouter", "cloudflare", "cohere"];
    const requested: Provider[] = Array.isArray(body.enabledProviders)
      ? body.enabledProviders.filter((p: unknown): p is Provider => validProviders.includes(p as Provider))
      : ["groq"];
    const providers = [...new Set(requested)];
    if (providers.length === 0) return NextResponse.json({ error: "Turn on at least one AI first." }, { status: 400 });

    const history: HistoryMessage[] = Array.isArray(body.history)
      ? body.history.slice(-10).filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
          .map((m: HistoryMessage) => ({ role: m.role, content: m.content.slice(0, 12000) }))
      : [];
    const conversation = buildConversation(prompt, history);

    const config: Record<Provider, { ready: boolean; missing: string }> = {
      groq: { ready: Boolean(process.env.GROQ_API_KEY), missing: "GROQ_API_KEY" },
      openrouter: { ready: Boolean(process.env.OPENROUTER_API_KEY), missing: "OPENROUTER_API_KEY" },
      cloudflare: { ready: Boolean(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_API_TOKEN), missing: "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN" },
      cohere: { ready: Boolean(process.env.COHERE_API_KEY), missing: "COHERE_API_KEY" }
    };
    const missing = providers.filter((provider) => !config[provider].ready);
    if (missing.length === providers.length) {
      return NextResponse.json({ error: `Configure selected provider keys in Vercel: ${missing.map((provider) => config[provider].missing).join(", ")}.` }, { status: 503 });
    }

    const tasks = providers.map(async (provider) => {
      if (!config[provider].ready) return [provider, { error: `Missing ${config[provider].missing}` }] as const;
      if (provider === "groq") return [provider, await askCompatible("groq", conversation, process.env.GROQ_API_KEY!, process.env.GROQ_MODEL || "openai/gpt-oss-20b")] as const;
      if (provider === "openrouter") return [provider, await askCompatible("openrouter", conversation, process.env.OPENROUTER_API_KEY!, process.env.OPENROUTER_MODEL || "openrouter/free")] as const;
      if (provider === "cloudflare") return [provider, await askCloudflare(conversation, process.env.CLOUDFLARE_ACCOUNT_ID!, process.env.CLOUDFLARE_API_TOKEN!, process.env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.1-8b-instruct")] as const;
      return [provider, await askCohere(conversation, process.env.COHERE_API_KEY!, process.env.COHERE_MODEL || "command-r7b-12-2024")] as const;
    });

    const results = Object.fromEntries(await Promise.all(tasks)) as Partial<Record<Provider, ChatResult>>;
    const available = providers.map((provider) => results[provider]?.text).filter((value): value is string => Boolean(value));
    const labels: Record<Provider, string> = { groq: "Groq", openrouter: "OpenRouter", cloudflare: "Cloudflare AI", cohere: "Cohere" };
    const errors = providers.map((provider) => results[provider]?.error ? `${labels[provider]}: ${results[provider]?.error}` : "").filter(Boolean);
    if (available.length === 0) return NextResponse.json({ error: errors.join(" | ") || "The selected AIs couldn't respond." }, { status: 502 });

    let final = available[0];
    if (available.length > 1) {
      const synthesisPrompt = [
        "You are the answer composer in a multi-model assistant. The user should experience you as one helpful AI.",
        "Compare the independent drafts below. Keep accurate and useful points, remove repetition, resolve contradictions carefully, and produce one natural, complete answer. Do not mention models, providers, or that answers were combined.",
        "ORIGINAL USER MESSAGE:", prompt,
        ...available.map((draft, index) => `DRAFT ${index + 1}:\n${draft}`)
      ].join("\n\n");
      const synthesizers = providers.filter((provider) => config[provider].ready);
      let synthesis: ChatResult = {};
      for (const provider of synthesizers) {
        if (provider === "groq") synthesis = await askCompatible("groq", synthesisPrompt, process.env.GROQ_API_KEY!, process.env.GROQ_MODEL || "openai/gpt-oss-20b", 14000);
        else if (provider === "openrouter") synthesis = await askCompatible("openrouter", synthesisPrompt, process.env.OPENROUTER_API_KEY!, process.env.OPENROUTER_MODEL || "openrouter/free", 14000);
        else if (provider === "cloudflare") synthesis = await askCloudflare(synthesisPrompt, process.env.CLOUDFLARE_ACCOUNT_ID!, process.env.CLOUDFLARE_API_TOKEN!, process.env.CLOUDFLARE_MODEL || "@cf/meta/llama-3.1-8b-instruct", 14000);
        else synthesis = await askCohere(synthesisPrompt, process.env.COHERE_API_KEY!, process.env.COHERE_MODEL || "command-r7b-12-2024", 14000);
        if (synthesis.text) break;
      }
      if (synthesis.text) final = synthesis.text;
      else errors.push("Synthesis: Could not combine drafts; showing the best available response.");
    }

    return NextResponse.json({ final, errors });
  } catch {
    return NextResponse.json({ error: "Invalid request. Please try again." }, { status: 400 });
  }
}
