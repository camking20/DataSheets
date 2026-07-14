const FIELD_LABELS: Record<string, string> = {
  warningFraction: "Warning band",
  frequencyN: "Frequency",
  frequencyType: "Frequency type",
  partNumber: "Part number",
  lotNumber: "Lot number",
  lotSize: "Lot size",
  balloonNumber: "Balloon number",
  gageMethod: "Gage method",
  displayOrder: "Display order",
  partRevisionId: "Revision",
  dataSheetId: "Data sheet",
  dimensionId: "Dimension",
  sampleIndex: "Sample",
  companySlug: "Company slug",
  companyName: "Company name",
  email: "Email",
  password: "Password",
  name: "Name",
  nominal: "Nominal",
  usl: "USL",
  lsl: "LSL",
  unit: "Unit",
};

type ZodLikeIssue = {
  path?: Array<string | number>;
  message?: string;
  code?: string;
  minimum?: number | string;
  maximum?: number | string;
  type?: string;
};

function humanizePath(path: Array<string | number> | undefined): string | null {
  if (!path || path.length === 0) return null;
  const key = String(path[path.length - 1]);
  return FIELD_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function formatZodIssue(issue: ZodLikeIssue): string {
  const field = humanizePath(issue.path);
  const raw = (issue.message ?? "").trim();

  // Prefer clear custom messages from the schema
  if (
    raw &&
    !raw.startsWith("Number must be") &&
    !raw.startsWith("String must contain") &&
    !raw.startsWith("Required") &&
    !raw.startsWith("Expected ")
  ) {
    return field && !raw.toLowerCase().includes(field.toLowerCase())
      ? `${field}: ${raw}`
      : raw;
  }

  switch (issue.code) {
    case "too_big":
      if (issue.type === "number" && issue.maximum === 1 && pathIsWarning(issue.path)) {
        return "Warning band must be between 0% and 100% (e.g. 75 for 75%).";
      }
      return field
        ? `${field} is too large${issue.maximum != null ? ` (max ${issue.maximum})` : ""}.`
        : raw || "Value is too large.";
    case "too_small":
      return field
        ? `${field} is too small${issue.minimum != null ? ` (min ${issue.minimum})` : ""}.`
        : raw || "Value is too small.";
    case "invalid_type":
      return field ? `${field} has an invalid value.` : raw || "Invalid value.";
    default:
      return field && raw ? `${field}: ${raw}` : raw || "Invalid input.";
  }
}

function pathIsWarning(path: Array<string | number> | undefined): boolean {
  return path?.some((p) => p === "warningFraction") ?? false;
}

/**
 * Turn tRPC / Zod error payloads into short, human-readable copy for forms.
 */
export function formatApiError(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const message =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
        ? (err as { message: string }).message
        : null;

  if (!message) return fallback;

  const trimmed = message.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as ZodLikeIssue | ZodLikeIssue[];
      const issues = Array.isArray(parsed) ? parsed : [parsed];
      if (issues.length > 0 && (issues[0]?.message != null || issues[0]?.code != null)) {
        return issues.map(formatZodIssue).join(" ");
      }
    } catch {
      // not JSON — fall through
    }
  }

  return trimmed || fallback;
}
