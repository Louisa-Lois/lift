import Anser, { type AnserJsonEntry } from "anser";
import { cn } from "@/lib/utils";

/** ANSI colours, in the theme's own colours, so Louisa's theme restyles logs too. */
const COLOURS: Record<string, string> = {
  red: "text-status-failed",
  green: "text-status-active",
  yellow: "text-status-building",
  blue: "text-status-deploying",
  magenta: "text-primary",
  cyan: "text-chart-2",
  white: "text-foreground",
  black: "text-muted-foreground",
};

const DECORATIONS: Record<string, string> = {
  bold: "font-semibold",
  dim: "opacity-70",
  italic: "italic",
  underline: "underline",
  strikethrough: "line-through",
  hidden: "invisible",
};

function colourClass(fg: string | null | undefined): string | undefined {
  if (!fg) return undefined;
  const name = fg.replace(/^ansi-/, "").replace(/^bright-/, "");
  // "Bright black" is how terminals spell grey.
  return fg.includes("bright-black") ? "text-muted-foreground" : COLOURS[name];
}

/** Splits a line into styled segments; exported for tests. */
export function ansiSegments(text: string): AnserJsonEntry[] {
  return Anser.ansiToJson(text, { use_classes: true, remove_empty: true });
}

/**
 * One log line with its ANSI colours as React spans: text only, never HTML, so a line like
 * `<script>` shows as typed.
 */
export function AnsiLine({ text }: { text: string }) {
  return (
    <>
      {ansiSegments(text).map((segment, index) => {
        const classes = cn(
          colourClass(segment.fg),
          segment.decorations.map((decoration) => DECORATIONS[decoration]),
        );
        return classes ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: segments never reorder within a line
          <span key={index} className={classes}>
            {segment.content}
          </span>
        ) : (
          segment.content
        );
      })}
    </>
  );
}
