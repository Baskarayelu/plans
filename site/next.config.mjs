import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
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
      {
        // Everywhere except the link pages above, which keep "no-referrer" (a later match would override it).
        source: "/:path((?!j/|c/|p/|v/|s/).*)",
        headers: [{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" }],
      },
    ];
  },
};

export default withMDX(config);
