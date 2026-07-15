"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function TopNavLink({
  href,
  label,
  icon: Icon,
  onClick,
  stacked = false,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
  /** Vertical layout for mobile drawer */
  stacked?: boolean;
}) {
  const pathname = usePathname();
  const active =
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));

  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg text-sm font-medium transition-colors",
        stacked ? "w-full px-3 py-2.5" : "px-2.5 py-1.5",
        active
          ? "bg-zinc-900 text-white"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 opacity-80" />
      <span className="whitespace-nowrap">{label}</span>
    </Link>
  );
}

/** @deprecated Prefer TopNavLink — kept for any lingering imports */
export function NavLink(props: {
  href: string;
  label: string;
  icon: LucideIcon;
  onClick?: () => void;
}) {
  return <TopNavLink {...props} stacked />;
}
