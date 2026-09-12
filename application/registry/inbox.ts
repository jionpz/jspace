// application/registry/inbox.ts — `jspace inbox status` use case (moved from cli/cmds.ts).
import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { CmdResult } from "../commands/command.ts";
import { resolveFilehubRoot } from "./filehub-lookup.ts";

/** Locate the inbox: filehub root/_inbox if registered and bound, else the
 *  degraded staging dir (<workbench>-inbox/) next to the workbench. Mirrors the
 *  asset-ingest skill's front-matter lookup. Returns null when neither exists. */
function locateInbox(root: string): string | null {
  const fhRoot = resolveFilehubRoot(root);
  if (fhRoot) return join(fhRoot, "_inbox");
  return join(dirname(root), `${basename(root)}-inbox`);
}

/** Resident contract files of a drop-zone inbox (top level, exact names): the
 *  STRUCTURE-contract README and an optional AGENTS.md routing note. Permanent
 *  fixtures by definition — counting them makes `filehub.inbox_unfiled` a
 *  warning that can never reach 0 (issue #38). */
const INBOX_RESIDENT_FILES = new Set(["README.md", "AGENTS.md"]);

/** Marker file that exempts a directory AND its contents from unfiled counting
 *  and batch tidying — the portable per-workbench opt-out (issue #38); no CLI
 *  directory whitelist, each workbench declares its own exceptions. */
const SKIP_INBOX_TIDY_MARKER = ".skip-inbox-tidy";

/** True when a top-level inbox entry is unfiled payload rather than structure
 *  (dot-entry, resident contract file, or a `.skip-inbox-tidy`-exempted dir).
 *  Single filter for counting, listing, doctor and the context hook so the
 *  consumers can never disagree about "how many". */
function isInboxPayload(inbox: string, name: string): boolean {
  if (name.startsWith(".")) return false;
  if (INBOX_RESIDENT_FILES.has(name)) return false;
  // A non-directory can't contain the marker (ENOTDIR → existsSync false).
  return !existsSync(join(inbox, name, SKIP_INBOX_TIDY_MARKER));
}

/** Single source for inbox-entry counting. Top-level entries only — matches the
 *  asset-ingest semantics where a subdirectory is filed wholesale as one item;
 *  structure excluded via `isInboxPayload`; capped to avoid a pathological inbox
 *  stalling hooks. `jspace inbox status`, doctor and the context hook all call
 *  this so the three never disagree about "how many". */
export function countInbox(dir: string): number {
  const MAX_INBOX_ENTRIES = 10000;
  let n = 0;
  for (const name of readdirSync(dir)) {
    if (n >= MAX_INBOX_ENTRIES) break;
    if (!isInboxPayload(dir, name)) continue;
    n += 1;
  }
  return n;
}

/** Read-only inbox listing (no semantic judgment). */
export function inboxStatus(root: string, json: boolean): CmdResult {
  const inbox = locateInbox(root);
  if (!inbox || !existsSync(inbox)) {
    if (json) {
      return { lines: [], data: { inbox: null, count: 0, files: [] } };
    }
    return {
      lines: ["jspace: ok: no inbox to process (filehub not registered and no degraded staging dir)"],
    };
  }

  // Stat each entry defensively: a dangling symlink (or an entry racing with a
  // sync client) must not take the whole listing down — skip what cannot be read.
  const files: { name: string; size: number; mtime: string; dir: boolean }[] = [];
  for (const n of readdirSync(inbox)) {
    if (!isInboxPayload(inbox, n)) continue;
    const p = join(inbox, n);
    try {
      const st = statSync(p);
      files.push({ name: n, size: st.size, mtime: st.mtime.toISOString(), dir: st.isDirectory() });
    } catch {
      continue;
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));

  if (json) {
    return { lines: [], data: { inbox, count: files.length, files } };
  }
  if (files.length === 0) {
    return { lines: ["jspace: ok: inbox is empty (nothing to do)"] };
  }
  const lines = [`jspace: inbox (${inbox}): ${files.length} file(s)`];
  for (const f of files) {
    lines.push(`  ${f.name}${f.dir ? "/" : ""}  ${f.size} B  ${f.mtime.slice(0, 10)}`);
  }
  return { lines };
}
