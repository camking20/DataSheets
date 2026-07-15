import { z } from "zod";

/** Suggested redirect URI for the API Google OAuth callback route. */
export const SUGGESTED_GOOGLE_REDIRECT_URI =
  "http://localhost:4000/google/oauth/callback";

const googleEnvSchema = z.object({
  GOOGLE_CLIENT_ID: z
    .string({ required_error: "GOOGLE_CLIENT_ID is missing from the API environment" })
    .min(1, "GOOGLE_CLIENT_ID is empty — set it in the repo-root .env"),
  GOOGLE_CLIENT_SECRET: z
    .string({
      required_error: "GOOGLE_CLIENT_SECRET is missing from the API environment",
    })
    .min(1, "GOOGLE_CLIENT_SECRET is empty — set it in the repo-root .env"),
  GOOGLE_REDIRECT_URI: z
    .string()
    .url()
    .default(SUGGESTED_GOOGLE_REDIRECT_URI),
  APP_ENCRYPTION_KEY: z
    .string({
      required_error: "APP_ENCRYPTION_KEY is missing from the API environment",
    })
    .min(1, "APP_ENCRYPTION_KEY is empty — generate with: openssl rand -hex 32"),
});

export type GoogleEnv = z.infer<typeof googleEnvSchema>;

export class GoogleEnvError extends Error {
  readonly missing: string[];

  constructor(missing: string[], message: string) {
    super(message);
    this.name = "GoogleEnvError";
    this.missing = missing;
  }
}

/**
 * Read and validate Google OAuth + encryption env vars.
 * Throws GoogleEnvError with a clear setup message when values are missing.
 */
export function getGoogleEnv(
  env: NodeJS.ProcessEnv = process.env,
): GoogleEnv {
  const result = googleEnvSchema.safeParse({
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI: env.GOOGLE_REDIRECT_URI,
    APP_ENCRYPTION_KEY: env.APP_ENCRYPTION_KEY,
  });

  if (result.success) {
    // Validate encryption key format early so Connect fails with a clear message.
    try {
      parseEncryptionKey(result.data.APP_ENCRYPTION_KEY);
    } catch (err) {
      throw new GoogleEnvError(
        ["APP_ENCRYPTION_KEY"],
        err instanceof Error
          ? err.message
          : "APP_ENCRYPTION_KEY is invalid",
      );
    }
    return result.data;
  }

  const missing = [
    ...new Set(
      result.error.issues
        .map((i) => String(i.path[0] ?? ""))
        .filter(Boolean),
    ),
  ];

  throw new GoogleEnvError(
    missing,
    [
      "Google Drive is not configured on the API.",
      `Add these to the repo-root .env and restart the API: ${missing.join(", ")}.`,
      "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET come from Google Cloud Console → APIs & Services → Credentials (OAuth client).",
      "APP_ENCRYPTION_KEY: run `openssl rand -hex 32` and paste the 64-character hex value.",
      `GOOGLE_REDIRECT_URI should be ${SUGGESTED_GOOGLE_REDIRECT_URI} (register the same URI in Google Cloud).`,
    ].join(" "),
  );
}

/**
 * Parse APP_ENCRYPTION_KEY into a 32-byte Buffer.
 *
 * Accepted formats:
 * - 64-character hex string (32 bytes)
 * - standard base64 string that decodes to exactly 32 bytes
 */
export function parseEncryptionKey(raw: string): Buffer {
  const trimmed = raw.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }

  try {
    const fromBase64 = Buffer.from(trimmed, "base64");
    if (fromBase64.length === 32) {
      return fromBase64;
    }
  } catch {
    // fall through
  }

  throw new Error(
    "APP_ENCRYPTION_KEY must be a 64-char hex string (openssl rand -hex 32) or base64 of exactly 32 bytes",
  );
}
