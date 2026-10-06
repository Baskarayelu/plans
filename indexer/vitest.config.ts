import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests use a fixture list of internal accounts (demo members Ben/Asha/Maya + one team account).
    env: { ENVIO_INTERNAL_ACCOUNTS_FILE: "test/fixtures/internal-accounts.json" },
  },
});
