import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatResult = { text?: string; error?: string };
type Provider = "gemini" | "groq";
type HistoryMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = "You are a thoughtful, accurate assistant. Answer naturally as one helpful AI. Use the conversation context, be concise when appropriate, and state uncertainty rather than inventing facts.";

async function askGroq(input: string, key: string, model: string, timeout = 24000): Promise<ChatResult> {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input }
        ],
        temperature: 0.5
      }),
      signal: AbortSignal.timeout(timeout)
    });
    const data = await response.json();
    if (!response.ok) return { error: data?.error?.message || `Groq returned HTTP ${response.status}` };
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? { text: text.trim() } : { error: "Groq returned an empty response." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Groq request failed." };
  }
}

async function askGemini(input: string, key: string, model: string, timeout = 24000): Promise<ChatResult> {
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key, "Api-Revision": "2026-05-20" },
      body: JSON.stringify({ model, input: `${SYSTEM_PROMPT}\n\n${input}` }),
      signal: AbortSignal.timeout(timeout)
    });
    const data = await response.json();
    if (!response.ok) return { error: data?.error?.message || `Gemini returned HTTP ${response.status}` };
    const outputText = typeof data?.output_text === "string" ? data.output_text : "";
    const stepText = Array.isArray(data?.steps)
      ? data.steps.filter((step: { type?: string }) => step.type === "model_output")
          .flatMap((step: { content?: Array<{ type?: string; text?: string }> }) => step.content || [])
          .filter((part: { type?: string }) => part.type === "text")
          .map((part: { text?: string }) => part.text || "").join("")
      : "";
    const text = (outputText || stepText).trim();
    return text ? { text } : { error: "Gemini returned an empty response." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gemini request failed." };
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

    const requested: Provider[] = Array.isArray(body.enabledProviders)
      ? body.enabledProviders.filter((p: unknown): p is Provider => p === "gemini" || p === "groq")
      : ["gemini", "groq"];
    const providers = [...new Set(requested)];
    if (providers.length === 0) return NextResponse.json({ error: "Turn on at least one AI first." }, { status: 400 });

    const history: HistoryMessage[] = Array.isArray(body.history)
      ? body.history.slice(-10).filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
          .map((m: HistoryMessage) => ({ role: m.role, content: m.content.slice(0, 12000) }))
      : [];
    const conversation = buildConversation(prompt, history);
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    if (providers.includes("gemini") && !geminiKey) return NextResponse.json({ error: "Gemini API key is not configured on the server." }, { status: 503 });
    if (providers.includes("groq") && !groqKey) return NextResponse.json({ error: "Groq API key is not configured on the server." }, { status: 503 });

    const tasks = providers.map(async (provider) => {
      if (provider === "gemini") return ["gemini", await askGemini(conversation, geminiKey!, process.env.GEMINI_MODEL || "gemini-3.8-flash")] as const;
      return ["groq", await askGroq(conversation, groqKey!, process.env.GROQ_MODEL || "openai/gpt-oss-20b")] as const;
    });
    const results = Object.fromEntries(await Promise.all(tasks)) as Partial<Record<Provider, ChatResult>>;
    const available = providers.map((provider) => results[provider]?.text).filter((v): v is string => Boolean(v));
    const errors = providers.map((provider) => results[provider]?.error ? `${provider === "gemini" ? "Gemini" : "Groq"}: ${results[provider]?.error}` : "").filter(Boolean);

    if (available.length === 0) return NextResponse.json({ error: errors.join(" | ") || "The selected AIs couldn't respond." }, { status: 502 });

    let final = available[0];
    if (available.length > 1) {
      const synthesisPrompt = [
        "You are the answer composer in a multi-model assistant. The user should experience you as one helpful AI.",
        "Compare the independent drafts below. Keep accurate and useful points, remove repetition, resolve contradictions carefully, and produce one natural, complete answer. Do not mention models, providers, or that answers were combined.",
        "ORIGINAL USER MESSAGE:", prompt,
        "DRAFT A:", available[0],
        "DRAFT B:", available[1]
      ].join("\n\n");
      const synthesis = providers.includes("groq")
        ? await askGroq(synthesisPrompt, groqKey!, process.env.GROQ_MODEL || "openai/gpt-oss-20b", 18000)
        : await askGemini(synthesisPrompt, geminiKey!, process.env.GEMINI_MODEL || "gemini-3.8-flash", 18000);
      if (synthesis.text) final = synthesis.text;
      else errors.push(`Synthesis: ${synthesis.error || "Could not combine drafts; showing the best available response."}`);
    }

    return NextResponse.json({ final, errors });
  } catch {
    return NextResponse.json({ error: "Invalid request. Please try again." }, { status: 400 });
  }
}
