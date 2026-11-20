// application/integrations/jstack.ts — optional workbench-level JStack bridge.
// Owns only JSpace's integration choice + a thin skill. The actual engineering
// workflow, hooks and version lock always belong to the target Git repository.
import {
  lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fail } from "../../core/shared/errors.ts";
import { sha256Of } from "../../core/shared/hash.ts";
import { decodeIntegrations, emptyIntegrations, type IntegrationsV1 } from "../../core/contracts/integrations.ts";
import type { FileRead, RegistryDiagnostic } from "../../core/contracts/diagnostics.ts";
import type { CmdResult } from "../commands/command.ts";
import { writeBytesAtomic, readMarker, formatJson } from "../../adapters/fs/workbench-state.ts";
import { withWorkbenchMutationLock } from "../lock.ts";
import { applyProjectionLinks } from "../workspace/projections.ts";
import { skillProjections } from "../workspace/manifest.ts";

export const JSTACK_SKILL_NAME = "jspace-jstack";
export const JSTACK_BRIDGE_ASSET = "skills/jspace-use/references/jstack-bridge.md";
const STATE_REL = ".jspace/integrations.json";
const SSOT_REL = `.jspace/skills/${JSTACK_SKILL_NAME}`;

function statePath(root: string): string {
  return join(root, STATE_REL);
}
function skillDir(root: string): string {
  return join(root, SSOT_REL);
}
function skillFile(root: string): string {
  return join(skillDir(root), "SKILL.md");
}
function sourceDigest(content: string): string {
  if (!content.startsWith("---\nname: jspace-jstack\n")) fail("embedded JStack integration skill is missing or invalid; rebuild the JSpace bundle");
  return sha256Of(content);
}
function present(path: string): boolean {
  try { lstatSync(path); return true; } catch { return false; }
}
function readText(path: string): string | null {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return readFileSync(path, "utf-8");
  } catch { return null; }
}

export function readIntegrations(root: string): FileRead<IntegrationsV1> {
  const path = statePath(root);
  if (!present(path)) return { status: "missing" }; // older workbenches: disabled by default
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) return {
    status: "invalid", issues: [{ code: "integrations.file-type", path: STATE_REL,
      message: "integrations.json must be a regular file, not a symlink or directory" }],
  };
  let json: unknown;
  try { json = JSON.parse(readFileSync(path, "utf-8")); }
  catch (e) {
    return { status: "invalid", issues: [{
      code: "integrations.parse", path: STATE_REL,
      message: `invalid integrations.json: ${(e as Error).message}`,
    }] };
  }
  const decoded = decodeIntegrations(json);
  return decoded.ok
    ? { status: "ok", value: decoded.value }
    : { status: "invalid", issues: decoded.issues };
}
function readRequiredState(root: string): IntegrationsV1 {
  const state = readIntegrations(root);
  if (state.status === "invalid") fail(`damaged ${STATE_REL}: ${state.issues.map((issue) => issue.message).join("; ")}; repair it before changing integrations`);
  return state.status === "missing" ? emptyIntegrations() : state.value;
}
function requireWorkbench(root: string): void {
  if (readMarker(root).status !== "ok") fail(`not an initialized JSpace workbench: ${root}`);
}
function writeState(root: string, state: IntegrationsV1): void {
  writeBytesAtomic(statePath(root), formatJson(state));
}

type ProjectionKind = "absent" | "link" | "copy" | "foreign";
function projectionPath(root: string, projection: string): string {
  return join(root, projection, JSTACK_SKILL_NAME);
}
/** Never replace a foreign harness skill just because its name collides. */
function projectionKind(root: string, projection: string, trustedDigests: readonly string[]): ProjectionKind {
  const entry = projectionPath(root, projection);
  if (!present(entry)) return "absent";
  const st = lstatSync(entry);
  if (st.isSymbolicLink()) {
    const target = resolve(dirname(entry), readlinkSync(entry));
    return target === resolve(skillDir(root)) ? "link" : "foreign";
  }
  if (st.isDirectory()) {
    const names = readdirSync(entry);
    if (names.length !== 1 || names[0] !== "SKILL.md") return "foreign";
    const content = readText(join(entry, "SKILL.md"));
    if (content !== null && trustedDigests.includes(sha256Of(content))) return "copy";
  }
  return "foreign";
}
function ensureSafeSkillPath(root: string, trustedDigests: readonly string[]): void {
  const dir = skillDir(root);
  if (!present(dir)) return;
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) {
    fail(`integration skill path is not a normal directory: ${dir}; refusing to replace it`);
  }
  const entries = readdirSync(dir);
  if (entries.length !== 1 || entries[0] !== "SKILL.md") {
    fail(`integration skill path has unowned files: ${dir}; refusing to overwrite it`);
  }
  const file = skillFile(root);
  if (lstatSync(file).isSymbolicLink()) {
    fail(`integration skill is a symlink: ${file}; refusing to overwrite it`);
  }
  const raw = readText(file);
  if (raw === null || !trustedDigests.includes(sha256Of(raw))) {
    fail(`integration skill has local edits: ${file}; preserving it (no silent overwrite)`);
  }
}
/** Refuse symlinked ancestor directories before touching a managed bridge.
 * A user may have .agents/skills linked to a shared/global directory; writing
 * there would escape the selected workbench even if the leaf does not exist. */
function ensureOwnedParentDirectories(root: string): void {
  // Mutation locks are acquired before writing integration state; their
  // ancestors must also stay inside the workbench (not external symlinks).
  const parents = new Set([".jspace", ".jspace/skills", ".jspace/state", ".jspace/state/locks"]);
  for (const projection of skillProjections()) {
    const parts = projection.split("/");
    for (let i = 1; i <= parts.length; i++) parents.add(parts.slice(0, i).join("/"));
  }
  for (const rel of parents) {
    const path = join(root, rel);
    if (!present(path)) continue;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(`JStack integration parent must be a normal directory inside the workbench: ${path}`);
    }
  }
}

/** Optional init is a two-step operation. Preflight collisions BEFORE
 * materializing the workbench so a conflict cannot leave a half-initialized
 * JWorkspace with a marker but no requested integration. */
export function preflightInitJstack(root: string, bridge: string): void {
  sourceDigest(bridge);
  if (present(join(root, ".jspace/marker.json"))) {
    fail(`target is already a JSpace workbench: ${root} (use jspace workspace upgrade to update it)`);
  }
  ensureOwnedParentDirectories(root);
  const reserved = [statePath(root), skillDir(root),
    ...skillProjections().map((projection) => projectionPath(root, projection))];
  for (const path of reserved) {
    if (present(path)) {
      fail(`JStack integration reserved path already exists: ${path}; refusing to overwrite during init`);
    }
  }
}

function preflightProjections(root: string, digests: readonly string[]): void {
  ensureOwnedParentDirectories(root);
  for (const proj of skillProjections()) {
    if (projectionKind(root, proj, digests) === "foreign") {
      fail(`integration skill name collision at ${projectionPath(root, proj)}; preserving the existing skill`);
    }
  }
}
function enabled(state: IntegrationsV1): boolean {
  return state.integrations.jstack?.enabled === true;
}

/** Enables or refreshes the bridge, preserving unrelated skill/harness content. */
export function enableJstack(root: string, bridge: string, dryRun = false): CmdResult {
  requireWorkbench(root);
  ensureOwnedParentDirectories(root); // before acquiring mutation lock
  const digest = sourceDigest(bridge);
  const run = (): CmdResult => {
    const state = readRequiredState(root);
    const old = state.integrations.jstack;
    const trustedDigests = [digest, ...(old?.enabled && old.bridge_sha256 ? [old.bridge_sha256] : [])];
    ensureSafeSkillPath(root, trustedDigests);
    preflightProjections(root, trustedDigests);
    const alreadyCurrent = old?.enabled === true
      && old.bridge_sha256 === digest
      && readText(skillFile(root)) === bridge
      && skillProjections().every((p) => projectionKind(root, p, trustedDigests) === "link");
    if (alreadyCurrent) return { lines: ["jspace: ok: JStack integration already enabled and current"] };
    if (dryRun) return { lines: [
      `jspace: (dry-run) would ${old?.enabled ? "refresh" : "enable"} JStack integration at ${root}`,
      `jspace: (dry-run) would materialize only ${SSOT_REL}/SKILL.md and project its skill links; no JStack repository is modified`,
    ] };
    mkdirSync(skillDir(root), { recursive: true });
    writeBytesAtomic(skillFile(root), bridge);
    // JSpace's existing thin-link engine remains the single writer for harness
    // projections; preflight above prevents it from converging a foreign skill.
    const projections = applyProjectionLinks(root, {
      skillNames: [JSTACK_SKILL_NAME],
      projectionDirs: skillProjections(),
      sweepResidue: false,
    });
    writeState(root, {
      schema_version: 1,
      integrations: { ...state.integrations, jstack: { enabled: true, bridge_sha256: digest } },
    });
    return {
      lines: [
        `jspace: ok: JStack integration ${old?.enabled ? "refreshed" : "enabled"} (workbench bridge only)`,
        `Next: jspace integration attach jstack --dir ${root} --repo <git-repo> --source <jstack-checkout> --dry-run`,
        ...projections.lines,
      ],
    };
  };
  return dryRun ? run() : withWorkbenchMutationLock(root, run);
}

/** Disabling the bridge cannot uninstall project-owned JStack installations. */
export function disableJstack(root: string, dryRun = false): CmdResult {
  requireWorkbench(root);
  ensureOwnedParentDirectories(root); // before acquiring mutation lock
  const run = (): CmdResult => {
    const state = readRequiredState(root);
    if (!enabled(state)) return { lines: ["jspace: ok: JStack integration already disabled"] };
    const digest = state.integrations.jstack!.bridge_sha256!;
    preflightProjections(root, [digest]); // no ambiguous cleanup of foreign links/copies
    if (dryRun) return { lines: [
      "jspace: (dry-run) would disable the JStack workbench bridge and its harness projections",
      "jspace: (dry-run) project-owned .jstack installations would remain untouched",
    ] };
    for (const proj of skillProjections()) {
      rmSync(projectionPath(root, proj), { recursive: true, force: true });
    }
    const current = readText(skillFile(root));
    const canRemove = current !== null && sha256Of(current) === digest
      && present(skillDir(root))
      && readdirSync(skillDir(root)).length === 1
      && !lstatSync(skillFile(root)).isSymbolicLink();
    if (canRemove) rmSync(skillDir(root), { recursive: true, force: true });
    writeState(root, {
      schema_version: 1,
      integrations: { ...state.integrations, jstack: { enabled: false } },
    });
    return {
      lines: ["jspace: ok: JStack integration disabled; project installations preserved"],
      ...(!canRemove && present(skillDir(root))
        ? { warnings: [`preserved locally modified/unowned skill files under ${skillDir(root)}; harness projections have been removed`] }
        : {}),
    };
  };
  return dryRun ? run() : withWorkbenchMutationLock(root, run);
}

/** Read-only plan for the optional bridge, included in workspace upgrade
 * --dry-run so a "nothing to do" bundle preview never hides a bridge rewrite. */
export function previewEnabledJstack(root: string, bridge: string): CmdResult {
  const state = readIntegrations(root);
  if (state.status === "invalid") {
    return { lines: [], warnings: [`JStack integration config is invalid: ${state.issues.map((i) => i.message).join("; ")}`], exitCode: 1 };
  }
  if (state.status !== "ok" || !enabled(state.value)) return { lines: [] };
  const status = jstackStatus(root, bridge);
  if (status.bridge === "current" && status.bundled_bridge_current === true &&
      Object.values(status.projections).every((kind) => kind === "link")) {
    return { lines: [] };
  }
  try {
    enableJstack(root, bridge, true); // check for collisions without writing
    return { lines: [
      "jspace: note: JStack integration bridge refresh or repair is available; run jspace integration enable jstack separately (workspace upgrade/rollback never changes optional bridge state)",
    ] };
  } catch (e) {
    return { lines: [], warnings: [`JStack bridge is preserved and needs manual attention: ${(e as Error).message}`] };
  }
}

export interface JStackStatus {
  enabled: boolean;
  state: "missing" | "invalid" | "ok";
  bridge: "absent" | "current" | "modified";
  bundled_bridge_current: boolean | null;
  parent_safe: boolean;
  projections: Record<string, ProjectionKind>;
}
export function jstackStatus(root: string, bridge?: string): JStackStatus {
  const state = readIntegrations(root);
  const on = state.status === "ok" && enabled(state.value);
  const fingerprint = on ? state.value.integrations.jstack!.bridge_sha256! : undefined;
  const source = readText(skillFile(root));
  const current = source !== null && fingerprint !== undefined && sha256Of(source) === fingerprint;
  const projections = Object.fromEntries(skillProjections().map((p) => [p, projectionKind(root, p, fingerprint ? [fingerprint] : [])])) as Record<string, ProjectionKind>;
  let parentSafe = true;
  try { ensureOwnedParentDirectories(root); } catch { parentSafe = false; }
  return {
    enabled: on,
    state: state.status,
    bridge: source === null ? "absent" : current ? "current" : "modified",
    bundled_bridge_current: bridge === undefined || !on ? null : fingerprint === sha256Of(bridge),
    parent_safe: parentSafe,
    projections,
  };
}

export function jstackIntegrationStatus(root: string, bridge: string, json = false): CmdResult {
  requireWorkbench(root);
  const state = readIntegrations(root);
  const status = jstackStatus(root, bridge);
  if (state.status === "invalid") {
    return {
      lines: ["jspace: error: integration config invalid"],
      errors: state.issues.map((i) => i.message),
      exitCode: 1,
      data: status,
    };
  }
  const ready = status.enabled && status.parent_safe && status.bridge === "current"
    && Object.values(status.projections).every((k) => k === "link" || k === "copy");
  const outdated = ready && status.bundled_bridge_current === false;
  return {
    lines: json ? [] : [
      `jspace: JStack integration ${status.enabled ? (ready ? (outdated ? "enabled (bridge update available)" : "enabled") : "unhealthy") : "disabled"}`,
      `bridge: ${status.bridge}; bundled-current: ${status.bundled_bridge_current === null ? "n/a" : status.bundled_bridge_current}; projections: ${Object.entries(status.projections).map(([p, kind]) => `${p}=${kind}`).join(", ")}`,
    ],
    data: status,
    ...(status.enabled && !ready ? { exitCode: 1 } : {}),
  };
}

/** Purely local checks; never spawn JStack, read remote data, or touch a repo. */
export function checkJstackIntegration(root: string): RegistryDiagnostic[] {
  const state = readIntegrations(root);
  // Old workbenches without integrations.json are disabled by default. A
  // leftover bridge is still hazardous: harnesses would continue loading it.
  if (state.status === "missing") {
    const status = jstackStatus(root);
    return status.bridge === "absent" && Object.values(status.projections).every((p) => p === "absent")
      ? []
      : [{ severity: "warning", code: "integrations.jstack.untracked-residue", path: SSOT_REL,
        message: "integration config is missing but JStack bridge/projections remain; inspect workbench skill ownership" }];
  }
  if (state.status === "invalid") return state.issues.map((i) => ({
    severity: "error", code: i.code, path: i.path, message: i.message,
  }));
  const on = enabled(state.value);
  const status = jstackStatus(root);
  const findings: RegistryDiagnostic[] = [];
  if (!on) {
    if (status.bridge !== "absent" || Object.values(status.projections).some((p) => p !== "absent")) {
      findings.push({
        severity: "warning", code: "integrations.jstack.disabled-residue", path: SSOT_REL,
        message: "JStack integration disabled but bridge files or harness projections remain; inspect and remove only proven JSpace-owned files",
      });
    }
    return findings;
  }
  if (!status.parent_safe) {
    findings.push({
      severity: "error", code: "integrations.jstack.parent-unsafe", path: SSOT_REL,
      message: "JStack workbench bridge has a symlinked or non-directory parent; stop and inspect workbench ownership before continuing",
    });
  }
  if (status.bridge !== "current") {
    findings.push({
      severity: "error", code: "integrations.jstack.bridge-invalid", path: `${SSOT_REL}/SKILL.md`,
      message: "enabled JStack integration bridge is absent or locally modified; repair with 'jspace integration enable jstack' after reviewing edits",
    });
  }
  for (const [proj, kind] of Object.entries(status.projections)) {
    if (kind === "absent" || kind === "foreign") {
      findings.push({
        severity: "error", code: "integrations.jstack.projection-invalid", path: `${proj}/${JSTACK_SKILL_NAME}`,
        message: `enabled JStack bridge projection is ${kind}; inspect the collision before re-enabling`,
      });
    }
    if (kind === "copy") {
      findings.push({
        severity: "info", code: "integrations.jstack.copy-fallback", path: `${proj}/${JSTACK_SKILL_NAME}`,
        message: "JStack bridge projection uses a visible copy fallback (symlink unavailable)",
      });
    }
  }
  return findings;
}

/** Include an enabled optional bridge in the official skill/orphan inventory. */
export function enabledIntegrationSkillNames(root: string): string[] {
  const state = readIntegrations(root);
  return state.status === "ok" && enabled(state.value) ? [JSTACK_SKILL_NAME] : [];
}
