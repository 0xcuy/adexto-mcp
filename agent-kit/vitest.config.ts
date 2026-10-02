import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Live and fork tests reach real networks and a local chain; they skip themselves unless enabled.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
