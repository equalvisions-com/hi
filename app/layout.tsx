import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { UserMenuServer } from "@/components/user-menu/UserMenuServer";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { AudioProvider } from "@/components/audio-player/AudioContext";
import { PersistentPlayer } from "@/components/audio-player/PersistentPlayer";
import { Chatbot } from "@/components/chat/ChatBot";
import { ConvexLogo } from "@/public/ConvexLogo";
import { MobileDock } from "@/components/ui/mobile-dock";
import Link from "next/link";
import { SpeedInsights } from "@vercel/speed-insights/next"
import { Analytics } from '@vercel/analytics/next';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Convex + Next.js + Convex Auth",
  description: "Generated by npm create convex",
  icons: {
    icon: "/convex.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ConvexAuthNextjsServerProvider>
      {/* `suppressHydrationWarning` only affects the html tag,
      // and is needed by `ThemeProvider` which sets the theme
      // class attribute on it */}
      <html lang="en" suppressHydrationWarning>
        <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        >
          <ConvexClientProvider>
            <ThemeProvider attribute="class">
              <AudioProvider>
                <header className="block md:hidden">
                  <div className="container mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                      <Link href="/" className="hover:opacity-80 transition-opacity">
                        <ConvexLogo width={100} height={16} />
                      </Link>
                      <UserMenuServer />
                    </div>
                  </div>
                </header>
                <main className="pb-24 md:pb-16">{children}</main>
                <PersistentPlayer />
                <Chatbot />
                <MobileDock />
              </AudioProvider>
            </ThemeProvider>
          </ConvexClientProvider>
          <SpeedInsights />
          <Analytics />
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
