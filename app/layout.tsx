import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Duo — Gemini × Groq",
  description: "Compare two AI models and get one combined answer.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}