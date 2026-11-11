"use client";

import { FormEvent, DragEvent, KeyboardEvent, useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getRememberSession, getSupabase, setRememberSession } from "@/lib/supabase";

type Provider = { id: string; name: string; model: string; enabled: boolean; accent: "blue" | "purple" };
type Attachment = { name: string; path: string; type: string; url?: string };
type Message = { id?: string; role: "user" | "assistant"; content: string; attachments?: Attachment[]; created_at?: string };
type Chat = { id: string; title: string; created_at: string; updated_at: string };
type StoredFile = { name: string; id: string; path: string; metadata?: { size?: number; mimetype?: string; lastModified?: string } | null; created_at?: string | null };

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
function extractArtifact(content: string) { const match = content.match(/\x60\x60\x60([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)\x60\x60\x60/); if (!match) return null; const lang = (match[1] || "txt").toLowerCase(); const ext = ({ javascript:"js",js:"js",typescript:"ts",ts:"ts",tsx:"tsx",jsx:"jsx",html:"html",css:"css",json:"json",python:"py",py:"py",sql:"sql",markdown:"md",md:"md",xml:"xml",svg:"svg",sh:"sh",bash:"sh" } as Record<string,string>)[lang] || "txt"; return { code: match[2], ext, lang }; }
function chatTitle(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? clean.slice(0, 42).trimEnd() + "…" : clean || "New conversation";
}

export default function Home() {
  const [models, setModels] = useState(initialModels);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"chat" | "files">("chat");
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileError, setFileError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatNotice, setChatNotice] = useState("");
  const [pendingImages, setPendingImages] = useState<{ file: File; preview: string }[]>([]);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => Promise<void> } | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const supabase = getSupabase();
  const activeModels = models.filter((model) => model.enabled);

  useEffect(() => { setRememberMe(getRememberSession()); }, []);

  useEffect(() => {
    fetch("/api/chat").then((response) => response.json()).then((data) => {
      if (Array.isArray(data.models) && data.models.length) setModels(data.models.map((model: Provider) => ({ ...model, enabled: true })));
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!supabase) { setAuthReady(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAuthMessage("Session check failed: " + error.message);
      setUser(data.session?.user ?? null);
      setAuthReady(true);
    }).catch((err) => {
      if (!active) return;
      setAuthMessage(err instanceof Error ? err.message : "Unable to check your sign-in session. Please reload.");
      setAuthReady(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setAuthReady(true);
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !user) { setChats([]); setSelectedChatId(null); setMessages([]); return; }
    let cancelled = false;
    (async () => {
      setChatBusy(true);
      const { data, error } = await supabase.from("chats").select("id,title,created_at,updated_at").order("updated_at", { ascending: false }).limit(500);
      if (!cancelled) {
        if (error) setChatNotice("Couldn't load chat history: " + error.message);
        else {
          const rows = (data || []) as Chat[];
          setChats(rows);
          if (rows.length) {
            setSelectedChatId((current) => current && rows.some((chat) => chat.id === current) ? current : rows[0].id);
          } else {
            setSelectedChatId(null);
            setMessages([]);
          }
        }
        setChatBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [supabase, user?.id]);

  useEffect(() => {
    if (!supabase || !user || !selectedChatId) { setMessages([]); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from("chat_messages").select("id,role,content,attachments,created_at").eq("chat_id", selectedChatId).order("created_at", { ascending: true });
      if (cancelled) return;
      if (error) setError("Unable to open this conversation: " + error.message);
      else { const rows = (data || []) as Message[]; const hydrated = await Promise.all(rows.map(async (row) => ({ ...row, attachments: await Promise.all((row.attachments || []).map(async (a) => { const { data: signed } = await supabase.storage.from("user-files").createSignedUrl(a.path, 3600); return { ...a, url: signed?.signedUrl }; })) }))); if (!cancelled) setMessages(hydrated); }
    })();
    return () => { cancelled = true; };
  }, [supabase, user?.id, selectedChatId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    if (activeTab === "files" && user) void loadFiles();
  }, [activeTab, user?.id]);

  useEffect(() => {
    function onShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (user && !chatBusy) void createChat();
      }
    }
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [user?.id, chatBusy]);

  function toggleModel(id: string) {
    setModels((current) => current.map((model) => model.id === id ? { ...model, enabled: !model.enabled } : model));
  }

  async function createChat() {
    if (!supabase || !user || chatBusy) return;
    setChatBusy(true); setError(""); setChatNotice("");
    const { data, error } = await supabase.from("chats").insert({ user_id: user.id, title: "New conversation" }).select("id,title,created_at,updated_at").single();
    if (error || !data) { setError("Couldn't create a conversation: " + (error?.message || "Unknown error")); setChatBusy(false); return; }
    setChats((current) => [data as Chat, ...current]);
    setSelectedChatId(data.id);
    setMessages([]);
    setPrompt("");
    setActiveTab("chat");
    setMobileOpen(false);
    setChatBusy(false);
  }

  async function openChat(chatId: string) {
    if (chatId === selectedChatId) { setActiveTab("chat"); setMobileOpen(false); return; }
    setMessages([]);
    setSelectedChatId(chatId);
    setActiveTab("chat");
    setError("");
    setPrompt("");
    setMobileOpen(false);
  }

  async function deleteChat(chatId: string) {
    if (!supabase || !user) return;
    const { data: messageRows } = await supabase.from("chat_messages").select("attachments").eq("chat_id", chatId).eq("user_id", user.id);
    const attachmentPaths = (messageRows || []).flatMap((row: any) => Array.isArray(row.attachments) ? row.attachments.map((item: Attachment) => item.path).filter(Boolean) : []);
    if (attachmentPaths.length) {
      const { error: storageError } = await supabase.storage.from("user-files").remove(attachmentPaths);
      if (storageError) { setError("Unable to remove chat attachments from Storage: " + storageError.message); return; }
    }
    const { error } = await supabase.from("chats").delete().eq("id", chatId).eq("user_id", user.id);
    if (error) { setError("Unable to delete conversation: " + error.message); return; }
    const remaining = chats.filter((chat) => chat.id !== chatId);
    setChats(remaining);
    if (selectedChatId === chatId) {
      setSelectedChatId(remaining[0]?.id || null);
      setMessages([]);
    }
    void loadFiles();
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = prompt.trim();
    const images = pendingImages;
    if ((!text && images.length === 0) || loading) return;
    if (!supabase || !user) { setError("Sign in to save your conversations."); return; }
    if (activeModels.length === 0) { setError("Turn on at least one AI to start chatting."); return; }
    setError(""); setChatNotice(""); setLoading(true); setPrompt(""); setPendingImages([]);
    let chatId = selectedChatId;
    let isNew = false;
    try {
      if (!chatId) {
        const { data, error } = await supabase.from("chats").insert({ user_id: user.id, title: chatTitle(text || "Image conversation") }).select("id,title,created_at,updated_at").single();
        if (error || !data) throw new Error("Unable to create conversation: " + (error?.message || "Unknown error"));
        chatId = data.id; isNew = true; setSelectedChatId(chatId); setChats((current) => [data as Chat, ...current]);
      }
      const uploaded: Attachment[] = [];
      const imagePayload: string[] = [];
      for (const item of images) {
        imagePayload.push(item.preview);
        const path = user.id + "/" + chatId + "/" + crypto.randomUUID() + "-" + safeName(item.file.name);
        const { error: uploadError } = await supabase.storage.from("user-files").upload(path, item.file, { upsert: false, contentType: item.file.type });
        if (uploadError) throw new Error("Image upload failed: " + uploadError.message);
        const { data: signed } = await supabase.storage.from("user-files").createSignedUrl(path, 3600);
        uploaded.push({ name: item.file.name, path, type: item.file.type, url: signed?.signedUrl });
      }
      if (uploaded.length) void loadFiles();
      const userText = text || "Please inspect the attached image(s).";
      const { error: saveUserError } = await supabase.from("chat_messages").insert({ chat_id: chatId, user_id: user.id, role: "user", content: userText, attachments: uploaded.map(({ name, path, type }) => ({ name, path, type })) });
      if (saveUserError) throw new Error("Unable to save your message: " + saveUserError.message);
      setMessages((current) => [...current, { role: "user", content: userText, attachments: uploaded }]);
      const previousHistory = messages.map(({ role, content }) => ({ role, content })).slice(-10);
      await supabase.from("chats").update({ ...(isNew ? { title: chatTitle(text || "Image conversation") } : {}), updated_at: new Date().toISOString() }).eq("id", chatId).eq("user_id", user.id);
      const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: userText, images: imagePayload, history: previousHistory, enabledProviders: activeModels.map((model) => model.id) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to get a response. Please try again.");
      const answer = data.final || "I couldn't form a response. Please try again.";
      const { error: saveAssistantError } = await supabase.from("chat_messages").insert({ chat_id: chatId, user_id: user.id, role: "assistant", content: answer, attachments: [] });
      if (saveAssistantError) throw new Error("AI answered, but saving its reply failed: " + saveAssistantError.message);
      setMessages((current) => [...current, { role: "assistant", content: answer }]);
      setChats((current) => current.map((chat) => chat.id === chatId ? { ...chat, title: isNew ? chatTitle(text || "Image conversation") : chat.title, updated_at: new Date().toISOString() } : chat).sort((a,b) => b.updated_at.localeCompare(a.updated_at)));
      if (data.errors?.length) setError(data.errors.join(" · "));
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); }
    finally { setLoading(false); }
  }

  function addImages(files: FileList | File[]) {
    const list = Array.from(files);
    const picked = list.filter((file) => file.type.startsWith("image/")).slice(0, 3);
    if (picked.length !== list.length) setError("Only image files can be attached in chat.");
    for (const file of picked) {
      if (file.size > 8 * 1024 * 1024) { setError(file.name + " is larger than the 8 MB chat-image limit."); continue; }
      const reader = new FileReader();
      reader.onload = () => setPendingImages((current) => [...current, { file, preview: String(reader.result) }]);
      reader.readAsDataURL(file);
    }
  }

  async function copyMessage(content: string) {
    try { await navigator.clipboard.writeText(content); setChatNotice("Copied message to clipboard."); }
    catch { setError("Clipboard access was blocked by your browser."); }
  }

  function downloadArtifact(content: string) {
    const artifact = extractArtifact(content);
    const body = artifact?.code || content;
    const ext = artifact?.ext || "txt";
    const blob = new Blob([body], { type: ext === "html" ? "text/html" : ext === "json" ? "application/json" : "text/plain" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "ai-duo-file." + ext; a.click(); URL.revokeObjectURL(url);
  }

  function runHtml(content: string) {
    const artifact = extractArtifact(content);
    if (!artifact || artifact.ext !== "html") return;
    setPreviewHtml(artifact.code); setPreviewOpen(true);
  }

  function onComposerKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); }
  }

  async function handleEmailAuth(e: FormEvent) {
    e.preventDefault();
    if (!supabase || !email.trim() || !password || authBusy) return;
    setAuthBusy(true);
    setAuthMessage("");
    try {
      setRememberSession(rememberMe);
      const result = authMode === "signup"
        ? await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin } })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) {
        setAuthMessage(result.error.message);
      } else if (authMode === "signup" && !result.data.session) {
        setAuthMessage("Account created. Check your email to confirm your address, then sign in.");
      } else if (result.data.session) {
        setUser(result.data.user);
        setAuthMessage("Signed in successfully.");
      } else {
        setAuthMessage("Account request completed, but no active session was returned. Check your email for confirmation.");
      }
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Sign-in failed due to a network error. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function signInWithProvider(provider: "google") {
    if (!supabase || authBusy) return;
    setAuthBusy(true); setAuthMessage("");
    try {
      setRememberSession(rememberMe);
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: "https://ai-duo-chat-eight.vercel.app/auth/callback" },
      });
      if (error) setAuthMessage(error.message);
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : "Google sign-in failed. Please try again.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function resetPassword() {
    if (!supabase || !email.trim()) { setAuthMessage("Enter your email address first."); return; }
    setAuthBusy(true); setAuthMessage("");
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setAuthMessage(error ? error.message : "Password reset link sent. Check your inbox.");
    setAuthBusy(false);
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
    setFiles([]); setChats([]); setMessages([]); setSelectedChatId(null);
  }

  async function loadFiles() {
    if (!supabase || !user) return;
    setFilesLoading(true); setFileError("");
    const collected: StoredFile[] = [];
    const walk = async (prefix: string): Promise<void> => {
      const { data, error } = await supabase.storage.from("user-files").list(prefix, { limit: 1000, sortBy: { column: "created_at", order: "desc" } });
      if (error) throw error;
      for (const item of data || []) {
        const path = prefix + "/" + item.name;
        if (item.id) collected.push({ ...item, id: item.id, name: item.name, path });
        else if (item.name && item.name !== "." && item.name !== "..") await walk(path);
      }
    };
    try {
      await walk(user.id);
      collected.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      setFiles(collected);
    } catch (err) {
      setFileError(err instanceof Error ? err.message : "Unable to load your files.");
    } finally {
      setFilesLoading(false);
    }
  }

  async function uploadFiles(selected: FileList | File[]) {
    if (!supabase || !user || uploading) return;
    const queue = Array.from(selected);
    if (!queue.length) return;
    setFileError(""); setUploading(true); setUploadProgress(0);
    let completed = 0;
    for (const file of queue) {
      if (file.size > 50 * 1024 * 1024) { setFileError(file.name + " is larger than the 50 MB limit."); completed++; setUploadProgress(Math.round((completed / queue.length) * 100)); continue; }
      const path = user.id + "/" + crypto.randomUUID() + "-" + safeName(file.name);
      const { error } = await supabase.storage.from("user-files").upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (error) setFileError((current) => current ? current + " · " + error.message : error.message);
      completed++; setUploadProgress(Math.round((completed / queue.length) * 100));
    }
    setUploading(false);
    await loadFiles();
    if (fileInput.current) fileInput.current.value = "";
  }

  async function deleteFile(path: string) {
    if (!supabase || !user || !path.startsWith(user.id + "/")) return;
    const { error } = await supabase.storage.from("user-files").remove([path]);
    if (error) { setFileError(error.message); return; }
    const { data: rows, error: rowsError } = await supabase.from("chat_messages").select("id,attachments").eq("user_id", user.id);
    if (rowsError) setFileError("File was deleted from Storage, but chat references could not be checked: " + rowsError.message);
    else if (rows) {
      for (const row of rows as Array<{id:string;attachments:Attachment[] | null}>) {
        const current = Array.isArray(row.attachments) ? row.attachments : [];
        const next = current.filter((attachment) => attachment.path !== path);
        if (next.length !== current.length) {
          const { error: updateError } = await supabase.from("chat_messages").update({ attachments: next }).eq("id", row.id).eq("user_id", user.id);
          if (updateError) setFileError("File was deleted, but one chat reference could not be cleaned: " + updateError.message);
        }
      }
    }
    setFiles((current) => current.filter((file) => file.path !== path));
    setMessages((current) => current.map((message) => ({ ...message, attachments: (message.attachments || []).filter((attachment) => attachment.path !== path) })));
  }

  function askDeleteChat(chatId: string) {
    const target = chats.find((chat) => chat.id === chatId);
    setConfirmDialog({ title: "Delete conversation?", message: `“${target?.title || "This conversation"}” and its messages will be permanently deleted. Uploaded attachments in this chat will also be removed from Storage.`, confirmLabel: "Yes, delete chat", onConfirm: () => deleteChat(chatId) });
  }

  function askDeleteFile(path: string) {
    const target = files.find((file) => file.path === path);
    setConfirmDialog({ title: "Delete this file?", message: `${target?.name || "This file"} will be permanently deleted from Supabase Storage and removed from linked chat attachments.`, confirmLabel: "Yes, delete file", onConfirm: () => deleteFile(path) });
  }

  async function downloadFile(path: string) {
    if (!supabase || !user || !path.startsWith(user.id + "/")) return;
    const { data, error } = await supabase.storage.from("user-files").download(path);
    if (error) { setFileError(error.message); return; }
    const url = URL.createObjectURL(data);
    const link = document.createElement("a"); link.href = url; link.download = path.split("/").pop() || "download"; link.click();
    URL.revokeObjectURL(url);
  }

  async function previewFile(path: string) {
    if (!supabase || !user || !path.startsWith(user.id + "/")) return;
    const { data, error } = await supabase.storage.from("user-files").createSignedUrl(path, 300);
    if (error) { setFileError(error.message); return; }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  }

  async function runUploadedHtml(path: string) {
    if (!supabase || !user || !path.startsWith(user.id + "/") || !path.toLowerCase().endsWith(".html")) return;
    const { data, error } = await supabase.storage.from("user-files").download(path);
    if (error) { setFileError("Unable to open HTML file: " + error.message); return; }
    const source = await data.text();
    setPreviewHtml(source);
    setPreviewOpen(true);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault(); setDragging(false);
    if (e.dataTransfer.files.length) void uploadFiles(e.dataTransfer.files);
  }

  if (!authReady) return <main className="auth-screen"><div className="auth-card"><div className="auth-icon">✳</div><h2>Opening your private workspace</h2><p>Checking your secure sign-in session…</p></div></main>;
  if (!supabase) return <main className="auth-screen"><div className="auth-card"><div className="auth-icon">!</div><h2>Supabase isn't configured</h2><p>Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to the Vercel project environment.</p></div></main>;
  if (!user) return (
    <main className="auth-screen">
      <div className="auth-layout">
      <section className="auth-showcase"><div className="auth-showcase-brand"><span className="brand-symbol"><i/><i/><i/><i/></span><span>AI <b>Duo</b></span></div><div className="auth-showcase-copy"><span className="auth-kicker">ONE WORKSPACE. TWO PERSPECTIVES.</span><h1>Think bigger.<br/><em>Build smarter.</em></h1><p>Bring your AI team, conversations and files together in one private workspace.</p><div className="auth-feature"><span>✦</span><div><b>Unified AI responses</b><small>Multiple AI providers, one conversation</small></div></div><div className="auth-feature"><span>◈</span><div><b>Private chat history</b><small>Your conversations stay with your account</small></div></div><div className="auth-feature"><span>▧</span><div><b>One file library</b><small>Keep uploads and generated files together</small></div></div></div><div className="auth-showcase-foot">AI DUO · PRIVATE AI WORKSPACE</div></section>
      <div className="auth-card auth-card-pro">
        <a className="brand auth-brand" href="#"><span className="brand-symbol"><i/><i/><i/><i/></span><span>AI <b>Duo</b></span></a>
        <div className="auth-icon">⌑</div>
        <h2>{authMode === "signin" ? "Welcome back" : "Create your account"}</h2>
        <p>{authMode === "signin" ? "Sign in to continue to your private AI workspace." : "Create one account to save chats, files and settings securely."}</p>
        <div className="auth-socials">
          <button type="button" disabled={authBusy} onClick={() => void signInWithProvider("google")}><span className="google-mark">G</span> Continue with Google</button>
        </div>
        <div className="auth-divider"><span>OR CONTINUE WITH EMAIL</span></div>
        <form onSubmit={handleEmailAuth}>
          <label htmlFor="email">EMAIL ADDRESS</label>
          <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          <label htmlFor="password">PASSWORD</label>
          <div className="password-field"><input id="password" type={showPassword ? "text" : "password"} autoComplete={authMode === "signin" ? "current-password" : "new-password"} minLength={authMode === "signup" ? 8 : undefined} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword((v) => !v)}>{showPassword ? "Hide" : "Show"}</button></div>
          <div className="auth-options">
            <label className="remember-option"><input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} /> Remember me</label>
            {authMode === "signin" && <button type="button" className="text-action" onClick={() => void resetPassword()} disabled={authBusy}>Forgot password?</button>}
          </div>
          <button className="auth-submit" type="submit" disabled={authBusy}>{authBusy ? "Please wait…" : authMode === "signin" ? "Sign in →" : "Create account →"}</button>
        </form>
        {authMessage && <div className={/successfully|check your email|link sent/i.test(authMessage) ? "auth-success" : "auth-error"}>{authMessage}</div>}
        <div className="auth-switch">{authMode === "signin" ? "New to AI Duo?" : "Already have an account?"} <button type="button" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthMessage(""); }}> {authMode === "signin" ? "Create account" : "Sign in"}</button></div>
        <small>Your chats and files are private to your signed-in account. Your session {rememberMe ? "will stay active on this device" : "will end when this browser session closes"}.</small>
      </div>
      </div>
    </main>
  );

  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <a className="brand" href="#" onClick={(e) => { e.preventDefault(); void createChat(); }}><span className="brand-symbol"><i /><i /><i /><i /></span><span>AI <b>Duo</b></span></a>
          <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close sidebar">×</button>
        </div>
        <button className="new-chat" onClick={() => void createChat()} disabled={chatBusy}><span>＋</span> New conversation <kbd>⌘ K</kbd></button>
        <div className="nav-label">WORKSPACE</div>
        <nav className="side-nav">
          <button className={activeTab === "chat" ? "nav-item selected" : "nav-item"} onClick={() => { setActiveTab("chat"); setMobileOpen(false); }}><span className="nav-icon">▤</span> Chat <span className="nav-arrow">›</span></button>
          <button className={activeTab === "files" ? "nav-item selected" : "nav-item"} onClick={() => { setActiveTab("files"); setMobileOpen(false); }}><span className="nav-icon">▧</span> My files <span className="nav-count">{files.length}</span></button>
        </nav>
        <div className="nav-label history-label">CHAT HISTORY <span>{chats.length}</span></div>
        <div className="chat-history">
          {chatBusy && chats.length === 0 ? <div className="history-empty">Loading conversations…</div> : chats.length === 0 ? <div className="history-empty">Your saved chats will appear here.</div> : chats.map((chat) => (
            <div className={`history-item ${selectedChatId === chat.id && activeTab === "chat" ? "history-active" : ""}`} key={chat.id}>
              <button className="history-open" onClick={() => void openChat(chat.id)} title={chat.title}><span>◷</span><b>{chat.title}</b></button>
              <button className="history-delete" onClick={() => askDeleteChat(chat.id)} title="Delete conversation" aria-label={`Delete ${chat.title}`}>×</button>
            </div>
          ))}
        </div>
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
        <div className="model-registry"><span className="registry-icon">＋</span><div><b>Model registry</b><small>More providers can be configured securely</small></div><span className="registry-status">EXTENDABLE</span></div>
        <div className="sidebar-footer"><span className="footer-avatar">H</span><div><b>{user.email || "BFHades"}</b><small>Private workspace</small></div><button className="footer-signout" onClick={() => void signOut()}>Sign out</button></div>
      </aside>
      {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Close menu" />}
      <section className="main-panel">
        <header className="topbar">
          <div className="topbar-left"><button className="menu-button" onClick={() => setMobileOpen(true)} aria-label="Open menu">☰</button><div className="breadcrumb">Workspace <span>/</span> <b>{activeTab === "chat" ? "Chat" : "My files"}</b></div></div>
          <div className="topbar-right"><span className="secure-pill"><i /> Private workspace</span><button className="account-chip" onClick={() => void signOut()}><span>{(user.email || "U").slice(0,1).toUpperCase()}</span><b>{user.email || "Signed in"}</b><small>Sign out</small></button></div>
        </header>

        {activeTab === "chat" ? (
          <>
            <div className={`conversation ${messages.length === 0 ? "conversation-empty" : ""}`}>
              {chatNotice && <div className="inline-error">{chatNotice}</div>}
              {messages.length === 0 ? (
                <div className="welcome">
                  <div className="welcome-eyebrow"><span className="eyebrow-line" /> THE AI WORKSPACE <span className="eyebrow-line" /></div>
                  <div className="welcome-orb"><span>✳</span><i /><b /></div>
                  <h1>Think beyond<br /><em>one perspective.</em></h1>
                  <p>{selectedChatId ? "Continue this saved conversation by sending a message below." : "Your conversations are saved automatically. Start a new chat and return to it anytime."}</p>
                  <div className="welcome-models"><span className="welcome-model blue-dot">Astra Core</span><span className="plus-dot">+</span><span className="welcome-model purple-dot">Nova Reasoner</span></div>
                  <div className="suggestions">
                    {["Explain a difficult concept", "Help me plan a project", "Review an idea and find gaps"].map((item, i) => <button key={item} onClick={() => setPrompt(item)}><span className="suggestion-icon">{["✧","⌘","◈"][i]}</span><span>{item}</span><b>↗</b></button>)}
                  </div>
                </div>
              ) : (
                <div className="message-list">
                  {messages.map((message, index) => (
                    <article className={`message message-${message.role}`} key={message.id || index}>
                      {message.role === "assistant" && <div className="assistant-avatar">✳</div>}
                      <div className="message-content">{message.role === "assistant" && <div className="message-author">AI DUO <span>·</span> UNIFIED RESPONSE</div>}<div className="message-text">{message.content}</div>{message.attachments?.length ? <div className="message-attachments">{message.attachments.map((a) => a.url ? <a key={a.path} href={a.url} target="_blank" rel="noreferrer"><img src={a.url} alt={a.name} /><small>{a.name}</small></a> : null)}</div> : null}{message.role === "assistant" ? <div className="message-tools"><button onClick={() => void copyMessage(message.content)}>Copy</button>{extractArtifact(message.content) ? <button onClick={() => downloadArtifact(message.content)}>↓ Download {extractArtifact(message.content)?.ext.toUpperCase()}</button> : null}{extractArtifact(message.content)?.ext === "html" ? <button className="run-html" onClick={() => runHtml(message.content)}>▶ Run HTML</button> : null}</div> : null}</div>
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
                <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addImages(e.target.files)} />
                {pendingImages.length > 0 && <div className="pending-images">{pendingImages.map((item, i) => <div key={item.preview}><img src={item.preview} alt={item.file.name} /><button type="button" onClick={() => setPendingImages((current) => current.filter((_, index) => index !== i))}>×</button></div>)}</div>}
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onComposerKeyDown} placeholder="Ask your AI team anything…" rows={1} maxLength={12000} disabled={loading} aria-label="Write your message" />
                <div className="composer-bottom"><div className="composer-hints"><button type="button" className="attach-button" onClick={() => imageInput.current?.click()}>＋ Image</button><span className="hint-pill">✧ {activeModels.length} models active</span><span>Enter to send · Shift + Enter for a new line</span></div><button type="submit" disabled={loading || (!prompt.trim() && pendingImages.length === 0) || activeModels.length === 0} aria-label="Send message">{loading ? <span className="send-spinner" /> : "↑"}</button></div>
              </form>
              <div className="disclaimer">AI can make mistakes. Verify important information before relying on it.</div>
            </div>
          </>
        ) : (
          <div className="files-page">
            <div className="files-heading"><div><div className="page-eyebrow">YOUR PERSONAL LIBRARY</div><h1>My files</h1><p>Keep your documents and resources in one private place.</p></div><span className="storage-badge"><i /> SUPABASE STORAGE</span></div>
            <div className={`dropzone ${dragging ? "dropzone-active" : ""} ${uploading ? "dropzone-uploading" : ""}`} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => !uploading && fileInput.current?.click()}>
              <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && void uploadFiles(e.target.files)} />
              <div className="upload-symbol">⇧</div><h2>{uploading ? "Uploading your files…" : "Drop files here to upload"}</h2><p>or <button type="button" onClick={(e) => { e.stopPropagation(); fileInput.current?.click(); }}>browse from your device</button></p><small>Any file type · Up to 50 MB per file</small>
              {uploading && <div className="progress-track"><i style={{ width: uploadProgress + "%" }} /></div>}
            </div>
            {fileError && <div className="inline-error file-error">{fileError}</div>}
            <div className="files-list-header"><div><h2>Uploaded files</h2><span>{files.length} items · private to your account</span></div><button onClick={() => void loadFiles()}>↻ Refresh</button></div>
            <div className="file-list">{filesLoading ? <div className="file-empty">Loading files…</div> : files.length === 0 ? <div className="file-empty"><span>▧</span><b>No files yet</b><small>Files you upload will appear here.</small></div> : files.map((file) => (
              <div className="file-row" key={file.path}><div className="file-type">{file.name.split(".").pop()?.slice(0,4).toUpperCase() || "FILE"}</div><div className="file-meta"><b>{file.name}</b><small>{formatBytes(file.metadata?.size)} · {file.created_at ? new Date(file.created_at).toLocaleDateString() : "Stored securely"} · {file.path.split("/").length > 2 ? "Chat attachment" : "My upload"}</small></div><div className="file-actions">{file.name.toLowerCase().endsWith(".html") && <button className="run-html" onClick={() => void runUploadedHtml(file.path)} title="Run HTML in sandbox">▶</button>}<button onClick={() => void previewFile(file.path)} title="Preview">↗</button><button onClick={() => void downloadFile(file.path)} title="Download">↓</button><button className="delete-action" onClick={() => askDeleteFile(file.path)} title="Delete from Supabase">×</button></div></div>
            ))}</div>
          </div>
        )}
        {previewOpen && <aside className="preview-drawer"><div className="preview-head"><div><b>HTML Preview</b><small>Sandboxed live output</small></div><div><button onClick={() => downloadArtifact(" ```html\n" + previewHtml + "\n``` ")}>Download</button><button onClick={() => setPreviewOpen(false)} aria-label="Close preview">×</button></div></div><iframe title="Generated HTML preview" sandbox="allow-scripts" srcDoc={previewHtml} /></aside>}
      </section>
      {confirmDialog && <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmDialog(null); }}><section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><div className="confirm-icon">!</div><h2 id="confirm-title">{confirmDialog.title}</h2><p>{confirmDialog.message}</p><div className="confirm-actions"><button type="button" className="confirm-cancel" onClick={() => setConfirmDialog(null)}>No, keep it</button><button type="button" className="confirm-delete" onClick={async () => { const action = confirmDialog.onConfirm; setConfirmDialog(null); await action(); }}>{confirmDialog.confirmLabel}</button></div></section></div>}
    </main>
  );
}
