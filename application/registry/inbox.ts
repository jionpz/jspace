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

  const files = readdirSync(inbox)
    .filter((n) => !n.startsWith("."))
    .map((n) => {
      const p = join(inbox, n);
      const st = statSync(p);
      return {
        name: n,
        size: st.size,
        mtime: st.mtime.toISOString(),
        dir: st.isDirectory(),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

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
