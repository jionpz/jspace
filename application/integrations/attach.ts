// application/integrations/attach.ts — JStack project installation delegation.
// Explicit trusted checkout + registered repository only; no network fetching,
// shell interpolation, global installation, or repository ownership guessing.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import type { CmdResult } from "../commands/command.ts";
import { fail } from "../../core/shared/errors.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { isJstackReady, jstackStatus } from "./jstack.ts";

export type ExecResult = { exit: number; output: string; stdout?: string };
export type JStackRunner = (script: string, args: string[], cwd: string) => ExecResult;

export function runJstack(script: string, args: string[], cwd: string): ExecResult {
  const result = spawnSync(process.platform === "win32" ? "bash" : "/usr/bin/env",
    process.platform === "win32" ? [script, ...args] : ["bash", script, ...args],
    { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 1_048_576, shell: false });
  return {
    exit: result.error ? 1 : (result.status ?? 1),
    output: [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n").trim(),
    stdout: result.stdout ?? "",
  };
}
/** Doctor's exit status alone does NOT prove installation: on a bare Git repo
 * JStack doctor --json can legitimately exit 0 with an empty [] inventory.
 * Require the repo-local lock and the three project vendor records with
 * matching versions and lock=ok. Never accept global/cached installations. */
export function verifyJstackProject(repo: string, doctor: ExecResult): string[] {
  const problems: string[] = [];
  if (doctor.exit !== 0) problems.push(`JStack doctor exited with status ${doctor.exit}`);
  const meta = join(repo, ".jstack");
  const vendor = join(meta, "vendor", "plugins");
  const lockPath = join(meta, "lock.json");
  let lock: unknown;
  try {
    if (!lstatSync(meta).isDirectory() || lstatSync(meta).isSymbolicLink()) throw new Error(".jstack is not a regular directory");
    if (!lstatSync(lockPath).isFile() || lstatSync(lockPath).isSymbolicLink()) throw new Error("lock.json is not a regular file");
    lock = JSON.parse(readFileSync(lockPath, "utf8"));
  } catch {
    problems.push("missing, unreadable, symlinked or invalid project .jstack/lock.json");
  }
  const plugins = lock && typeof lock === "object" && !Array.isArray(lock)
    ? (lock as { plugins?: unknown }).plugins : null;
  if (!plugins || typeof plugins !== "object" || Array.isArray(plugins)) {
    problems.push("JStack project lock does not declare its plugins");
  }
  let rows: unknown;
  try { rows = JSON.parse(doctor.stdout ?? doctor.output); }
  catch { problems.push("JStack doctor output is not valid JSON"); }
  if (!Array.isArray(rows)) problems.push("JStack doctor output is not an inventory array");
  for (const name of ["flow", "spec", "pstack"]) {
    const expectedPath = join(vendor, name);
    const versionRecord = plugins && typeof plugins === "object"
      ? (plugins as Record<string, unknown>)[name] : undefined;
    const version = typeof versionRecord === "string" ? versionRecord
      : versionRecord && typeof versionRecord === "object" && !Array.isArray(versionRecord)
        ? (versionRecord as Record<string, unknown>).version : undefined;
    if (typeof version !== "string" || version.length === 0) {
      problems.push(`JStack project lock is missing ${name} version`);
    }
    try {
      if (!lstatSync(expectedPath).isDirectory() || lstatSync(expectedPath).isSymbolicLink()) {
        throw new Error("not a regular directory");
      }
    } catch {
      problems.push(`missing project vendor directory: ${name}`);
    }
    const matching = Array.isArray(rows) && rows.some((row) =>
      row !== null && typeof row === "object" && !Array.isArray(row)
      && row.harness === "vendor" && row.scope === "project"
      && row.plugin === name && row.path === expectedPath && row.lock === "ok"
      && row.version === version
    );
    if (!matching) problems.push(`JStack doctor did not confirm project vendor ${name} with lock=ok`);
  }
  return problems;
}

function repoTop(path: string): string {
  if (!existsSync(path) || !statSync(path).isDirectory()) fail(`Git repository directory does not exist: ${path}`);
  // Git for Windows may spell the very same root using 8.3 short names,
  // long names or different drive-letter casing than Node realpathSync.
  // Asking Git whether the current directory is below its own root avoids
  // brittle cross-runtime string comparisons while still rejecting subdirs.
  let prefix: string;
  try {
    prefix = execFileSync("git", ["-C", path, "rev-parse", "--show-prefix"], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    fail(`target is not an accessible Git repository: ${path}`);
  }
  if (prefix !== "") fail(`--repo must name the Git repository root, not a nested directory: ${path}`);
  return realpathSync(path);
}
function registeredRepository(root: string, repo: string): string {
  const reads = readWorkbenchState(root);
  if (reads.hub.status !== "ok" || reads.local.status !== "ok") {
    fail("workbench hub.json and machine-local bindings must be valid before attaching JStack");
  }
  const requested = repoTop(resolve(repo));
  if (requested === realpathSync(root)) fail("JStack must never be installed at the JWorkspace root; register and attach a separate software Git repository");
  const bindings = reads.local.value.bindings;
  const found = reads.hub.value.resources.some((resource) =>
    resource.entrypoints.some((ep) => {
      if (ep.kind !== "path" || ep.primary !== true) return false;
      const bound = bindings[ep.binding];
      if (bound === undefined || !existsSync(bound)) return false;
      try { return realpathSync(bound) === requested; }
      catch { return false; }
    }),
  );
  if (!found) {
    fail(`Git repository ${requested} is not a registered JSpace resource primary path; run 'jspace resource add ... --path ${requested}' first`);
  }
  return requested;
}
function trustedScript(source: string, repo: string): string {
  let absolute: string;
  try { absolute = realpathSync(resolve(source)); }
  catch { fail(`trusted JStack checkout does not exist or is inaccessible: ${source}`); }
  if (!statSync(absolute).isDirectory()) fail(`JStack checkout is not a directory: ${source}`);
  const within = (child: string, parent: string) => {
    const rel = relative(parent, child);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  if (within(absolute, repo) || within(repo, absolute)) {
    fail("JStack checkout and target repository must not overlap (source/target nesting risks rewriting the installer)");
  }
  const script = join(absolute, "jstack");
  if (!existsSync(script) || !lstatSync(script).isFile() || lstatSync(script).isSymbolicLink()) {
    fail(`expected a regular JStack CLI at ${script}`);
  }
  const text = readFileSync(script, "utf8");
  if (!text.startsWith("#!/usr/bin/env bash") || !text.includes("install_project") || !text.includes("cmd_doctor")) {
    fail(`source does not look like a JStack checkout: ${source}`);
  }
  if (["flow", "spec", "pstack"].some((name) => !existsSync(join(absolute, "plugins", name)))) {
    fail(`JStack source checkout lacks built plugin artifacts: ${source}`);
  }
  return script;
}

export interface AttachDeps {
  /** Test seam: no model, network or actual JStack process is required by tests. */
  runner?: JStackRunner;
  registeredRepo?: (workbench: string, repo: string) => string;
  locateScript?: (source: string, repo: string) => string;
}

export function attachJstack(
  workbench: string, repoArg: string, sourceArg: string, dryRun = false, deps: AttachDeps = {},
): CmdResult {
  // Production on Windows requires WSL: only explicit injected test runners
  // can bypass this platform guard (CLI never injects a runner).
  if (process.platform === "win32" && deps.runner === undefined) fail("JStack project installer currently needs a POSIX bash environment; use WSL for project attach");
  const status = jstackStatus(workbench);
  if (!status.enabled) {
    fail("JStack workbench integration is not enabled; run 'jspace integration enable jstack' first");
  }
  if (!isJstackReady(status)) {
    fail("JStack workbench bridge is unhealthy; repair it with 'jspace integration enable jstack' before attaching a repository");
  }
  const repo = (deps.registeredRepo ?? registeredRepository)(workbench, repoArg);
  const script = (deps.locateScript ?? trustedScript)(sourceArg, repo);
  const runner = deps.runner ?? runJstack;
  // JStack itself owns the plan and exact install writes. JSpace delegates it.
  const plan = runner(script, ["install", "--all", "--scope", "project", "--repo", repo, "--dry-run"], repo);
  if (plan.exit !== 0) {
    return { lines: ["jspace: JStack project installation dry-run failed", plan.output], exitCode: 1 };
  }
  if (dryRun) {
    return {
      lines: [`jspace: (dry-run) JStack project attach to ${repo}`, plan.output,
        "jspace: (dry-run) no project files changed; rerun without --dry-run to apply"],
    };
  }
  const applied = runner(script, ["install", "--all", "--scope", "project", "--repo", repo], repo);
  if (applied.exit !== 0) {
    return { lines: ["jspace: JStack project installation failed", applied.output], exitCode: 1 };
  }
  const verified = runner(script, ["doctor", "--repo", repo, "--json"], repo);
  const problems = verifyJstackProject(repo, verified);
  return {
    lines: [
      `jspace: JStack project installation completed for ${repo}`,
      applied.output,
      problems.length === 0
        ? "jspace: ok: JStack doctor confirmed project vendor flow/spec/pstack and matching lock (runtime phase enforcement not proven)"
        : "jspace: warning: JStack doctor could not confirm a healthy project installation",
      ...problems.map((problem) => `jspace: warning: ${problem}`),
      verified.output,
    ],
    ...(problems.length > 0 ? { exitCode: 1 } : {}),
  };
}
