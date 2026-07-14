import { Badge } from "./badge";
import { titleCase } from "@/lib/utils";
import type { RevisionStatus, SheetStatus } from "@/lib/api-types";

const revisionTone: Record<RevisionStatus, "neutral" | "emerald" | "amber"> = {
  draft: "amber",
  released: "emerald",
  superseded: "neutral",
};

const sheetTone: Record<SheetStatus, "neutral" | "emerald" | "amber"> = {
  in_progress: "amber",
  completed: "emerald",
  abandoned: "neutral",
};

export function RevisionStatusPill({ status }: { status: RevisionStatus }) {
  return <Badge tone={revisionTone[status]}>{titleCase(status)}</Badge>;
}

export function SheetStatusPill({ status }: { status: SheetStatus }) {
  return <Badge tone={sheetTone[status]}>{titleCase(status)}</Badge>;
}
