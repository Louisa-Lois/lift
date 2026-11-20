// monaco-editor 0.57 ships no types for its language definitions; this is the one the editor uses.
declare module "monaco-editor/languages/definitions/javascript/javascript.js" {
  import type { languages } from "monaco-editor/editor/editor.api.js";

  export const conf: languages.LanguageConfiguration;
  export const language: languages.IMonarchLanguage;
}
