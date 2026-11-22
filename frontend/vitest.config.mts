import { defineConfig } from "vitest/config";

// Unit tests of the pure functions, next to their source (src/**/*.test.ts). The Playwright suite in e2e/ is not picked up here.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
