// The live editor's Monaco, bundled rather than loaded from a CDN (decision 9 of the Nov 26
// plan): the editor with all its features, syntax highlighting for 80 languages (each loaded
// when a file needs it), and its one base worker. There are no language services, so no other
// workers: highlighting follows the file's extension. Browser only: import it from
// monaco-pane.tsx, which loads without server rendering.
import "monaco-editor/features/register.all.js";
import "monaco-editor/languages/definitions/register.all.js";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "./editor.css";

globalThis.MonacoEnvironment = {
  getWorker: () =>
    new Worker(new URL("./editor.worker.ts", import.meta.url), {
      type: "module",
      name: "monaco-editor",
    }),
};

// JSON's highlighter comes with its language service, which the editor leaves out; JavaScript's
// reads JSON well.
monaco.languages.register({
  id: "json",
  extensions: [".json", ".jsonc", ".map"],
  filenames: [".babelrc", ".eslintrc", ".prettierrc"],
  aliases: ["JSON"],
});
monaco.languages.onLanguage("json", async () => {
  const { conf, language } = await import(
    "monaco-editor/languages/definitions/javascript/javascript.js"
  );
  monaco.languages.setLanguageConfiguration("json", conf);
  monaco.languages.setMonarchTokensProvider("json", language);
});

export { monaco };
