"use client";

import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from "react";

type Provider = "groq" | "openrouter";
type Message = { role: "user" | "assistant"; content: string };
type ModelState = { id: Provider; name: string; model: string; enabled: boolean; color: string };

const initialModels: ModelState[] = [
  { id: "groq", name: "Astra Core", model: "GPT-OSS 20B · Groq", enabled: true, color: "groq" },
  { id: "openrouter", name: "Nova Reasoner", model: "Free model routing · OpenRouter", enabled: true, color: "openrouter" },
];

export default function Home() {
  const [models, setModels] = useState(initialModels);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const activeModels = models.filter((model) => model.enabled);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  function toggleModel(id: Provider) {
    setModels((current) => current.map((model) => model.id === id ? { ...model, enabled: !model.enabled } : model));
  }

  function newChat() {
    setMessages([]);
    setPrompt("");
    setError("");
    setSidebarOpen(false);
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || loading) return;
    if (activeModels.length === 0) {
      setError("Turn on at least one AI to start chatting.");
      return;
    }

    const nextMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(nextMessages);
    setPrompt("");
    setError("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: text,
          history: messages.slice(-10),
          enabledProviders: activeModels.map((model) => model.id),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't get a response. Please try again.");
      setMessages((current) => [...current, { role: "assistant", content: data.final || "I couldn't form a response. Please try again." }]);
      if (data.errors?.length) setError(data.errors.join(" · "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <div className="sidebar-top">
          <a className="brand" href="#" onClick={newChat}><span className="brand-mark">✳</span><span>AI Duo</span></a>
          <button className="icon-button mobile-close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">×</button>
        </div>

        <button className="new-chat" onClick={newChat}><span>＋</span> New chat</button>

        <div className="sidebar-section">
          <div className="section-label">YOUR AI TEAM <span>{activeModels.length} ACTIVE</span></div>
          <div className="model-list">
            {models.map((model) => (
              <div className={`model-row ${model.enabled ? "model-enabled" : ""}`} key={model.id}>
                <div className={`model-avatar ${model.color}`}>{model.id === "openrouter" ? "◎" : "◈"}</div>
                <div className="model-meta"><strong>{model.name}</strong><small>{model.model}</small></div>
                <button
                  className={`switch ${model.enabled ? "switch-on" : ""}`}
                  role="switch"
                  aria-checked={model.enabled}
                  aria-label={`Turn ${model.enabled ? "off" : "on"} ${model.name}`}
                  onClick={() => toggleModel(model.id)}
                ><span /></button>
              </div>
            ))}
          </div>
          <p className="sidebar-hint">Choose which AIs help create your answer. You’ll always see one unified reply.</p>
        </div>

        <div className="sidebar-bottom">
          <div className="connection"><i /> Server-side AI keys · Private</div>
          <div className="sidebar-foot">AI DUO <span>PRIVATE · SERVER-SIDE KEYS</span></div>
        </div>
      </aside>

      {sidebarOpen && <button className="scrim" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />}

      <section className="chat-panel">
        <header className="chat-header">
          <div className="header-left">
            <button className="icon-button menu-button" onClick={() => setSidebarOpen(true)} aria-label="Open menu">☰</button>
            <div><strong>New conversation</strong><span>{activeModels.length} AI{activeModels.length === 1 ? "" : "s"} working together</span></div>
          </div>
          <button className="header-new" onClick={newChat}>＋ <span>New chat</span></button>
        </header>

        <div className={`conversation ${messages.length === 0 ? "conversation-empty" : ""}`}>
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-mark">✳</div>
              <div className="welcome-kicker">ONE CHAT. MULTIPLE MINDS.</div>
              <h1>What can we<br /><em>figure out together?</em></h1>
              <p>Ask anything. Your AI team will work behind the scenes and bring you one thoughtful answer.</p>
              <div className="suggestions">
                {["Explain a complex topic simply", "Help me solve a problem", "Brainstorm something creative"].map((item) => (
                  <button key={item} onClick={() => setPrompt(item)}>{item}<span>↗</span></button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {messages.map((message, index) => (
                <article className={`message message-${message.role}`} key={index}>
                  {message.role === "assistant" && <div className="assistant-avatar">✳</div>}
                  <div className="message-content">
                    {message.role === "assistant" && <div className="message-author">AI DUO <span>·</span> RESPONSE</div>}
                    <div className="message-text">{message.content}</div>
                  </div>
                </article>
              ))}
              {loading && <div className="thinking-row"><div className="assistant-avatar">✳</div><div><div className="message-author">AI DUO</div><div className="thinking-dots"><i /><i /><i /><span>Thinking</span></div></div></div>}
              <div ref={endRef} />
            </div>
          )}
        </div>

        <div className="composer-wrap">
          {error && <div className="inline-error">{error}</div>}
          <form className="chat-composer" onSubmit={submit}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder="Message AI Duo..."
              rows={1}
              maxLength={12000}
              disabled={loading}
              aria-label="Write your message"
            />
            <div className="composer-tools">
              <span>↵ Enter to send · Shift + Enter for a new line</span>
              <button type="submit" disabled={loading || !prompt.trim() || activeModels.length === 0} aria-label="Send message">{loading ? <span className="send-spinner" /> : "↑"}</button>
            </div>
          </form>
          <div className="disclaimer">AI can make mistakes. Check important information.</div>
        </div>
      </section>
    </main>
  );
}
