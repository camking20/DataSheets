import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/utils";

/** Document revision lifecycle statuses (QMS). */
export type DocStatus =
  | "draft"
  | "in_review"
  | "released"
  | "superseded"
  | "obsolete";

const statusTone: Record<DocStatus, "neutral" | "emerald" | "amber" | "rose" | "sky"> = {
  draft: "amber",
  in_review: "sky",
  released: "emerald",
  superseded: "neutral",
  obsolete: "rose",
};

export function DocStatusPill({
  status,
  className,
}: {
  status: DocStatus;
  className?: string;
}) {
  return (
    <Badge tone={statusTone[status]} className={className}>
      {titleCase(status)}
    </Badge>
  );
}
