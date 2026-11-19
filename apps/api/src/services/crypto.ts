import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { problem } from "../lib/problem";

const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SecretBox {
  /** Encrypts for a `*_enc` column: `iv | tag | ciphertext`, with a fresh random IV each time. */
  encrypt(plaintext: string): Buffer;
  /** Throws if the value was tampered with or encrypted under another key. */
  decrypt(stored: Buffer): string;
}

/**
 * AES-256-GCM with the 32-byte ENCRYPTION_KEY, for every `*_enc` column
 * (docs/prd/01-backend-api.md, "Encryption"). The only code that encrypts or decrypts.
 */
export function createSecretBox(keyBase64: string): SecretBox {
  const key = Buffer.from(keyBase64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be exactly 32 bytes");
  return {
    encrypt(plaintext) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decrypt(stored) {
      if (stored.length < IV_BYTES + TAG_BYTES) throw new Error("Encrypted value is too short");
      const decipher = createDecipheriv("aes-256-gcm", key, stored.subarray(0, IV_BYTES));
      decipher.setAuthTag(stored.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      return Buffer.concat([
        decipher.update(stored.subarray(IV_BYTES + TAG_BYTES)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

/** The secret box, or 503 on a server without ENCRYPTION_KEY (development only; production needs it). */
export function requireSecretBox(secretBox: SecretBox | null): SecretBox {
  if (!secretBox) {
    throw problem(
      "upstream_unavailable",
      "This server has no ENCRYPTION_KEY, so it can't store or read secrets.",
    );
  }
  return secretBox;
}
