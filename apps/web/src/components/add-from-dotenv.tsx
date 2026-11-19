"use client";

import { FileUpIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { parseDotenv } from "@/lib/dotenv";

/**
 * "Add from .env" (docs/prd/02-frontend.md): paste a file's contents, and its variables join the
 * staged changes, adding keys or replacing values. Nothing is deleted, and nothing is saved until
 * you press Save.
 */
export function AddFromDotenv({
  existing,
  onAdd,
}: {
  existing: ReadonlySet<string>;
  onAdd: (values: Record<string, string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const parsed = parseDotenv(text);
  const keys = Object.keys(parsed.values);
  const replaced = keys.filter((key) => existing.has(key)).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setText("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileUpIcon aria-hidden="true" />
          Add from .env
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add from .env</DialogTitle>
          <DialogDescription>
            Paste a .env file. Its variables are added to the table, staged until you save.
          </DialogDescription>
        </DialogHeader>
        <textarea
          aria-label=".env text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          spellCheck={false}
          rows={10}
          placeholder={"DATABASE_URL=postgres://…\nNEXT_PUBLIC_API_URL=https://…"}
          className="w-full rounded-lg border bg-transparent p-3 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        {parsed.errors.length > 0 ? (
          <ul role="alert" className="flex flex-col gap-0.5 text-destructive text-xs">
            {parsed.errors.map((error) => (
              <li key={error.line}>
                Line {error.line}: {error.message}
              </li>
            ))}
          </ul>
        ) : keys.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            {keys.length} {keys.length === 1 ? "variable" : "variables"}
            {replaced > 0 ? `, ${replaced} replacing a value you have` : ""}.
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            disabled={keys.length === 0 || parsed.errors.length > 0}
            onClick={() => {
              onAdd(parsed.values);
              setOpen(false);
              setText("");
            }}
          >
            Add to the table
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
