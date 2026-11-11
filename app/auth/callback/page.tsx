"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Completing your Google sign-in…");

  useEffect(() => {
    let cancelled = false;
    async function finish() {
      const supabase = getSupabase();
      if (!supabase) {
        setMessage("Sign-in configuration is missing. Please return to the login page.");
        return;
      }

      const params = new URLSearchParams(window.location.search);
      const providerError = params.get("error_description") || params.get("error");
      if (providerError) {
        setMessage(decodeURIComponent(providerError.replace(/\+/g, " ")));
        return;
      }

      const code = params.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          setMessage("Google sign-in could not be completed: " + error.message);
          return;
        }
      }

      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        setMessage("No active session was received. Please try signing in again.");
        return;
      }

      if (!cancelled) router.replace("/");
    }

    void finish().catch((error) => {
      if (!cancelled) setMessage(error instanceof Error ? error.message : "Google sign-in failed. Please try again.");
    });
    return () => { cancelled = true; };
  }, [router]);

  return (
    <main className="auth-screen">
      <div className="auth-card auth-card-pro">
        <div className="auth-icon">✳</div>
        <h2>Connecting your account</h2>
        <p>{message}</p>
        <a className="auth-submit" href="/">Return to AI Duo</a>
      </div>
    </main>
  );
}
