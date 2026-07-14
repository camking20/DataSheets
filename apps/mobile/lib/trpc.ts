import { createTRPCProxyClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import Constants from "expo-constants";
import superjson from "superjson";
import type { AppRouter } from "./api-types";
import { getToken } from "./auth";

function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
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
