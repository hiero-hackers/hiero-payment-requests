import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // Ratchet, don't rot: floors sit just under the current numbers so
      // coverage can only be raised deliberately, never lowered silently.
      thresholds: {
        statements: 99,
        branches: 99,
        functions: 100,
        lines: 99,
      },
    },
  },
});
