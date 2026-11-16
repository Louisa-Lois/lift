import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so bundle them; npm packages stay external.
  noExternal: [/^@lift\//],
});
