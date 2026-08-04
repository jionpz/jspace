// application/workspace/workspace.ts — `jspace workspace diff|upgrade` use cases.
// manifest + assets are injected so the layer stays free of the embedded-bundle
// cli module. Filesystem writes go through injected writeFile for testability
// (failure injection) and are preceded by backup + journal in .jspace/state/.
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail } from "../errors.ts";
import type { CmdResult } from "../commands/command.ts";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import { readMarker, writeMarkerAtomic } from "../../adapters/fs/workbench-state.ts";
import { CONFIG_DIR } from "../../core/contracts/files.ts";
import { diffBundle, materializedRel } from "./manifest.ts";
import { readMaterializedJournal, writeActualMaterializedJournal } from "./journal.ts";

function safeReadFile(p: string): string | null {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
}

function setTemplateVersion(root: string, version: string): void {
  const marker = readMarker(root);
  if (marker.status !== "ok") fail("not an initialized JSpace workbench (missing .jspace/marker.json)");
  writeMarkerAtomic(root, { ...marker.value, template_version: version });
}

// ---- workspace diff --------------------------------------------------------

export function workspaceDiff(
  root: string,
  manifest: DistributionManifestV1,
  json: boolean,
): CmdResult {
  const recorded = readMaterializedJournal(root)?.files ?? {};
  const entries = diffBundle(root, manifest, { readFile: safeReadFile, recorded });
  if (json) {
    return { lines: [], data: { bundle_version: manifest.bundle_version, entries } };
  }
  return {
    lines: entries.length === 0
      ? ["jspace: ok: workspace is up to date"]
      : entries.map((e) => `[${e.action}] ${e.rel} (${e.reason})`),
  };
}

// ---- workspace upgrade -----------------------------------------------------

export interface UpgradeDeps {
  manifest: DistributionManifestV1;
  /** bundle key -> raw content (from the embedded ASSETS map) */
  assets: Record<string, string>;
  readFile: (p: string) => string | null;
  writeFile: (p: string, content: string) => void;
}

export interface UpgradeOptions {
  dryRun: boolean;
  acceptConflicts: boolean;
  rollbackId?: string;
}

interface UpgradeJournal {
  id: string;
  from_version: string;
  to_version: string;
  plan: { action: string; rel: string }[];
  status: "pending" | "applied" | "failed" | "rolled_back";
}

function upgradeJournalPath(root: string, id: string): string {
  return join(root, CONFIG_DIR, "state", "upgrades", id, "journal.json");
}

function writeUpgradeJournal(root: string, id: string, journal: UpgradeJournal): void {
  const p = upgradeJournalPath(root, id);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(journal, null, 2) + "\n", "utf-8");
}

function rollbackUpgrade(root: string, id: string, deps: UpgradeDeps): CmdResult {
  const journalPath = upgradeJournalPath(root, id);
  if (!existsSync(journalPath)) fail(`no upgrade journal: ${id}`);
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as UpgradeJournal;
  const backupDir = join(root, CONFIG_DIR, "state", "upgrades", id);
  for (const step of journal.plan) {
    const beforePath = join(backupDir, "before", step.rel);
    if (existsSync(beforePath)) {
      deps.writeFile(join(root, step.rel), readFileSync(beforePath, "utf-8"));
    } else if (step.action === "create") {
      // created during the failed/applied upgrade and never backed up -> remove
      try {
        unlinkSync(join(root, step.rel));
      } catch {
        /* best-effort */
      }
    }
  }
  writeActualMaterializedJournal(root, deps.manifest);
  setTemplateVersion(root, journal.from_version);
  writeUpgradeJournal(root, id, { ...journal, status: "rolled_back" });
  return { lines: [`jspace: ok: rolled back workspace upgrade ${id}`] };
}

export function workspaceUpgrade(
  root: string,
  opts: UpgradeOptions,
  deps: UpgradeDeps,
): CmdResult {
  if (opts.rollbackId !== undefined) return rollbackUpgrade(root, opts.rollbackId, deps);

  const recorded = readMaterializedJournal(root)?.files ?? {};
  const entries = diffBundle(root, deps.manifest, { readFile: deps.readFile, recorded });
  const conflicts = entries.filter((e) => e.action === "conflict");
  const plan = entries.filter(
    (e) =>
      e.action === "create" ||
      e.action === "update" ||
      // --accept-conflicts overwrites locally modified managed files, EXCEPT
      // skills/: a user's workbench skill edit is always preserved (reported
      // as conflict in diff, never force-overwritten). Unmodified skills still
      // refresh on upgrade (skills are managed since Child D).
      (e.action === "conflict" && opts.acceptConflicts && !e.rel.startsWith("skills/")),
  );

  if (opts.dryRun) {
    const changes = entries.filter(
      (e) => e.action === "create" || e.action === "update" || e.action === "conflict",
    );
    const lines = changes.length === 0
      ? ["jspace: ok: would upgrade: nothing to do"]
      : [`jspace: ok: would upgrade ${changes.length} file(s):`, ...changes.map((e) => `[${e.action}] ${e.rel}`)];
    return { lines };
  }
  if (conflicts.length > 0 && !opts.acceptConflicts) {
    fail(
      `workspace upgrade: ${conflicts.length} conflict(s) in: ${conflicts.map((e) => e.rel).join(", ")} (use --accept-conflicts to override)`,
    );
  }
  if (plan.length === 0) {
    return { lines: ["jspace: ok: workspace is up to date"] };
  }

  // backup + journal before any mutation
  const marker = readMarker(root);
  if (marker.status !== "ok") fail("not an initialized JSpace workbench (missing .jspace/marker.json)");
  const id = crypto.randomUUID();
  const backupDir = join(root, CONFIG_DIR, "state", "upgrades", id);
  const journal: UpgradeJournal = {
    id,
    from_version: marker.value.template_version,
    to_version: deps.manifest.bundle_version,
    plan: plan.map((e) => ({ action: e.action, rel: e.rel })),
    status: "pending",
  };
  writeUpgradeJournal(root, id, journal);
  for (const e of plan) {
    const cur = deps.readFile(join(root, e.rel));
    if (cur !== null) {
      const p = join(backupDir, "before", e.rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, cur, "utf-8");
    }
  }

  const pathByRel = new Map<string, string>();
  for (const f of deps.manifest.files) {
    const rel = materializedRel(f.path);
    if (rel !== null) pathByRel.set(rel, f.path);
  }

  try {
    for (const e of plan) {
      const key = pathByRel.get(e.rel);
      const content = key !== undefined ? deps.assets[key] : undefined;
      if (content === undefined) throw new Error(`missing bundle asset for ${e.rel}`);
      deps.writeFile(join(root, e.rel), content);
    }
    writeActualMaterializedJournal(root, deps.manifest);
    setTemplateVersion(root, deps.manifest.bundle_version);
    writeUpgradeJournal(root, id, { ...journal, status: "applied" });
  } catch (e) {
    writeUpgradeJournal(root, id, { ...journal, status: "failed" });
    fail(`workspace upgrade failed (recover with: jspace workspace upgrade --rollback ${id}): ${(e as Error).message}`);
  }

  return {
    lines: [
      `jspace: ok: upgraded workspace to ${deps.manifest.bundle_version} (${plan.length} file(s) changed)`,
      `Upgrade journal: ${id} (restore with: jspace workspace upgrade --rollback ${id})`,
      `Validate: jspace doctor --dir ${root}`,
    ],
  };
}
