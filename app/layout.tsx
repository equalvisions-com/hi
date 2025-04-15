import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { ConvexAuthNextjsServerProvider, convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import ConvexClientProvider from "@/components/ConvexClientProvider";
import { UserMenuServer, getUserProfile } from "@/components/user-menu/UserMenuServer";
import { AudioProvider } from "@/components/audio-player/AudioContext";
import { PersistentPlayer } from "@/components/audio-player/PersistentPlayer";
import { MobileDock } from "@/components/ui/mobile-dock";
import { SidebarProvider } from "@/components/ui/sidebar-context";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Get all user profile information
  const { displayName, username, isAuthenticated, isBoarded, profileImage, userId, pendingFriendRequestCount } = await getUserProfile();

  return (
    <ConvexAuthNextjsServerProvider>
      {/* `suppressHydrationWarning` only affects the html tag,
      // and is needed by `ThemeProvider` which sets the theme
      // class attribute on it */}
      <html lang="en" suppressHydrationWarning className="h-full">
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"/>
        </head>
        <body
          className={`${inter.variable} ${jetbrainsMono.variable} antialiased no-overscroll h-full flex flex-col overflow-hidden`}
        >
          {/* Script to fix iOS viewport height issues with vh units */}
          <Script id="viewport-height-fix" strategy="afterInteractive">
            {`
              // Fix for iOS 100vh issue
              function setVH() {
                let vh = window.innerHeight * 0.01;
                document.documentElement.style.setProperty('--vh', \`\${vh}px\`);
              }
              
              // Set initially
              setVH();
              
              // Update on resize and orientation change
              window.addEventListener('resize', setVH);
              window.addEventListener('orientationchange', setVH);
            `}
          </Script>
          
          <ConvexClientProvider>
            <ThemeProvider attribute="class">
              <AudioProvider>
                <SidebarProvider 
                  isAuthenticated={isAuthenticated} 
                  username={username}
                  displayName={displayName}
                  isBoarded={isBoarded}
                  profileImage={profileImage}
                  userId={userId}
                  pendingFriendRequestCount={pendingFriendRequestCount}
                >
                  <div className="h-full flex flex-col overflow-hidden pb-safe">
                    <div className="hidden">
                      <UserMenuServer />
                    </div>
                    {children}
                  </div>
                  <PersistentPlayer />
                  <MobileDock />
                </SidebarProvider>
              </AudioProvider>
            </ThemeProvider>
          </ConvexClientProvider>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
