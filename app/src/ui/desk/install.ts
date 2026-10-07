/**
 * "Install Plans on this computer" (118) and the name of this browser. Only browsers have these;
 * on Android there is nothing to install and the phone's model name is used instead.
 */
export function useInstallPrompt(): { available: boolean; install: () => Promise<void> } {
  return { available: false, install: async () => undefined };
}

/** "Chrome on macOS"; null outside a browser. */
export function thisBrowser(): string | null {
  return null;
}
