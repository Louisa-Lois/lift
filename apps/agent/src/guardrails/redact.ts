/**
 * Removes secrets from text before it reaches the model (PRD 03, "Guardrails"): repository files,
 * build logs and anything an app printed. Stored variable values are already scrubbed from logs by
 * the worker; these patterns catch the rest. Erring towards redacting is fine: the model only
 * needs to see that a value is there.
 */
const REDACTED = "[REDACTED]";

const PATTERNS: [RegExp, string][] = [
  // A private key, whole, even when its END line is cut off.
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    "[REDACTED PRIVATE KEY]",
  ],
  // AWS access key IDs, and secret keys or session tokens named as such.
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
  [
    /\b(aws_secret_access_key|aws_session_token)(["']?\s*[=:]\s*["']?)[A-Za-z0-9/+=]{20,}/gi,
    `$1$2${REDACTED}`,
  ],
  // GitHub, Stripe, Slack, Anthropic and Lift's own tokens; JSON web tokens.
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/g, REDACTED],
  [/\bwhsec_[A-Za-z0-9]{10,}/g, REDACTED],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, REDACTED],
  [/\blift_(?:pat|svc)_[A-Za-z0-9_-]{32}/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g, REDACTED],
  // The password in a URL: postgres://user:password@host.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, `$1${REDACTED}@`],
  // password=…, "apiKey": "…", SECRET: … and the like.
  [
    /\b([A-Za-z0-9_.-]*(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)[A-Za-z0-9_.-]*)(["']?\s*[=:]\s*)(["']?)[^\s"'&,;]+/gi,
    `$1$2$3${REDACTED}`,
  ],
];

export function redact(text: string): string {
  let result = text;
  for (const [pattern, replacement] of PATTERNS) result = result.replace(pattern, replacement);
  return result;
}
