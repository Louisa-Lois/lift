"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  changesFor,
  diffVariables,
  parseDotenv,
  printDotenv,
  type VariableDiff,
} from "@/lib/dotenv";

/**
 * The whole set as `.env` text (docs/prd/02-frontend.md, "Variables tab"). "Review changes" shows
 * which keys are added, changed and removed before anything is saved; a key taken out of the
 * text is deleted.
 */
export function EnvRawEditor({
  current,
  saving,
  onSave,
  onCancel,
}: {
  /** The stored variables in plaintext. */
  current: Record<string, string>;
  saving: boolean;
  onSave: (changes: Record<string, string | null>, diff: VariableDiff) => Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(() => printDotenv(current));
  const [review, setReview] = useState<{ diff: VariableDiff; next: Record<string, string> } | null>(
    null,
  );
  const [errors, setErrors] = useState<{ line: number; message: string }[]>([]);
  const [nothing, setNothing] = useState(false);

  function check() {
    const parsed = parseDotenv(text);
    setErrors(parsed.errors);
    setNothing(false);
    if (parsed.errors.length > 0) return;
    const diff = diffVariables(current, parsed.values);
    if (diff.added.length + diff.changed.length + diff.removed.length === 0) {
      setNothing(true);
      return;
    }
    setReview({ diff, next: parsed.values });
  }

  if (review) {
    const { diff, next } = review;
    const total = diff.added.length + diff.changed.length + diff.removed.length;
    const lines = [
      ...diff.added.map((key) => ({ key, mark: "+", label: "added" })),
      ...diff.changed.map((key) => ({ key, mark: "~", label: "changed" })),
      ...diff.removed.map((key) => ({ key, mark: "−", label: "removed" })),
    ];
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">
          {total} {total === 1 ? "change" : "changes"} to save. Values aren't shown here.
        </p>
        <ul aria-label="Changes" className="divide-y rounded-lg border font-mono text-xs">
          {lines.map(({ key, mark, label }) => (
            <li key={key} className="flex items-center gap-3 px-3 py-1.5">
              <span aria-hidden="true" className="w-3 text-muted-foreground">
                {mark}
              </span>
              <span className="flex-1">{key}</span>
              <span className="font-sans text-muted-foreground">{label}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={saving}
            onClick={() => void onSave(changesFor(diff, next), diff)}
          >
            {saving ? "Saving…" : `Save ${total} ${total === 1 ? "change" : "changes"}`}
          </Button>
          <Button type="button" variant="outline" disabled={saving} onClick={() => setReview(null)}>
            Back to the text
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        aria-label="Variables as .env text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        rows={Math.min(24, Math.max(8, text.split("\n").length + 2))}
        className="w-full rounded-lg border bg-transparent p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      {errors.length > 0 ? (
        <ul role="alert" className="flex flex-col gap-0.5 text-destructive text-xs">
          {errors.map((error) => (
            <li key={error.line}>
              Line {error.line}: {error.message}
            </li>
          ))}
        </ul>
      ) : null}
      {nothing ? <p className="text-muted-foreground text-xs">Nothing changed.</p> : null}
      <div className="flex gap-2">
        <Button type="button" onClick={check}>
          Review changes
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Back to the table
        </Button>
      </div>
    </div>
  );
}
