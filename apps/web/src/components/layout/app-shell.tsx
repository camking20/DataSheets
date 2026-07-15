"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Boxes,
  ClipboardPlus,
  FileStack,
  FileText,
  GitBranch,
  Factory,
  Route,
  ShieldAlert,
  Settings,
  LogOut,
  Menu,
  X,
  Loader2,
} from "lucide-react";
import { TopNavLink } from "./nav-link";
import { useSession } from "@/hooks/use-session";
import { clearToken, getToken } from "@/lib/auth";
import type { MembershipRole } from "@/lib/api-types";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const CORE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/parts", label: "Parts", icon: Boxes },
  { href: "/documents", label: "Documents", icon: FileText },
  { href: "/routings", label: "Routings", icon: Route },
  { href: "/changes", label: "Change Control", icon: GitBranch },
  { href: "/shop", label: "Shop", icon: Factory },
  { href: "/inspect", label: "Inspect", icon: ClipboardPlus },
  { href: "/sheets", label: "Sheets", icon: FileStack },
  { href: "/quality/nc", label: "Quality", icon: ShieldAlert },
  { href: "/settings/integrations", label: "Settings", icon: Settings },
];

/** Operators get Shop + Inspect near the front. */
function navItemsForRole(role: MembershipRole | null | undefined): NavItem[] {
  if (role === "operator") {
    return [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/shop", label: "Shop", icon: Factory },
      { href: "/inspect", label: "Inspect", icon: ClipboardPlus },
      { href: "/sheets", label: "Sheets", icon: FileStack },
      { href: "/parts", label: "Parts", icon: Boxes },
      { href: "/documents", label: "Documents", icon: FileText },
      { href: "/quality/nc", label: "Quality", icon: ShieldAlert },
      { href: "/settings/integrations", label: "Settings", icon: Settings },
    ];
  }
  return CORE_NAV;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, me, logout, hasToken } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const items = useMemo(() => navItemsForRole(me?.role), [me?.role]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!getToken()) {
      router.replace("/login");
      return;
    }
    if (!isLoading && !isAuthenticated) {
      clearToken();
      router.replace("/login");
    }
  }, [router, isLoading, isAuthenticated]);

  if (!hasToken || isLoading || !isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8f8f7]">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8f8f7]">
      <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:px-6">
          <div className="flex shrink-0 items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-xs font-bold text-white">
              DS
            </span>
            <span className="hidden text-sm font-semibold tracking-tight sm:inline">
              DataSheets
            </span>
          </div>

          <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto lg:flex">
            {items.map((item) => (
              <TopNavLink key={item.href} {...item} />
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden text-right sm:block">
              <p className="truncate text-xs font-medium text-zinc-900">
                {me?.user?.name ?? "—"}
              </p>
              <p className="truncate text-[11px] text-zinc-500">
                {me?.companyName ?? "Company"}
                {me?.role ? ` · ${me.role}` : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 sm:inline-flex"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden xl:inline">Sign out</span>
            </button>
            <button
              type="button"
              className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 lg:hidden"
              aria-label="Open menu"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute inset-x-0 top-0 border-b border-zinc-200 bg-white shadow-lg">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-sm font-semibold">Menu</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex flex-col gap-0.5 px-3 pb-3">
              {items.map((item) => (
                <TopNavLink
                  key={item.href}
                  {...item}
                  stacked
                  onClick={() => setMobileOpen(false)}
                />
              ))}
            </nav>
            <div className="border-t border-zinc-100 px-4 py-3">
              <p className="text-sm font-medium text-zinc-900">
                {me?.user?.name ?? "—"}
              </p>
              <p className="text-xs text-zinc-500">{me?.user?.email ?? ""}</p>
              <button
                type="button"
                onClick={logout}
                className="mt-3 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <main className="mx-auto max-w-[1600px] flex-1 p-4 sm:p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
