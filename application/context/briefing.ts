// application/context/briefing.ts — machine state for session-start briefing.
//
// `.jspace/state/briefing.json` records the last time a session-start briefing
// was emitted. It is a best-effort machine state: `jspace context session-start`
// writes it after rendering, and doctor uses it to detect "session-start hooks
// are not actually running" (issue #13).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { isFile } from "../fs.ts";

export interface BriefingStateV1 {
  schema_version: 1;
  last_session_start_at: string;
  session_count: number;
}

export interface BriefingRead {
  state: BriefingStateV1 | null;
  issues: string[];
}

export const BRIEFING_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function briefingPath(root: string): string {
  return join(root, CONFIG_DIR, "state", "briefing.json");
}

/** Read the briefing state; missing/unreadable degrades to null + issues. */
export function readBriefing(root: string): BriefingRead {
  const p = briefingPath(root);
  if (!isFile(p)) return { state: null, issues: [] };
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as unknown;
    if (!raw || typeof raw !== "object") {
      return { state: null, issues: [`${p} is not an object`] };
    }
    const obj = raw as Record<string, unknown>;
    if (obj.schema_version !== 1 || typeof obj.last_session_start_at !== "string" || typeof obj.session_count !== "number") {
      return { state: null, issues: [`${p} has an unsupported shape; expected schema_version=1, last_session_start_at, session_count`] };
    }
    return {
      state: {
        schema_version: 1,
        last_session_start_at: obj.last_session_start_at,
        session_count: obj.session_count,
      },
      issues: [],
    };
  } catch (e) {
    return { state: null, issues: [`${p} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
}

/** Best-effort record of a session-start briefing. Never blocks hooks: callers
 *  should catch and ignore failures. */
export function touchBriefing(root: string, now: Date = new Date()): void {
  const prev = readBriefing(root);
  const next: BriefingStateV1 = {
    schema_version: 1,
    last_session_start_at: now.toISOString(),
    session_count: (prev.state?.session_count ?? 0) + 1,
  };
  writeBytesAtomic(briefingPath(root), JSON.stringify(next, null, 2) + "\n");
}

/** True when the briefing is missing, unreadable, or older than the stale
 *  threshold (doctor surfaces it as a warning). */
export function isBriefingStale(state: BriefingStateV1 | null, nowMs: number = Date.now()): boolean {
  if (!state) return true;
  const t = Date.parse(state.last_session_start_at);
  if (Number.isNaN(t)) return true;
  return nowMs - t > BRIEFING_STALE_MS;
}
