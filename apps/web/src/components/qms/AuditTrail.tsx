import { cn, formatDateTime, titleCase } from "@/lib/utils";

export interface AuditTrailEntry {
  createdAt: string | Date;
  actorName?: string | null;
  action: string;
  metadata?: Record<string, unknown> | null;
}

export interface AuditTrailProps {
  entries: AuditTrailEntry[];
  className?: string;
  emptyMessage?: string;
}

function formatAction(action: string): string {
  return titleCase(action.replace(/[.:]/g, " "));
}

function formatMetadata(metadata: Record<string, unknown>): string {
  const parts = Object.entries(metadata)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => {
      const value =
        typeof v === "string" || typeof v === "number" || typeof v === "boolean"
          ? String(v)
          : JSON.stringify(v);
      return `${titleCase(k)}: ${value}`;
    });
  return parts.join(" · ");
}

export function AuditTrail({
  entries,
  className,
  emptyMessage = "No audit events yet.",
}: AuditTrailProps) {
  if (entries.length === 0) {
    return (
      <p className={cn("text-sm text-zinc-400", className)}>{emptyMessage}</p>
    );
  }

  return (
    <ol className={cn("relative space-y-0", className)}>
      {entries.map((entry, index) => {
        const meta =
          entry.metadata && Object.keys(entry.metadata).length > 0
            ? formatMetadata(entry.metadata)
            : null;
        const key = `${entry.createdAt}-${entry.action}-${index}`;

        return (
          <li key={key} className="relative flex gap-3 pb-5 last:pb-0">
            {index < entries.length - 1 ? (
              <span
                className="absolute left-[7px] top-3 bottom-0 w-px bg-zinc-200"
                aria-hidden
              />
            ) : null}
            <span
              className="relative mt-1.5 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-white bg-zinc-300 ring-1 ring-zinc-200"
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium text-zinc-900">
                  {formatAction(entry.action)}
                </span>
                <time
                  className="text-xs text-zinc-400"
                  dateTime={
                    typeof entry.createdAt === "string"
                      ? entry.createdAt
                      : entry.createdAt.toISOString()
                  }
                >
                  {formatDateTime(entry.createdAt)}
                </time>
              </div>
              <p className="mt-0.5 text-sm text-zinc-500">
                {entry.actorName?.trim() || "System"}
              </p>
              {meta ? (
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">{meta}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
