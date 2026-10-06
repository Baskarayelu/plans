import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Figtree, IBM_Plex_Mono } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const body = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Plans: a shared pot for every plan", template: "%s · Plans" },
  description:
    "A group money pot for trips and plans. Friends in different countries join with one fingerprint, spend under rules the group sets, and settle up in one tap, on Monad.",
  applicationName: "Plans",
  openGraph: { siteName: "Plans", type: "website", url: SITE_URL },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4F6F1" },
    { media: "(prefers-color-scheme: dark)", color: "#0C1511" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-screen flex-col">
        <RootProvider theme={{ hotKey: false, defaultTheme: "system", enableSystem: true }}>{children}</RootProvider>
      </body>
    </html>
  );
}
