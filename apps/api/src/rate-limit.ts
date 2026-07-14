import { TRPCError } from "@trpc/server";

/** Sliding-window timestamps per key (IP+action, email+action, etc.). */
const windows = new Map<string, number[]>();

/**
 * Returns true if the request is allowed under the limit.
 * Prunes expired timestamps on each check.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const recent = (windows.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    windows.set(key, recent);
    return false;
  }
  recent.push(now);
  windows.set(key, recent);
  return true;
}

export function assertRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  message = "Too many requests. Try again later.",
): void {
  if (!checkRateLimit(key, limit, windowMs)) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message,
    });
  }
}

export const RATE_LIMIT_WINDOW_MS = 60_000;

export const AUTH_RATE_LIMITS = {
  loginPerIp: 10,
  loginPerEmail: 5,
  registerPerIp: 3,
} as const;
