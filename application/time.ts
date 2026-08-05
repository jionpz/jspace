// application/time.ts — local calendar time helpers (single source).
// Python date.today().isoformat() semantics: toISOString() is UTC, not local.

/** Local calendar date YYYY-MM-DD. */
export function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local timestamp YYYY-MM-DDTHHMMSS (single Date: no midnight straddle). */
export function localStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}
