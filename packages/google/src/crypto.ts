import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getGoogleEnv, parseEncryptionKey } from "./env.js";

/** Ciphertext prefix so encrypted tokens can be distinguished from plain refresh tokens. */
export const ENCRYPTION_PREFIX = "enc:aes256gcm:";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ALGORITHM = "aes-256-gcm";

function resolveKey(keyOverride?: string): Buffer {
  const raw = keyOverride ?? getGoogleEnv().APP_ENCRYPTION_KEY;
  return parseEncryptionKey(raw);
}

/**
 * Encrypt a Google refresh token with AES-256-GCM.
 *
 * Output format: `enc:aes256gcm:` + base64(IV || authTag || ciphertext)
 * - IV: 12 random bytes
 * - authTag: 16 bytes (GCM)
 * - Key: APP_ENCRYPTION_KEY (32-byte hex or base64 — see parseEncryptionKey)
 */
export function encryptRefreshToken(
  plain: string,
  keyOverride?: string,
): string {
  const key = resolveKey(keyOverride);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]);
  return `${ENCRYPTION_PREFIX}${payload.toString("base64")}`;
}

/**
 * Decrypt a value produced by encryptRefreshToken.
 * Throws if the payload is malformed or authentication fails.
 */
export function decryptRefreshToken(
  cipher: string,
  keyOverride?: string,
): string {
  if (!cipher.startsWith(ENCRYPTION_PREFIX)) {
    throw new Error(
      `Encrypted refresh token must start with "${ENCRYPTION_PREFIX}"`,
    );
  }

  const key = resolveKey(keyOverride);
  const b64 = cipher.slice(ENCRYPTION_PREFIX.length);
  const payload = Buffer.from(b64, "base64");

  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Encrypted refresh token payload is too short");
  }

  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** True when the string looks like an encryptRefreshToken output. */
export function isEncryptedRefreshToken(value: string): boolean {
  return value.startsWith(ENCRYPTION_PREFIX);
}
