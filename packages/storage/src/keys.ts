import { randomUUID } from "node:crypto";

/**
 * Sanitize a filename for use in an object key:
 * strip path separators, collapse whitespace, and keep a conservative charset.
 */
export function safeFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop()?.trim() || "file";
  const cleaned = base
    .replace(/[^\w.\-()+ ]+/g, "_")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-]+|[.\-]+$/g, "");
  return cleaned.slice(0, 180) || "file";
}

/**
 * Tenant-safe storage key:
 * `{companyId}/{yyyy}/{mm}/{uuid}-{safeFileName}`
 */
export function buildStorageKey(
  companyId: string,
  fileName: string,
  at: Date = new Date(),
): string {
  if (!companyId || companyId.includes("/") || companyId.includes("..")) {
    throw new Error("Invalid companyId for storage key");
  }
  const yyyy = String(at.getUTCFullYear());
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  return `${companyId}/${yyyy}/${mm}/${randomUUID()}-${safeFileName(fileName)}`;
}

/**
 * Assert that a storage key is scoped under the given company prefix.
 * Keys must start with `{companyId}/` (same prefix `buildStorageKey` uses).
 */
export function assertTenantStorageKey(companyId: string, key: string): void {
  if (!companyId || companyId.includes("/") || companyId.includes("..")) {
    throw new Error("Invalid companyId for storage key");
  }
  const prefix = `${companyId}/`;
  if (!key.startsWith(prefix)) {
    throw new Error(
      `Storage key is not under tenant prefix ${prefix}`,
    );
  }
}
