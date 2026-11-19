import { redact } from "./redact";

/**
 * Wraps text from outside Lift (a repository file, a build log, anything an app printed) the way
 * PRD 03 says: `<untrusted source="…">`, redacted first. Any `<untrusted` or `</untrusted` inside
 * is escaped, so the content can't close its wrapper and pose as Lift's own words.
 */
export function untrusted(source: string, content: string): string {
  const label = source.replace(/["<>\r\n]/g, "_");
  const body = redact(content).replace(/<(\/?)untrusted/gi, "&lt;$1untrusted");
  return `<untrusted source="${label}">\n${body}\n</untrusted>`;
}
