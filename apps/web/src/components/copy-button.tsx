"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "./ui/button";

/** Copies `value` to the clipboard and shows a check mark for a moment. */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy to the clipboard");
    }
  }

  return (
    <Button type="button" variant="ghost" size="icon-sm" onClick={copy} aria-label={label}>
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}
