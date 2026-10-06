// APK downloads: the one offchain metric in docs/traction.md (GitHub release asset download count).
export async function apkDownloads(): Promise<{ state: "ok" | "none" | "unreachable"; count: number }> {
  try {
    const res = await fetch("https://api.github.com/repos/Baskarayelu/plans/releases?per_page=100", {
      headers: { accept: "application/vnd.github+json" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { state: "unreachable", count: 0 };
    const releases = (await res.json()) as Array<{ assets?: Array<{ name: string; download_count: number }> }>;
    const apks = releases.flatMap((r) => r.assets ?? []).filter((a) => a.name.endsWith(".apk"));
    if (!apks.length) return { state: "none", count: 0 };
    return { state: "ok", count: apks.reduce((s, a) => s + a.download_count, 0) };
  } catch {
    return { state: "unreachable", count: 0 };
  }
}
