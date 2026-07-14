"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc";
import { clearToken, getToken } from "@/lib/auth";
import type { MembershipRole, MembershipRow, SessionUser } from "@/lib/api-types";

export interface MeResult {
  user: SessionUser;
  companyId: string | null;
  companyName: string | null;
  role: MembershipRole | null;
  memberships: MembershipRow[];
}

export function useSession() {
  const router = useRouter();
  const hasToken = typeof window !== "undefined" && !!getToken();

  const query = trpc.auth.me.useQuery(undefined, {
    enabled: hasToken,
    retry: false,
  });

  const utils = trpc.useUtils();
  const logoutMutation = trpc.auth.logout.useMutation();

  useEffect(() => {
    if (!query.isError) return;
    clearToken();
    router.replace("/login");
  }, [query.isError, router]);

  async function logout() {
    try {
      await logoutMutation.mutateAsync();
    } catch {
      // token may already be invalid server-side — clear locally regardless
    }
    clearToken();
    utils.invalidate();
    router.push("/login");
  }

  const me = query.data as MeResult | undefined;

  return {
    isAuthenticated: hasToken && !query.isError && !!me,
    isLoading: hasToken ? query.isLoading : false,
    hasToken,
    me,
    error: query.error,
    logout,
  };
}
