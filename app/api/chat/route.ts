import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatResult = { text?: string; error?: string };

async function askModel(url: string, key: string, model: string, prompt: string): Promise<ChatResult> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a thoughtful, accurate assistant. Answer the user's request clearly. State uncertainty rather than inventing facts." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(45000)
    });
    const data = await response.json();
    if (!response.ok) return { error: data?.error?.message || `Provider returned HTTP ${response.status}` };
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? { text: text.trim() } : { error: "Provider returned an empty response." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Provider request failed." };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return NextResponse.json({ error: "Please enter a prompt." }, { status: 400 });
    if (prompt.length > 12000) return NextResponse.json({ error: "Prompt is too long (12,000 character limit)." }, { status: 400 });

    const openaiKey = process.env.OPENAI_API_KEY;
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (!openaiKey || !deepseekKey) {
      return NextResponse.json({ error: "API keys are not configured. Add OPENAI_API_KEY and DEEPSEEK_API_KEY in Vercel → Project Settings → Environment Variables, then redeploy." }, { status: 503 });
    }

    const [openai, deepseek] = await Promise.all([
      askModel("https://api.openai.com/v1/chat/completions", openaiKey, process.env.OPENAI_MODEL || "gpt-4.1-mini", prompt),
      askModel("https://api.deepseek.com/chat/completions", deepseekKey, process.env.DEEPSEEK_MODEL || "deepseek-chat", prompt)
    ]);

    const errors: string[] = [];
    if (openai.error) errors.push(`OpenAI: ${openai.error}`);
    if (deepseek.error) errors.push(`DeepSeek: ${deepseek.error}`);
    if (!openai.text && !deepseek.text) {
      return NextResponse.json({ error: errors.join(" | ") || "Both providers failed." }, { status: 502 });
    }

    let final = "";
    const synthesizerKey = openai.text ? openaiKey : deepseekKey;
    const synthUrl = openai.text ? "https://api.openai.com/v1/chat/completions" : "https://api.deepseek.com/chat/completions";
    const synthModel = openai.text ? (process.env.OPENAI_MODEL || "gpt-4.1-mini") : (process.env.DEEPSEEK_MODEL || "deepseek-chat");
    const synthesisPrompt = [
      "Create one high-quality final answer to the user's original prompt using the two independent model responses below.",
      "Compare them, keep correct and useful insights, resolve contradictions carefully, and do not invent facts. If they disagree and evidence is insufficient, state the uncertainty. Do not mention internal orchestration.",
      "ORIGINAL USER PROMPT:", prompt,
      "OPENAI RESPONSE:", openai.text || "[Unavailable]",
      "DEEPSEEK RESPONSE:", deepseek.text || "[Unavailable]"
    ].join("\n\n");
    const synthesis = await askModel(synthUrl, synthesizerKey, synthModel, synthesisPrompt);
    if (synthesis.text) final = synthesis.text;
    else {
      errors.push(`Synthesis: ${synthesis.error || "Could not create combined answer"}`);
      final = [openai.text, deepseek.text].filter(Boolean).join("\n\n---\n\n");
    }

    return NextResponse.json({ openai: openai.text || "", deepseek: deepseek.text || "", final, errors });
  } catch {
    return NextResponse.json({ error: "Invalid request. Please try again." }, { status: 400 });
  }
}