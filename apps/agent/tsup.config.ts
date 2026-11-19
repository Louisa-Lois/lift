import { cp } from "node:fs/promises";
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
  // The prompts are read at startup from next to the bundle (src/prompts.ts).
  onSuccess: async () => {
    await cp("src/prompts", "dist/prompts", { recursive: true });
  },
});
