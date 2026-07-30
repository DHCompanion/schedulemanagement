import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  // tsconfig.json sets jsx: "preserve" for Next's own SWC transform; vite's oxc
  // transform needs its own jsx setting here or it leaves JSX untransformed in
  // .tsx test files.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"] },
});
