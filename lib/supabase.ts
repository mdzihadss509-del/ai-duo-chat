import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

const rememberKey = "ai-duo-remember-session";

const sessionStorageAdapter = {
  getItem(key: string) {
    const persistent = localStorage.getItem(rememberKey) !== "false";
    return (persistent ? localStorage : sessionStorage).getItem(key);
  },
  setItem(key: string, value: string) {
    const persistent = localStorage.getItem(rememberKey) !== "false";
    (persistent ? localStorage : sessionStorage).setItem(key, value);
    (persistent ? sessionStorage : localStorage).removeItem(key);
  },
  removeItem(key: string) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};

export function setRememberSession(remember: boolean) {
  if (typeof window !== "undefined") localStorage.setItem(rememberKey, remember ? "true" : "false");
}

export function getRememberSession() {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(rememberKey) !== "false";
}

export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  if (!client) client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: sessionStorageAdapter,
    },
  });
  return client;
}
