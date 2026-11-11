"use client";

import { FormEvent, DragEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

type Provider = { id: string; name: string; model: string; enabled: boolean; accent: "blue" | "purple" };
type Message = { role: "user" | "assistant"; content: string };
type StoredFile = { name: string; id: string; metadata?: { size?: number; mimetype?: string; lastModified?: string } | null; created_at?: string | null };

const initialModels: Provider[] = [
  { id: "groq", name: "Astra Core", model: "GPT-OSS 20B · Groq", enabled: true, accent: "blue" },
  { id: "openrouter", name: "Nova Reasoner", model: "Free model routing · OpenRouter", enabled: true, accent: "purple" },
];

function formatBytes(bytes = 0) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function safeName(name: string) {
  return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(-100) || "file";
}

export default function Home() {
  const [models, setModels] = useState(initialModels);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"chat" | "files">("chat");
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const supabase = getSupabase();
  const activeModels = models.filter((model) => model.enabled);

  useEffect(() => {
    fetch("/api/chat").then((response) => response.json()).then((data) => {
      if (Array.isArray(data.models) && data.models.length) setModels(data.models.map((model: Provider) => ({ ...model, enabled: true })));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    if (activeTab === "files" && user) void loadFiles();
  }, [activeTab, user?.id]);

  function toggleModel(id: string) {
    setModels((current) => current.map((model) => model.id === id ? { ...model, enabled: !model.enabled } : model));
  }

  function newChat() {
    setMessages([]);
    setPrompt("");
    setError("");
    setActiveTab("chat");
    setMobileOpen(false);
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || loading) return;
    if (activeModels.length === 0) { setError("Turn on at least one AI to start chatting."); return; }
    const history = messages.slice(-10);
    setMessages((current) => [...current, { role: "user", content: text }]);
    setPrompt("");
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, history, enabledProviders: activeModels.map((model) => model.id) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Couldn't get a response. Please try again.");
      setMessages((current) => [...current, { role: "assistant", content: data.final || "I couldn't form a response. Please try again." }]);
      if (data.errors?.length) setError(data.errors.join(" · "));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally { setLoading(false); }
  }

  async function sendMagicLink(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !email.trim()) return;
    setAuthBusy(true);
    setAuthMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setAuthMessage(error ? error.message : "Check your inbox for the secure sign-in link.");
    setAuthBusy(false);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setFiles([]);
  }

  async function loadFiles() {
    if (!supabase || !user) return;
    setFilesLoading(true);
    setFileError("");
    const { data, error } = await supabase.storage.from("user-files").list(user.id, {
      limit: 100, sortBy: { column: "created_at", order: "desc" },
    });
    if (error) setFileError(error.message);
    else setFiles((data || []).filter((item) => item.id).map((item) => ({ ...item, id: item.id!, name: item.name })));
    setFilesLoading(false);
  }

  async function uploadFiles(selected: FileList | File[]) {
    if (!supabase || !user || uploading) return;
    const queue = Array.from(selected);
    if (!queue.length) return;
    setFileError("");
    setUploading(true);
    setUploadProgress(0);
    let completed = 0;
    for (const file of queue) {
      if (file.size > 50 * 1024 * 1024) {
        setFileError(file.name + " is larger than the 50 MB limit.");
        continue;
      }
      const path = user.id + "/" + crypto.randomUUID() + "-" + safeName(file.name);
      const { error } = await supabase.storage.from("user-files").upload(path, file, {
        upsert: false, contentType: file.type || "application/octet-stream",
      });
      if (error) setFileError((current) => current ? current + " · " + error.message : error.message);
      completed += 1;
      setUploadProgress(Math.round((completed / queue.length) * 100));
    }
    setUploading(false);
    await loadFiles();
    if (fileInput.current) fileInput.current.value = "";
  }

  async function deleteFile(name: string) {
    if (!supabase || !user) return;
    const { error } = await supabase.storage.from("user-files").remove([user.id + "/" + name]);
    if (error) setFileError(error.message);
    else setFiles((current) => current.filter((file) => file.name !== name));
  }

  async function downloadFile(name: string) {
    if (!supabase || !user) return;
    const { data, error } = await supabase.storage.from("user-files").download(user.id + "/" + name);
    if (error) { setFileError(error.message); return; }
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url; link.download = name; link.click();
    URL.revokeObjectURL(url);
  }

  async function previewFile(name: string) {
    if (!supabase || !user) return;
    const { data, error } = await supabase.storage.from("user-files").createSignedUrl(user.id + "/" + name, 60);
    if (error) { setFileError(error.message); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
  }

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <a className="brand" href="#" onClick={(e) => { e.preventDefault(); newChat(); }}>
            <span className="brand-symbol"><i /><i /><i /><i /></span><span>AI <b>Duo</b></span>
          </a>
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close sidebar">×</button>
        </div>
        <button className="new-chat" onClick={newChat}><span>＋</span> New conversation <kbd>⌘ K</kbd></button>

        <div className="nav-label">WORKSPACE</div>
        <nav className="side-nav">
          <button className={activeTab === "chat" ? "nav-item selected" : "nav-item"} onClick={() => { setActiveTab("chat"); setMobileOpen(false); }}>
            <span className="nav-icon">▤</span> Chat <span className="nav-arrow">›</span>
          </button>
          <button className={activeTab === "files" ? "nav-item selected" : "nav-item"} onClick={() => { setActiveTab("files"); setMobileOpen(false); }}>
            <span className="nav-icon">▧</span> My files <span className="nav-count">{files.length}</span>
          </button>
        </nav>

        <div className="nav-label team-label">YOUR AI TEAM <span>{activeModels.length}/{models.length} ON</span></div>
        <div className="model-list">
          {models.map((model) => (
            <div className={`model-card ${model.enabled ? "model-on" : ""}`} key={model.id}>
              <div className={`model-icon ${model.accent}`}>{model.id === "openrouter" ? "◉" : "✧"}</div>
              <div className="model-meta"><strong>{model.name}</strong><small>{model.model}</small></div>
              <button className={`switch ${model.enabled ? "switch-on" : ""}`} role="switch" aria-checked={model.enabled} aria-label={`Toggle ${model.name}`} onClick={() => toggleModel(model.id)}><i /></button>
            </div>
          ))}
        </div>
        <div className="team-note">Switch models on or off anytime. Your selected AIs collaborate on one answer.</div>
        <div className="sidebar-spacer" />
        <div className="model-registry"><span className="registry-icon">＋</span><div><b>Model registry</b><small>Ready for more AI providers</small></div><span className="registry-status">EXTENDABLE</span></div>
        <div className="sidebar-footer"><span className="footer-avatar">H</span><div><b>BFHades</b><small>Workspace owner</small></div><span className="footer-dots">···</span></div>
      </aside>

      {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}

      <section className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button className="menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu">☰</button>
            <div className="breadcrumb">Workspace <span>/</span> <b>{activeTab === "chat" ? "Chat" : "My files"}</b></div>
          </div>
          <div className="topbar-right">
            <span className="secure-pill"><i /> Private workspace</span>
            {user ? <button className="account-chip" onClick={signOut}><span>{(user.email || "U").slice(0,1).toUpperCase()}</span><b>{user.email || "Signed in"}</b><small>Sign out</small></button> : <span className="guest-chip">Guest session</span>}
          </div>
        </header>

        {activeTab === "chat" ? (
          <>
            <div className={`conversation ${messages.length === 0 ? "conversation-empty" : ""}`}>
              {messages.length === 0 ? (
                <div className="welcome">
                  <div className="welcome-eyebrow"><span className="eyebrow-line" /> THE AI WORKSPACE <span className="eyebrow-line" /></div>
                  <div className="welcome-orb"><span>✳</span><i /><b /></div>
                  <h1>Think beyond<br /><em>one perspective.</em></h1>
                  <p>One message, two powerful AI minds. Ask your question and let your AI team shape one clear, considered answer.</p>
                  <div className="welcome-models">
                    <span className="welcome-model blue-dot">Astra Core</span><span className="plus-dot">+</span><span className="welcome-model purple-dot">Nova Reasoner</span>
                  </div>
                  <div className="suggestions">
                    {["Explain a difficult concept", "Help me plan a project", "Review an idea and find gaps"].map((item, i) => (
                      <button key={item} onClick={() => setPrompt(item)}><span className="suggestion-icon">{["✧","⌘","◈"][i]}</span><span>{item}</span><b>↗</b></button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="message-list">
                  {messages.map((message, index) => (
                    <article className={`message message-${message.role}`} key={index}>
                      {message.role === "assistant" && <div className="assistant-avatar">✳</div>}
                      <div className="message-content">
                        {message.role === "assistant" && <div className="message-author">AI DUO <span>·</span> UNIFIED RESPONSE</div>}
                        <div className="message-text">{message.content}</div>
                      </div>
                    </article>
                  ))}
                  {loading && <div className="thinking-row"><div className="assistant-avatar">✳</div><div><div className="message-author">AI DUO IS THINKING</div><div className="thinking-dots"><i /><i /><i /><span>Combining perspectives…</span></div></div></div>}
                  <div ref={endRef} />
                </div>
              )}
            </div>
            <div className="composer-wrap">
              {error && <div className="inline-error">{error}</div>}
              <form className="chat-composer" onSubmit={submit}>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask your AI team anything…" rows={1} maxLength={12000} disabled={loading} aria-label="Write your message" />
                <div className="composer-bottom">
                  <div className="composer-hints"><span className="hint-pill">✧ {activeModels.length} models active</span><span>Enter to send · Shift + Enter for a new line</span></div>
                  <button type="submit" disabled={loading || !prompt.trim() || activeModels.length === 0} aria-label="Send message">{loading ? <span className="send-spinner" /> : "↑"}</button>
                </div>
              </form>
              <div className="disclaimer">AI can make mistakes. Verify important information before relying on it.</div>
            </div>
          </>
        ) : (
          <div className="files-page">
            <div className="files-heading"><div><div className="page-eyebrow">YOUR PERSONAL LIBRARY</div><h1>My files</h1><p>Keep your documents and resources in one private place.</p></div><span className="storage-badge"><i /> SUPABASE STORAGE</span></div>
            {!supabase ? <div className="notice-card">Supabase is not configured. Add the project URL and publishable key to your environment variables.</div> :
             !authReady ? <div className="notice-card">Loading secure file workspace…</div> :
             !user ? (
              <div className="auth-card">
                <div className="auth-icon">⌑</div><h2>Sign in to your file space</h2><p>Your files are private. Sign in with an email link to upload, preview, download and manage your files securely.</p>
                <form onSubmit={sendMagicLink}><label htmlFor="email">EMAIL ADDRESS</label><input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" /><button disabled={authBusy}>{authBusy ? "Sending link…" : "Send secure sign-in link →"}</button></form>
                {authMessage && <div className={authMessage.startsWith("Check") ? "auth-success" : "auth-error"}>{authMessage}</div>}
                <small>Files are stored in a private bucket and protected by per-user access rules.</small>
              </div>
             ) : (
              <>
                <div className={`dropzone ${dragging ? "dropzone-active" : ""} ${uploading ? "dropzone-uploading" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                  onClick={() => !uploading && fileInput.current?.click()}>
                  <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && void uploadFiles(e.target.files)} />
                  <div className="upload-symbol">⇧</div><h2>{uploading ? "Uploading your files…" : "Drop files here to upload"}</h2>
                  <p>or <button type="button" onClick={(e) => { e.stopPropagation(); fileInput.current?.click(); }}>browse from your device</button></p>
                  <small>Any file type · Up to 50 MB per file</small>
                  {uploading && <div className="progress-track"><i style={{ width: uploadProgress + "%" }} /></div>}
                </div>
                {fileError && <div className="inline-error file-error">{fileError}</div>}
                <div className="files-list-header"><div><h2>Uploaded files</h2><span>{files.length} items · private to your account</span></div><button onClick={() => void loadFiles()}>↻ Refresh</button></div>
                <div className="file-list">
                  {filesLoading ? <div className="file-empty">Loading files…</div> : files.length === 0 ? <div className="file-empty"><span>▧</span><b>No files yet</b><small>Files you upload will appear here.</small></div> :
                    files.map((file) => (
                      <div className="file-row" key={file.id}>
                        <div className="file-type">{file.name.split(".").pop()?.slice(0,4).toUpperCase() || "FILE"}</div>
                        <div className="file-meta"><b>{file.name}</b><small>{formatBytes(file.metadata?.size)} · {file.created_at ? new Date(file.created_at).toLocaleDateString() : "Stored securely"}</small></div>
                        <div className="file-actions"><button onClick={() => void previewFile(file.name)} title="Preview">↗</button><button onClick={() => void downloadFile(file.name)} title="Download">↓</button><button className="delete-action" onClick={() => void deleteFile(file.name)} title="Delete">×</button></div>
                      </div>
                    ))}
                </div>
              </>
             )}
          </div>
        )}
      </section>
    </main>
  );
}
