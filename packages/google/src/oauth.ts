import { google } from "googleapis";
import { getGoogleEnv } from "./env.js";
import {
  decryptRefreshToken,
  isEncryptedRefreshToken,
} from "./crypto.js";

/**
 * Scopes:
 * - drive.file: create/manage files & folders created by this app
 * - drive.metadata.readonly: read metadata for folder ops within app-created trees
 */
export const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
] as const;

/** OAuth2 client constructed via google.auth.OAuth2 (avoids dual google-auth-library type paths). */
export type GoogleOAuth2Client = InstanceType<typeof google.auth.OAuth2>;

export function createOAuthClient(
  redirectUri?: string,
): GoogleOAuth2Client {
  const env = getGoogleEnv();
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri ?? env.GOOGLE_REDIRECT_URI,
  );
}

/**
 * Build the Google consent URL.
 * Uses access_type=offline and prompt=consent so a refresh token is always returned.
 */
export function getAuthUrl(
  state: string,
  redirectUri?: string,
): string {
  const client = createOAuthClient(redirectUri);
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: [...GOOGLE_OAUTH_SCOPES],
    state,
  });
}

export type ExchangedTokens = {
  accessToken: string;
  refreshToken: string;
  expiryDate: number | null;
  idToken: string | null;
  scope: string | null;
};

/**
 * Exchange an authorization code for tokens.
 * Requires that the OAuth consent returned a refresh token (offline + consent).
 */
export async function exchangeCode(
  code: string,
  redirectUri?: string,
): Promise<ExchangedTokens> {
  const client = createOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token) {
    throw new Error("Google OAuth exchange did not return an access_token");
  }
  if (!tokens.refresh_token) {
    throw new Error(
      "Google OAuth exchange did not return a refresh_token; ensure access_type=offline and prompt=consent",
    );
  }

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date ?? null,
    idToken: tokens.id_token ?? null,
    scope: tokens.scope ?? null,
  };
}

/**
 * Build an authenticated OAuth2 client from a refresh token.
 * Accepts either an encryptRefreshToken() ciphertext or a plain refresh token.
 */
export function clientFromRefreshToken(
  encryptedOrPlain: string,
  redirectUri?: string,
): GoogleOAuth2Client {
  const refreshToken = isEncryptedRefreshToken(encryptedOrPlain)
    ? decryptRefreshToken(encryptedOrPlain)
    : encryptedOrPlain;

  const client = createOAuthClient(redirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}
