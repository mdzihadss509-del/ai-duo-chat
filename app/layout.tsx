import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Duo — One unified AI chat",
  description: "One conversation, powered by your selected AI team.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}