/**
 * What looks like a secret, for the planner (a `default` value that looks secret becomes one the
 * user provides) and for autofix (it only sets a variable whose key and value look harmless).
 * Erring towards "secret" is the safe side: the user is asked instead.
 */

/** Key names that usually hold secrets or credentials, like SESSION_SECRET or DATABASE_URL. */
const SECRET_KEY =
  /SECRET|TOKEN|KEY|PASS|PRIVATE|CREDENTIAL|AUTH|DSN|SALT|SIGNATURE|COOKIE|_URL$|^URL$/;

/** Values with the shape of a known credential. */
const TOKEN_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}/,
  /\bwhsec_[A-Za-z0-9]{10,}/,
  /\blift_(?:pat|svc)_[A-Za-z0-9_-]{32}/,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./,
  /^[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:[^\s@/]+@/i,
];

/** A random-looking run of 20 or more characters that mixes letters and digits. */
function looksRandom(value: string): boolean {
  return (
    value.length >= 20 &&
    /^[A-Za-z0-9+/=_-]+$/.test(value) &&
    /[0-9]/.test(value) &&
    /[A-Za-z]/.test(value)
  );
}

/** Whether a key, or a value for it, looks like a secret. */
export function looksSecret(key: string, value?: string): boolean {
  if (SECRET_KEY.test(key.toUpperCase())) return true;
  if (value === undefined) return false;
  return TOKEN_SHAPES.some((shape) => shape.test(value)) || looksRandom(value.trim());
}

/** An example value meant to be replaced, like `changeme`, `your-api-key` or `<token>`. */
export function isPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed === "" ||
    /^(?:change[-_ ]?me|replace[-_ ]?me|todo|tbd|xxx+|\.\.\.|null|none|undefined)$/i.test(
      trimmed,
    ) ||
    /^(?:your|my)[-_ ]/i.test(trimmed) ||
    /^<.*>$/.test(trimmed) ||
    /^\$\{.*\}$/.test(trimmed)
  );
}
