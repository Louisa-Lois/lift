import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSecretBox } from "../src/services/crypto";

const key = randomBytes(32).toString("base64");

describe("createSecretBox (AES-256-GCM)", () => {
  const box = createSecretBox(key);

  it("decrypts what it encrypted", () => {
    expect(box.decrypt(box.encrypt("a GitHub token"))).toBe("a GitHub token");
  });

  it("stores iv (12 bytes) | tag (16 bytes) | ciphertext, never the plaintext", () => {
    const stored = box.encrypt("secret-value");
    expect(stored.length).toBe(12 + 16 + Buffer.byteLength("secret-value"));
    expect(stored.includes(Buffer.from("secret-value"))).toBe(false);
  });

  it("uses a fresh IV each time", () => {
    expect(box.encrypt("same").equals(box.encrypt("same"))).toBe(false);
  });

  it("refuses a tampered value, another key's value and a truncated one", () => {
    const stored = box.encrypt("secret-value");
    const tampered = Buffer.from(stored);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    expect(() => box.decrypt(tampered)).toThrow();
    expect(() => createSecretBox(randomBytes(32).toString("base64")).decrypt(stored)).toThrow();
    expect(() => box.decrypt(stored.subarray(0, 20))).toThrow(/too short/);
  });

  it("refuses a key that isn't 32 bytes", () => {
    expect(() => createSecretBox(randomBytes(31).toString("base64"))).toThrow(/32 bytes/);
  });
});
