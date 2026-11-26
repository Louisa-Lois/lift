import { cn } from "@/lib/utils";

/**
 * Lift's wordmark from Louisa's brand kit (public/brand, UI-01), in its version for dark
 * backgrounds: the root layout keeps the app dark. Its alt text names it, so a link or heading
 * around it reads "Lift". Set the height with `className`; the width follows the 101:40 shape.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    // biome-ignore lint/performance/noImgElement: a static SVG from public/, no optimisation needed
    <img
      src="/brand/lift-wordmark-dark.svg"
      alt="Lift"
      width={101}
      height={40}
      className={cn("block w-auto", className)}
    />
  );
}
