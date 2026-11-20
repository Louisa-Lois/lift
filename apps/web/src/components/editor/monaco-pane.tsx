"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { cursorCss } from "@/lib/editor-files";
import { type LiveFile, type LiveFileState, openLiveFile } from "./live-file";
import { monaco } from "./monaco";

export interface MonacoPaneProps {
  serviceId: string;
  /** The open files the editor can edit; each gets its own live document. */
  paths: string[];
  /** The one on screen; null shows nothing. */
  active: string | null;
  onFileState: (path: string, state: LiveFileState) => void;
}

/**
 * The Monaco editor with one live document per open file (FE-13). Browser only: load it through
 * lazy-monaco-pane.tsx.
 */
export default function MonacoPane({ serviceId, paths, active, onFileState }: MonacoPaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const files = useRef(new Map<string, LiveFile>());
  const cursors = useRef<HTMLStyleElement | null>(null);
  const activePath = useRef(active);

  /** Puts the active file's model on screen, keeping each file's cursor and scroll. */
  const show = useEffectEvent(() => {
    const instance = editor.current;
    if (!instance) return;
    const file = activePath.current ? files.current.get(activePath.current) : undefined;
    const current = instance.getModel();
    if (current !== (file?.model ?? null)) {
      const previous = [...files.current.values()].find((entry) => entry.model === current);
      if (previous) previous.viewState = instance.saveViewState();
      instance.setModel(file?.model ?? null);
      if (file?.viewState) instance.restoreViewState(file.viewState);
      if (file) instance.focus();
    }
    instance.updateOptions({ readOnly: file ? file.readOnly : true });
  });

  const renderCursors = useEffectEvent(() => {
    if (!cursors.current) return;
    cursors.current.textContent = cursorCss(
      [...files.current.values()].flatMap((file) => file.others()),
    );
  });

  const report = useEffectEvent((path: string, state: LiveFileState) => {
    onFileState(path, state);
    show();
  });

  useEffect(() => {
    if (!host.current) return;
    const instance = monaco.editor.create(host.current, {
      model: null,
      theme: "vs-dark",
      automaticLayout: true,
      readOnly: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineHeight: 20,
      padding: { top: 16 },
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
    });
    editor.current = instance;
    const style = document.createElement("style");
    document.head.append(style);
    cursors.current = style;
    const open = files.current;
    return () => {
      for (const file of open.values()) file.dispose();
      open.clear();
      instance.dispose();
      style.remove();
      editor.current = null;
      cursors.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    for (const path of paths) {
      if (files.current.has(path)) continue;
      const file = openLiveFile({
        monaco,
        serviceId,
        path,
        editor: instance,
        onState: (state) => report(path, state),
        onCursors: () => renderCursors(),
      });
      files.current.set(path, file);
    }
    for (const [path, file] of files.current) {
      if (paths.includes(path)) continue;
      if (instance.getModel() === file.model) instance.setModel(null);
      file.dispose();
      files.current.delete(path);
    }
    renderCursors();
    show();
  }, [paths, serviceId]);

  useEffect(() => {
    activePath.current = active;
    show();
  }, [active]);

  return <div ref={host} className="lift-editor absolute inset-0" />;
}
