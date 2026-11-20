const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "3m ago", "2h ago", "5d ago", then the date: how dashboards show ages. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const elapsed = now - new Date(iso).getTime();
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 30 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;
  return new Date(iso).toLocaleDateString("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "45s", then "2m 03s", then "1h 05m": how long a deployment took, or has taken so far. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** The time of day, "14:18:02", in the viewer's time zone. */
export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour12: false });
}

/** "940 B", "18 KB", "2.4 MB": a file's size, in units of 1,024. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
