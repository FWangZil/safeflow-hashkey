import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: "SafeFlow Yield Agent",
  description: "AI-powered DeFi yield management with on-chain security guardrails",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <div id="app-root" className="flex flex-col min-h-full">
          <Providers>{children}</Providers>
        </div>
      </body>
    </html>
  );
}
