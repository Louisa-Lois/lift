// Monaco's base worker (diffs, links, word suggestions), bundled as its own chunk. The editor has
// no language services, so it needs no other worker.
import "monaco-editor/editor/editor.worker.js";
