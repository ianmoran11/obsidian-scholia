import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    include: ["test/unit/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
      include: ["src/templates/**/*.ts"],
    },
  },
  resolve: {
    alias: {
      obsidian: path.resolve(__dirname, "test/mocks/obsidian.ts"),
    },
  },
});
