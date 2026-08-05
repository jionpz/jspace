// application/workspace/init.ts — `jspace init` use case.
// Business logic moved out of cli/init.ts; environment-dependent bits
// (binary root, asset materialization, path resolution) are injected so this
// layer stays free of cli/env coupling.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "../errors.ts";
import type { CmdResult } from "../commands/command.ts";
import { MARKER_FILE } from "../../core/contracts/files.ts";
import {
  writeLocalAtomic,
  writeMarkerAtomic,
} from "../../adapters/fs/workbench-state.ts";
import type { LocalStateV1 } from "../../core/contracts/local.ts";
import type { WorkbenchMarkerV1 } from "../../core/contracts/workbench.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import { writeActualMaterializedJournal } from "./journal.ts";
import { materializedRel } from "./manifest.ts";
export { CONFIG_DIR };

export interface InitDeps {
  resolvePath: (p: string) => string;
  expandTilde: (p: string) => string;
  isCompiled: () => boolean;
  devRoot: () => string;
  /** Materialize the embedded workbench template + skills into target. */
  materialize: (target: string, devRootStr: string) => void;
  /** Bundle manifest, used to seed the materialization journal. */
  manifest: DistributionManifestV1;
}

/** Local calendar date YYYY-MM-DD (Python date.today().isoformat(); toISOString is UTC). */
function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function initWorkbench(
  targetArg: string | undefined,
  force: boolean,
  deps: InitDeps,
): CmdResult {
  const target = deps.resolvePath(deps.expandTilde(targetArg ?? "."));
  if (existsSync(target) && !statSync(target).isDirectory()) {
    fail(`target is not a directory: ${target}`);
  }
  if (existsSync(target) && readdirSync(target).length > 0 && !force) {
    fail(`target directory is not empty: ${target} (use --force to initialize anyway)`);
  }
  // init only creates new workbenches. An initialized workbench is never
  // re-materialized here — even with --force — because upgrade owns that path
  // (ownership + journal + rollback). --force still allows initializing into a
  // non-empty directory that is not a JSpace workbench.
  if (existsSync(join(target, MARKER_FILE))) {
    fail(`target is already a JSpace workbench: ${target} (use jspace workspace upgrade to update it)`);
  }
  // Legacy-layout residue guard: refuse to silently produce a double registry
  // (root hub.json/.jspace.json leftover next to the new .jspace/ layout).
  const legacyRoot = [join(target, "hub.json"), join(target, ".jspace.json")].some((p) =>
    existsSync(p),
  );
  if (legacyRoot && !existsSync(join(target, CONFIG_DIR, "marker.json"))) {
    fail(
      `legacy layout files present at ${target} (root hub.json/.jspace.json); remove them and re-run init`,
    );
  }

  // --force into a non-empty directory: never clobber existing files silently.
  // Back up each colliding template path to <rel>.jspace-bak (mirrors install.sh's
  // rc backup) and disclose it in the result — a destructive overwrite is always
  // recoverable and always announced.
  const backedUp: string[] = [];
  if (force) {
    for (const f of deps.manifest.files) {
      const rel = materializedRel(f.path);
      if (rel === null) continue;
      const p = join(target, rel);
      if (existsSync(p) && statSync(p).isFile()) {
        writeFileSync(`${p}.jspace-bak`, readFileSync(p));
        backedUp.push(rel);
      }
    }
  }

  mkdirSync(target, { recursive: true });
  deps.materialize(target, deps.devRoot());
  // .jspace/logs/ is a preallocated slot for execution logs (cron / headless);
  // materialize only writes files, so an empty dir must be created here.
  mkdirSync(join(target, CONFIG_DIR, "logs"), { recursive: true });

  // Portable marker v1: logical workbench identity + template provenance.
  const marker: WorkbenchMarkerV1 = {
    schema_version: 1,
    product: "JSpace",
    workbench_id: crypto.randomUUID(),
    template_version: deps.manifest.bundle_version,
    created_at: localDate(),
  };
  writeMarkerAtomic(target, marker);

  // Machine-local state v1 (gitignored): installation identity + bindings.
  const local: LocalStateV1 = {
    version: 1,
    installation_id: crypto.randomUUID(),
    bindings: {},
  };
  writeLocalAtomic(target, local);

  // Materialization journal: records the actual hashes of every materialized
  // file so workspace diff knows the applied base (gitignored, machine truth).
  writeActualMaterializedJournal(target, deps.manifest);

  const validateCmd = deps.isCompiled() ? "jspace" : join(deps.devRoot(), "bin", "jspace");
  return {
    lines: [
      `Initialized JSpace workbench at ${target}`,
      ...(backedUp.length > 0
        ? [`  note: backed up ${backedUp.length} pre-existing file(s) to <name>.jspace-bak: ${backedUp.join(", ")}`]
        : []),
      `Validate: ${validateCmd} doctor --dir ${target}`,
      "Next: read AGENTS.md, then follow skills/jspace-bootstrap/SKILL.md",
    ],
  };
}
