import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  /**
   * The web app (app/ built with `npm --prefix ../app run build:web`) is a static single-page app in
   * public/app. Its files are served as they are; every other /app path (deep links such as
   * /app/plan/0x…, /app/join#…) gets its index.html. afterFiles runs after public files, so
   * /app/_expo/… and /app/assets/… are never rewritten.
   */
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        { source: "/app", destination: "/app/index.html" },
        { source: "/app/:path((?!_expo/|assets/|icons/).*)", destination: "/app/index.html" },
      ],
      fallback: [],
    };
  },
  async headers() {
    return [
      {
        // Android App Links / Credential Manager: must be served as JSON at exactly this path, no redirect.
        source: "/.well-known/assetlinks.json",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
      {
        source: "/release.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=60" }],
      },
      // Invite, claim and Plans-code fallback pages: never indexed, never leak the path in a referrer.
      ...["/j/:path*", "/c/:path*", "/p/:path*"].map((source) => ({
        source,
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      })),
      {
        // Shared plan (/v) and proof (/s) pages: read from the public record; secrets and names stay in "#".
        source: "/v/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/s/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
        ],
      },
      {
        source: "/:path*",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
      // The web app: links carry secrets in "#" (invites, claim keys, browser links), so never send a referrer;
      // not indexed; the HTML is always revalidated and the hashed bundles cached for good.
      ...["/app", "/app/:path*"].map((source) => ({
        source,
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex" },
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Permissions-Policy", value: "camera=(self), publickey-credentials-get=(self), publickey-credentials-create=(self)" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      })),
      {
        source: "/app/_expo/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/app/assets/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // The web app's service worker (notifications only). Its scope is "/app" (no slash) so it also covers
        // /app itself, which is wider than its folder: that needs Service-Worker-Allowed. Never cached stale.
        source: "/app/sw.js",
        headers: [
          { key: "Service-Worker-Allowed", value: "/app" },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
      {
        // Everywhere except the link pages above and the web app, which keep "no-referrer" (a later match would override it).
        source: "/:path((?!j/|c/|p/|v/|s/|app/|app$).*)",
        headers: [{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }],
      },
    ];
  },
};

export default withMDX(config);
