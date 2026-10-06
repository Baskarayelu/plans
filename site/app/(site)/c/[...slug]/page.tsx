import type { Metadata } from "next";
import { OpenInApp } from "@/components/links/OpenInApp";

export const metadata: Metadata = {
  title: "Money link",
  description: "Open this link in the Plans app.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Static shell: the path is not needed on the server, and the secret after "#" never reaches it.
export const dynamic = "force-static";
export function generateStaticParams() {
  return [];
}

export default function Page() {
  return <OpenInApp kind="c" />;
}
