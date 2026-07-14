import { createTRPCProxyClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import Constants from "expo-constants";
import superjson from "superjson";
import type { AppRouter } from "./api-types";
import { getToken } from "./auth";

/**
 * API base URL for the tRPC client.
 *
 * Production / TestFlight builds should use HTTPS (`https://…/trpc`).
 * Local development commonly uses plain HTTP against a LAN or localhost
 * address (e.g. `http://192.168.x.x:4000` or `http://localhost:4000`).
 * That is intentional and supported — do not force HTTPS in dev, or
 * physical-device debugging against your machine will break.
 *
 * iOS ATS: `app.json` sets `NSAllowsLocalNetworking` so local HTTP is
 * allowed on device/simulator during development.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  // http:// is OK for local/LAN dev; prefer https:// in production builds.
  const base = fromEnv ?? fromConfig ?? "http://localhost:4000/trpc";
  return base.endsWith("/trpc") ? base : `${base.replace(/\/$/, "")}/trpc`;
}

export const API_URL = resolveApiUrl();

export const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: API_URL,
      transformer: superjson,
      async headers() {
        const token = await getToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
      fetch: (url, options) => fetch(url as string, options as RequestInit),
    }),
  ],
});

/** Narrow an unknown catch value to a human-readable message for on-screen errors. */
export function trpcErrorMessage(error: unknown, fallback = "Something went wrong"): string {
  if (error instanceof TRPCClientError) {
    return error.message || fallback;
  }
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}
