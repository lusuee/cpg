import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  root: path.resolve(__dirname, ".."),
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    include: ["worker/test/**/*.test.ts"],
    environment: "node",
  },
});
