"use client";

import { FormEvent, useState } from "react";

type Result = { openai?: string; deepseek?: string; final?: string; errors?: string[] };

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || loading) return;
    setLoading(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Request failed");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setLoading(false); }
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="#"><span className="brand-mark">✳</span> AI Duo</a>
        <span className="top-note"><i /> TWO MODELS · ONE ANSWER</span>
      </header>

      <section className="hero">
        <div className="eyebrow"><span /> INTELLIGENCE, IN PARALLEL</div>
        <h1>Two minds.<br /><em>One better answer.</em></h1>
        <p className="intro">Ask once. OpenAI and DeepSeek think independently, then combine their insights into one clear response.</p>
      </section>

      <form className="composer" onSubmit={submit}>
        <label htmlFor="prompt">YOUR PROMPT</label>
        <textarea id="prompt" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="What would you like to explore today?" rows={4} maxLength={12000} />
        <div className="composer-bottom">
          <span>{prompt.length.toLocaleString()} / 12,000</span>
          <button type="submit" disabled={loading || !prompt.trim()}>{loading ? "Thinking…" : "Ask both AIs"} <span>↗</span></button>
        </div>
      </form>

      {error && <div className="error">{error}</div>}
      {loading && <div className="loading"><span className="spinner" /> Both models are working in parallel…</div>}

      {result && <section className="results">
        <div className="section-heading"><span>01 / INDEPENDENT THINKING</span><div /></div>
        <div className="answer-grid">
          <article className="answer-card">
            <div className="card-head"><span className="model-icon openai-icon">✳</span><div><h2>OpenAI</h2><small>FIRST PERSPECTIVE</small></div></div>
            <div className="answer-body">{result.openai || "No response returned."}</div>
          </article>
          <article className="answer-card">
            <div className="card-head"><span className="model-icon deep-icon">◈</span><div><h2>DeepSeek</h2><small>SECOND PERSPECTIVE</small></div></div>
            <div className="answer-body">{result.deepseek || "No response returned."}</div>
          </article>
        </div>
        {result.final && <>
          <div className="section-heading final-heading"><span>02 / THE SYNTHESIS</span><div /></div>
          <article className="final-card"><div className="final-label"><span>✦</span> COMBINED ANSWER</div><div className="answer-body">{result.final}</div></article>
        </>}
        {result.errors?.length ? <div className="error">{result.errors.join(" · ")}</div> : null}
      </section>}

      <footer><span>AI DUO</span><span>Independent answers. Combined perspective.</span><span>YOUR KEYS STAY SERVER-SIDE</span></footer>
    </main>
  );
}