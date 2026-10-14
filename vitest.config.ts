import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    env: {
      ARTICLE_PIPELINE_INTEGRATION: "0"
    }
  }
});
