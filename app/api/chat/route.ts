import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatResult = { text?: string; error?: string };

async function askGroq(prompt: string, key: string, model: string): Promise<ChatResult> {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a thoughtful, accurate assistant. Answer clearly and state uncertainty rather than inventing facts." },
          { role: "user", content: prompt }
        ],
        temperature: 0.7
      }),
      signal: AbortSignal.timeout(45000)
    });
    const data = await response.json();
    if (!response.ok) return { error: data?.error?.message || `Groq returned HTTP ${response.status}` };
    const text = data?.choices?.[0]?.message?.content;
    return typeof text === "string" && text.trim() ? { text: text.trim() } : { error: "Groq returned an empty response." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Groq request failed." };
  }
}

async function askGemini(prompt: string, key: string, model: string): Promise<ChatResult> {
  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
        "Api-Revision": "2026-05-20"
      },
      body: JSON.stringify({
        model,
        input: [
          "You are a thoughtful, accurate assistant. Answer clearly and state uncertainty rather than inventing facts.",
          "",
          prompt
        ].join("\n")
      }),
      signal: AbortSignal.timeout(45000)
    });
    const data = await response.json();
    if (!response.ok) return { error: data?.error?.message || `Gemini returned HTTP ${response.status}` };

    const outputText = typeof data?.output_text === "string" ? data.output_text : "";
    const stepText = Array.isArray(data?.steps)
      ? data.steps
          .filter((step: { type?: string }) => step.type === "model_output")
          .flatMap((step: { content?: Array<{ type?: string; text?: string }> }) => step.content || [])
          .filter((part: { type?: string }) => part.type === "text")
          .map((part: { text?: string }) => part.text || "")
          .join("")
      : "";
    const text = (outputText || stepText).trim();
    return text ? { text } : { error: "Gemini returned an empty response." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Gemini request failed." };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
    if (!prompt) return NextResponse.json({ error: "Please enter a prompt." }, { status: 400 });
    if (prompt.length > 12000) return NextResponse.json({ error: "Prompt is too long (12,000 character limit)." }, { status: 400 });

    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;
    if (!geminiKey || !groqKey) {
      return NextResponse.json({ error: "Free API keys are not configured. Add GEMINI_API_KEY and GROQ_API_KEY in Vercel → Project Settings → Environment Variables, then redeploy." }, { status: 503 });
    }

    const [gemini, groq] = await Promise.all([
      askGemini(prompt, geminiKey, process.env.GEMINI_MODEL || "gemini-3.8-flash"),
      askGroq(prompt, groqKey, process.env.GROQ_MODEL || "openai/gpt-oss-20b")
    ]);

    const errors: string[] = [];
    if (gemini.error) errors.push(`Gemini: ${gemini.error}`);
    if (groq.error) errors.push(`Groq: ${groq.error}`);
    if (!gemini.text && !groq.text) {
      return NextResponse.json({ error: errors.join(" | ") || "Both providers failed." }, { status: 502 });
    }

    const synthesizerPrompt = [
      "Create one high-quality final answer to the user's original prompt using the two independent model responses below.",
      "Compare them, keep correct and useful insights, resolve contradictions carefully, and do not invent facts. If they disagree and evidence is insufficient, state the uncertainty. Do not mention internal orchestration.",
      "ORIGINAL USER PROMPT:", prompt,
      "GEMINI RESPONSE:", gemini.text || "[Unavailable]",
      "GROQ RESPONSE:", groq.text || "[Unavailable]"
    ].join("\n\n");

    const synthesis = gemini.text
      ? await askGemini(synthesizerPrompt, geminiKey, process.env.GEMINI_MODEL || "gemini-3.8-flash")
      : await askGroq(synthesizerPrompt, groqKey, process.env.GROQ_MODEL || "openai/gpt-oss-20b");

    let final = synthesis.text || [gemini.text, groq.text].filter(Boolean).join("\n\n---\n\n");
    if (synthesis.error) errors.push(`Synthesis: ${synthesis.error}`);

    return NextResponse.json({ gemini: gemini.text || "", groq: groq.text || "", final, errors });
  } catch {
    return NextResponse.json({ error: "Invalid request. Please try again." }, { status: 400 });
  }
}