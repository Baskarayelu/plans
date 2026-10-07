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

// Error capture for post-deploy checks that cannot read the console (Safari WebDriver); see e2e/web/postdeploy.mjs.
const ERROR_CAPTURE = `(function(){var E=(window.__plansErrors=[]);function push(t,m){try{if(E.length<100)E.push({t:t,m:String(m).slice(0,300)})}catch(e){}}
window.addEventListener("error",function(e){var el=e&&e.target;if(el&&el!==window&&(el.src||el.href))push("resource",el.src||el.href);else push("error",(e&&e.message)||"error")},true);
window.addEventListener("unhandledrejection",function(e){push("rejection",e&&e.reason&&(e.reason.message||e.reason))});
var ce=console.error;console.error=function(){push("console",Array.prototype.map.call(arguments,String).join(" "));return ce.apply(console,arguments)}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${body.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: ERROR_CAPTURE }} />
      </head>
      <body className="flex min-h-screen flex-col">
        <RootProvider theme={{ hotKey: false, defaultTheme: "system", enableSystem: true }}>{children}</RootProvider>
      </body>
    </html>
  );
}
