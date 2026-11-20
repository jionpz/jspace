// application/integrations/attach.ts — JStack project installation delegation.
// Explicit trusted checkout + registered repository only; no network fetching,
// shell interpolation, global installation, or repository ownership guessing.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import type { CmdResult } from "../commands/command.ts";
import { fail } from "../../core/shared/errors.ts";
import { readWorkbenchState } from "../../adapters/fs/workbench-state.ts";
import { readIntegrations } from "./jstack.ts";

export type ExecResult = { exit: number; output: string };
export type JStackRunner = (script: string, args: string[], cwd: string) => ExecResult;

export function runJstack(script: string, args: string[], cwd: string): ExecResult {
  const result = spawnSync(process.platform === "win32" ? "bash" : "/usr/bin/env",
    process.platform === "win32" ? [script, ...args] : ["bash", script, ...args],
    { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 1_048_576, shell: false });
  return {
    exit: result.error ? 1 : (result.status ?? 1),
    output: [result.stdout, result.stderr, result.error?.message].filter(Boolean).join("\n").trim(),
  };
}
function repoTop(path: string): string {
  if (!existsSync(path) || !statSync(path).isDirectory()) fail(`Git repository directory does not exist: ${path}`);
  let top: string;
  try {
    top = execFileSync("git", ["-C", path, "rev-parse", "--show-toplevel"], {
      encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    fail(`target is not an accessible Git repository: ${path}`);
  }
  const real = realpathSync(path);
  const actualTop = realpathSync(top);
  if (real !== actualTop) fail(`--repo must name the Git repository root, not a nested directory: ${path}`);
  return actualTop;
}
function registeredRepository(root: string, repo: string): string {
  const reads = readWorkbenchState(root);
  if (reads.hub.status !== "ok" || reads.local.status !== "ok") {
    fail("workbench hub.json and machine-local bindings must be valid before attaching JStack");
  }
  const requested = repoTop(resolve(repo));
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
  if (process.platform === "win32") fail("JStack project installer currently needs a POSIX bash environment; use WSL for project attach");
  const state = readIntegrations(workbench);
  if (state.status !== "ok" || state.value.integrations.jstack?.enabled !== true) {
    fail("JStack workbench integration is not enabled; run 'jspace integration enable jstack' first");
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
  return {
    lines: [
      `jspace: JStack project installation completed for ${repo}`,
      applied.output,
      verified.exit === 0
        ? "jspace: ok: JStack doctor passed (configuration checked; runtime phase enforcement not proven)"
        : "jspace: warning: JStack doctor could not confirm a healthy project installation",
      verified.output,
    ],
    ...(verified.exit !== 0 ? { exitCode: 1 } : {}),
  };
}
