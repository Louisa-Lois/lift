import { randomInt } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const MAX_SLUG = 32;
const MAX_LABEL = 63;

/** Four random lowercase letters and digits: what a clashing slug or subdomain gets. */
export function randomSuffix(length = 4): string {
  let suffix = "";
  for (let i = 0; i < length; i += 1) suffix += ALPHABET[randomInt(ALPHABET.length)];
  return suffix;
}

const trimHyphens = (value: string) => value.replace(/^-+|-+$/g, "");

/**
 * "Demo shop!" → "demo-shop": lowercase letters and digits joined by hyphens, 3 to 32 characters
 * (the shared `Slug`). A name too short or with no letters gets a random suffix.
 */
export function slugify(name: string): string {
  const base = trimHyphens(
    trimHyphens(
      name
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-"),
    ).slice(0, MAX_SLUG),
  );
  return base.length >= 3 ? base : `${base || "app"}-${randomSuffix()}`;
}

/** The same slug with a random suffix, still at most `max` characters. */
export function withSuffix(slug: string, max = MAX_SLUG): string {
  return `${trimHyphens(slug.slice(0, max - 5))}-${randomSuffix()}`;
}

/** `{service-slug}-{project-slug}`, cut to one DNS label (docs/contracts.md, "Domains"). */
export function subdomainFor(serviceSlug: string, projectSlug: string): string {
  return trimHyphens(`${serviceSlug}-${projectSlug}`.slice(0, MAX_LABEL));
}

/** A clashing subdomain with a 4-character suffix, still one DNS label. */
export function subdomainWithSuffix(subdomain: string): string {
  return withSuffix(subdomain, MAX_LABEL);
}
