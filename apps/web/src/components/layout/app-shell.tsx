"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Boxes,
  ClipboardPlus,
  FileStack,
  LogOut,
  Menu,
  X,
  Loader2,
} from "lucide-react";
import { NavLink } from "./nav-link";
import { useSession } from "@/hooks/use-session";
import { clearToken, getToken } from "@/lib/auth";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/parts", label: "Parts", icon: Boxes },
  { href: "/inspect", label: "Inspect", icon: ClipboardPlus },
  { href: "/sheets", label: "Sheets", icon: FileStack },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, isLoading, me, logout, hasToken } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

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
      <div className="flex">
        <aside className="hidden w-60 shrink-0 flex-col border-r border-zinc-200 bg-white lg:flex">
          <SidebarContent me={me} onLogout={logout} />
        </aside>

        {mobileOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div
              className="absolute inset-0 bg-black/30"
              onClick={() => setMobileOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
              <div className="flex items-center justify-end p-3">
                <button
                  onClick={() => setMobileOpen(false)}
                  className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100"
                  aria-label="Close menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <SidebarContent me={me} onLogout={logout} onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        ) : null}

        <div className="flex min-h-screen flex-1 flex-col">
          <header className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-4 lg:hidden">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-xs font-bold text-white">
                DS
              </span>
              <span className="text-sm font-semibold">DataSheets</span>
            </div>
            <div className="w-8" />
          </header>

          <main className="flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
        </div>
      </div>
    </div>
  );
}

function SidebarContent({
  me,
  onLogout,
  onNavigate,
}: {
  me: { user: { name: string; email: string }; companyName: string | null } | undefined;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="flex h-14 items-center gap-2 border-b border-zinc-200 px-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-900 text-xs font-bold text-white">
          DS
        </span>
        <span className="text-sm font-semibold tracking-tight">DataSheets</span>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV_ITEMS.map((item) => (
          <NavLink key={item.href} {...item} onClick={onNavigate} />
        ))}
      </nav>

      <div className="border-t border-zinc-200 p-3">
        <div className="mb-2 rounded-lg bg-zinc-50 px-3 py-2">
          <p className="truncate text-xs font-medium uppercase tracking-wide text-zinc-400">
            {me?.companyName ?? "Company"}
          </p>
          <p className="truncate text-sm font-medium text-zinc-900">
            {me?.user?.name ?? "—"}
          </p>
          <p className="truncate text-xs text-zinc-500">{me?.user?.email ?? ""}</p>
        </div>
        <button
          onClick={onLogout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </>
  );
}
