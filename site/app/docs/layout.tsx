import { DocsLayout } from "fumadocs-ui/layouts/notebook";
import { source } from "@/lib/source";
import { LogoMark } from "@/components/site/Logo";
import { GITHUB_URL, X_URL } from "@/lib/site";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      nav={{ mode: "top", title: (
          <span className="inline-flex items-center gap-2.5 font-display text-xl leading-none font-extrabold tracking-[-0.02em]">
            <LogoMark />
            plans
            <span className="font-sans text-sm font-medium tracking-normal text-fd-muted-foreground">docs</span>
          </span>
        ), url: "/docs" }}
      githubUrl={GITHUB_URL}
      links={[
        { text: "Home", url: "/", active: "none" },
        { text: "Download", url: "/download", active: "none" },
        { text: "Live stats", url: "/stats", active: "none" },
        { text: "X", url: X_URL, active: "none", external: true },
      ]}
    >
      {children}
    </DocsLayout>
  );
}
