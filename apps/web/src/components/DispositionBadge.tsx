import { cn } from "@/lib/utils";
import type { Disposition } from "@/lib/api-types";

const styles: Record<Disposition, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  yellow: "bg-amber-50 text-amber-700 ring-amber-200",
  red: "bg-rose-50 text-rose-700 ring-rose-200",
};

const dotStyles: Record<Disposition, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-rose-500",
};

const labels: Record<Disposition, string> = {
  green: "In spec",
  yellow: "Warning",
  red: "Out of spec",
};

export function DispositionBadge({
  disposition,
  className,
  compact = false,
}: {
  disposition: Disposition;
  className?: string;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        styles[disposition],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotStyles[disposition])} />
      {compact ? null : labels[disposition]}
    </span>
  );
}

export function DispositionDot({ disposition, className }: { disposition: Disposition; className?: string }) {
  return <span className={cn("h-2.5 w-2.5 rounded-full", dotStyles[disposition], className)} />;
}
