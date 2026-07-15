import { createHash } from "node:crypto";

/** SHA-256 hex digest of a Buffer or Uint8Array. */
export function sha256(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
