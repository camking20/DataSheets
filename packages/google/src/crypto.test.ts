import { describe, expect, it } from "vitest";
import {
  decryptRefreshToken,
  encryptRefreshToken,
  isEncryptedRefreshToken,
  parseEncryptionKey,
} from "./index.js";

const HEX_KEY = "a".repeat(64);
const PLAIN = "1//0refresh-token-example";

describe("parseEncryptionKey", () => {
  it("accepts 64-char hex", () => {
    const key = parseEncryptionKey(HEX_KEY);
    expect(key).toHaveLength(32);
  });

  it("accepts 32-byte base64", () => {
    const b64 = Buffer.alloc(32, 7).toString("base64");
    expect(parseEncryptionKey(b64)).toHaveLength(32);
  });

  it("rejects invalid keys", () => {
    expect(() => parseEncryptionKey("too-short")).toThrow(/APP_ENCRYPTION_KEY/);
  });
});

describe("encryptRefreshToken / decryptRefreshToken", () => {
  it("round-trips a refresh token", () => {
    const cipher = encryptRefreshToken(PLAIN, HEX_KEY);
    expect(isEncryptedRefreshToken(cipher)).toBe(true);
    expect(decryptRefreshToken(cipher, HEX_KEY)).toBe(PLAIN);
  });

  it("produces different ciphertext each call (random IV)", () => {
    const a = encryptRefreshToken(PLAIN, HEX_KEY);
    const b = encryptRefreshToken(PLAIN, HEX_KEY);
    expect(a).not.toBe(b);
    expect(decryptRefreshToken(a, HEX_KEY)).toBe(PLAIN);
    expect(decryptRefreshToken(b, HEX_KEY)).toBe(PLAIN);
  });

  it("fails on tampered ciphertext", () => {
    const cipher = encryptRefreshToken(PLAIN, HEX_KEY);
    const tampered = cipher.slice(0, -4) + "xxxx";
    expect(() => decryptRefreshToken(tampered, HEX_KEY)).toThrow();
  });
});
