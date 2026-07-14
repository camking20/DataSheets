import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import { clearToken, getToken } from "./auth";
import type { AppRouter } from "./api-types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export const trpc = createTRPCReact<AppRouter>();

function isUnauthorizedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const data = (err as { data?: { code?: string } }).data;
  return data?.code === "UNAUTHORIZED";
}

/**
 * Clears the session token and sends the browser to /login when any
 * procedure returns UNAUTHORIZED. Skips redirect on auth pages so failed
 * login/register attempts can still surface their own errors.
 */
const unauthorizedLink: TRPCLink<AppRouter> = () => {
  return ({ next, op }) => {
    return observable((observer) => {
      const unsubscribe = next(op).subscribe({
        next(value) {
          observer.next(value);
        },
        error(err) {
          if (typeof window !== "undefined" && isUnauthorizedError(err)) {
            clearToken();
            const path = window.location.pathname;
            if (path !== "/login" && path !== "/register") {
              window.location.assign("/login");
            }
          }
          observer.error(err);
        },
        complete() {
          observer.complete();
        },
      });
      return unsubscribe;
    });
  };
};

export function makeTrpcClient() {
  return trpc.createClient({
    links: [
      unauthorizedLink,
      httpBatchLink({
        url: `${API_URL}/trpc`,
        transformer: superjson,
        headers() {
          const token = getToken();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  });
}
