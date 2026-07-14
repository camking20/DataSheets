import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // apps/api is still being built out by another workstream — don't fail
    // `pnpm test` at the root just because no test files exist yet.
    passWithNoTests: true,
  },
});
