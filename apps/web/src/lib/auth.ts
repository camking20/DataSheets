const TOKEN_KEY = "ds_token";

/**
 * Thin localStorage wrapper for the session token. All access is guarded
 * for SSR since this module is imported by client components that may
 * still be evaluated during the server render pass.
 */
export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore write failures (private browsing, storage full, etc.)
  }
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}
