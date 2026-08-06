// core/shared/hash.ts — shared SHA-256 helpers (bytes base + string wrapper).
// Single implementation shared by the application layer (string content hash)
// and the cli layer (binary checksum); the two entry signatures preserve the
// former callers.
import { createHash } from "node:crypto";

/** SHA-256 hex digest of raw bytes (binary-safe). */
export function sha256OfBytes(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

/** SHA-256 hex digest of a UTF-8 string. */
export function sha256Of(content: string): string {
  return sha256OfBytes(Buffer.from(content, "utf-8"));
}
