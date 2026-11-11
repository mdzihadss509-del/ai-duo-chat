import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Provider = "groq" | "openrouter";
type ChatResult = { text?: string; error?: string };
type HistoryMessage = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT =
  "You are a thoughtful, accurate assistant. Answer naturally as one helpful AI. Use the conversation context, be concise when appropriate, and state uncertainty rather than inventing facts.";

const PROVIDER_LABELS: Record<Provider, string> = {
  groq: "Astra Core",
  openrouter: "Nova Reasoner",
};

function chatMessages(input: string) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: input },
  ];
}

async function askCompatible(
  provider: "groq" | "openrouter",
  input: string,
  key: string,
  model: string,
  timeout = 18000,
): Promise<ChatResult> {
  try {
    const isOpenRouter = provider === "openrouter";
    const response = await fetch(
      isOpenRouter
        ? "https://openrouter.ai/api/v1/chat/completions"
        : "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...(isOpenRouter
            ? {
                "HTTP-Referer": "https://ai-duo-chat-mdzihadss509-1195.vercel.app",
                "X-Title": "AI Duo Chat",
              }
            : {}),
        },
        body: JSON.stringify({
          model,
          messages: chatMessages(input),
          temperature: 0.5,
        }),
        signal: AbortSignal.timeout(timeout),
      },
    );
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        error:
          data?.error?.message ||
          `${provider} returned HTTP ${response.status}`,
      };
    }
    const answer = data?.choices?.[0]?.message?.content;
    return typeof answer === "string" && answer.trim()
      ? { text: answer.trim() }
      : { error: `${provider} returned an empty response.` };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : `${provider} request failed.`,
    };
  }
}

function buildConversation(prompt: string, history: HistoryMessage[]) {
  const context = history
    .slice(-10)
    .map(
      (message) =>
        `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`,
    )
    .join("\n\n");
  return `${context ? `CONVERSATION SO FAR:\n${context}\n\n` : ""}USER'S NEW MESSAGE:\n${prompt}`;
}

async function callProvider(
  provider: Provider,
  input: string,
): Promise<ChatResult> {
  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY;
    if (!key) return { error: "Missing GROQ_API_KEY" };
    return askCompatible(
      "groq",
      input,
      key,
      process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    );
  }
  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) return { error: "Missing OPENROUTER_API_KEY" };
    return askCompatible(
      "openrouter",
      input,
      key,
      process.env.OPENROUTER_MODEL || "openrouter/free",
    );
  }

  return { error: "Unknown AI provider." };
}

// Best-effort per-instance protection. For strict global limits, add a shared
// rate-limit store (for example Upstash Redis) or a WAF rule.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function isRateLimited(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const current = rateBuckets.get(ip);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  current.count += 1;
  return current.count > 12;
}

export async function POST(request: Request) {
  if (isRateLimited(request)) {
    return NextResponse.json(
      { error: "Too many messages. Please wait a minute and try again." },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    const prompt =
      typeof body?.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) {
      return NextResponse.json(
        { error: "Please enter a message." },
        { status: 400 },
      );
    }
    if (prompt.length > 12000) {
      return NextResponse.json(
        { error: "Message is too long (12,000 character limit)." },
        { status: 400 },
      );
    }

    const validProviders: Provider[] = ["groq", "openrouter"];
    const requested: Provider[] = Array.isArray(body.enabledProviders)
      ? body.enabledProviders.filter(
          (provider: unknown): provider is Provider =>
            typeof provider === "string" &&
            validProviders.includes(provider as Provider),
        )
      : ["groq"];
    const providers = [...new Set(requested)];
    if (providers.length === 0) {
      return NextResponse.json(
        { error: "Turn on at least one AI first." },
        { status: 400 },
      );
    }

    const history: HistoryMessage[] = Array.isArray(body.history)
      ? body.history
          .slice(-10)
          .filter(
            (message: unknown): message is HistoryMessage =>
              typeof message === "object" &&
              message !== null &&
              ((message as HistoryMessage).role === "user" ||
                (message as HistoryMessage).role === "assistant") &&
              typeof (message as HistoryMessage).content === "string",
          )
          .map((message: HistoryMessage) => ({
            role: message.role,
            content: message.content.slice(0, 12000),
          }))
      : [];

    const results = Object.fromEntries(
      await Promise.all(
        providers.map(async (provider) => [
          provider,
          await callProvider(provider, buildConversation(prompt, history)),
        ] as const),
      ),
    ) as Partial<Record<Provider, ChatResult>>;

    const available = providers
      .map((provider) => results[provider]?.text)
      .filter((answer): answer is string => Boolean(answer));
    const errors = providers
      .map((provider) =>
        results[provider]?.error
          ? `${PROVIDER_LABELS[provider]}: ${results[provider]?.error}`
          : "",
      )
      .filter(Boolean);

    if (available.length === 0) {
      return NextResponse.json(
        {
          error:
            errors.join(" | ") ||
            "The selected AIs couldn't respond. Please try again.",
        },
        { status: 502 },
      );
    }

    // One bounded synthesis attempt prevents multiple sequential model calls
    // from exhausting the Vercel function duration.
    let final = available[0];
    if (available.length > 1) {
      const synthesisPrompt = [
        "You are the answer composer in a multi-model assistant. The user should experience you as one helpful AI.",
        "Compare the independent drafts below. Keep accurate and useful points, remove repetition, resolve contradictions carefully, and produce one natural, complete answer. Do not mention models, providers, or that answers were combined.",
        "ORIGINAL USER MESSAGE:",
        prompt,
        ...available.map(
          (draft, index) => `DRAFT ${index + 1}:\n${draft}`,
        ),
      ].join("\n\n");

      const synthesisOrder: Provider[] = [
        ...(providers.includes("groq") && results.groq?.text ? ["groq" as const] : []),
        ...(providers.includes("openrouter") && results.openrouter?.text
          ? ["openrouter" as const]
          : []),
      ];
      const firstSynthesizer = synthesisOrder[0];
      if (firstSynthesizer) {
        const synthesis = await callSynthesisProvider(
          firstSynthesizer,
          synthesisPrompt,
        );
        if (synthesis.text) final = synthesis.text;
        else errors.push("Synthesis unavailable; showing the best available response.");
      }
    }

    return NextResponse.json({ final, errors });
  } catch {
    return NextResponse.json(
      { error: "Invalid request. Please try again." },
      { status: 400 },
    );
  }
}

async function callSynthesisProvider(
  provider: Provider,
  input: string,
): Promise<ChatResult> {
  if (provider === "groq") {
    const key = process.env.GROQ_API_KEY;
    return key
      ? askCompatible(
          "groq",
          input,
          key,
          process.env.GROQ_MODEL || "openai/gpt-oss-20b",
          12000,
        )
      : { error: "Missing GROQ_API_KEY" };
  }
  if (provider === "openrouter") {
    const key = process.env.OPENROUTER_API_KEY;
    return key
      ? askCompatible(
          "openrouter",
          input,
          key,
          process.env.OPENROUTER_MODEL || "openrouter/free",
          12000,
        )
      : { error: "Missing OPENROUTER_API_KEY" };
  }
  return { error: "Unknown synthesis provider." };
}
