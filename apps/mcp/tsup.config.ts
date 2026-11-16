import { defineConfig } from "tsup";

export default defineConfig({
  // stdio.js is what Claude Code, Cursor and Codex launch; AI-11 adds http.ts.
  entry: ["src/stdio.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so bundle them; npm packages stay external.
  noExternal: [/^@lift\//],
});
