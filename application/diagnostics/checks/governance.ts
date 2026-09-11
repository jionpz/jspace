// application/diagnostics/checks/governance.ts — read-only machine-global
// governance source + harness entry-point checks.
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import { binaryOnPath } from "../../../adapters/harness/bin.ts";
import { loadCapabilities } from "../../../adapters/harness/registry.ts";
import type { HarnessGlobalContext } from "../../../adapters/harness/types.ts";
import type { GovernanceDeps, HarnessCheckDeps } from "../deps.ts";

type GovernanceCheckDeps = GovernanceDeps & Pick<HarnessCheckDeps, "harnessBinOnPath" | "platform">;
type FileGlobalContext = Extract<HarnessGlobalContext, { path: string }>;

/** Verify the source contract and every verified file-based harness entry point.
 *  Absent `globalGovernanceHome` means the check is opt-in and must not touch
 *  the real home directory (tests and non-workbench environments stay inert). */
export function checkGovernance(deps: GovernanceCheckDeps): RegistryDiagnostic[] {
  if (!deps.globalGovernanceHome) return [];

  const caps = loadCapabilities();
  const home = deps.globalGovernanceHome();
  const sourceDeclared = caps.global_governance.source;
  const sourcePath = resolveHomePath(sourceDeclared, home);
  let sourceBody: string;
  try {
    sourceBody = readFileSync(sourcePath, "utf-8");
  } catch {
    return [sourceMissingDiagnostic(sourceDeclared)];
  }
  if (sourceBody.trim() === "") return [sourceMissingDiagnostic(sourceDeclared)];

  const diags: RegistryDiagnostic[] = [];
  const headings = extractAtxHeadings(sourceBody);
  const missing = caps.global_governance.required_headings.filter(
    (topic) => !headings.some((heading) => heading.includes(topic)),
  );
  if (missing.length > 0) {
    diags.push({
      severity: "warning",
      code: "governance.core_missing",
      path: sourceDeclared,
      message: `global governance source is missing required heading topic(s): ${missing.join(", ")} (${sourcePath}); run harness-config to repair the document`,
    });
  }

  const binOnPath = deps.harnessBinOnPath ?? ((name: string) => binaryOnPath(name, deps.platform ?? process.platform));
  for (const [name, cap] of Object.entries(caps.harnesses)) {
    const context = cap.global_context;
    if (!isFileGlobalContext(context)) continue;
    if (!binOnPath(name)) continue;

    const verification = verifyHarnessContext(name, context, sourceDeclared, sourcePath, home);
    if (verification === null) continue;
    diags.push({
      severity: "warning",
      code: "governance.harness_unwired",
      path: `harness.${name}`,
      message: verification,
    });
  }
  return diags;
}

function isFileGlobalContext(context: HarnessGlobalContext | undefined): context is FileGlobalContext {
  return context?.kind === "symlink" || context?.kind === "symlink-or-import";
}

function sourceMissingDiagnostic(source: string): RegistryDiagnostic {
  return {
    severity: "warning",
    code: "governance.source_missing",
    path: source,
    message: `global governance source is missing, empty, or unreadable at ${source}; run harness-config to create or repair it`,
  };
}

function extractAtxHeadings(body: string): string[] {
  const headings: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const match = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match) headings.push(match[1]!.replace(/\s+/g, " ").trim());
  }
  return headings;
}

function resolveHomePath(path: string, home: string): string {
  if (path === "~") return home;
  const withoutTilde = path.replace(/^~[\\/]/, "");
  return isAbsolute(withoutTilde) ? withoutTilde : join(home, withoutTilde);
}

function verifyHarnessContext(
  name: string,
  context: FileGlobalContext,
  sourceDeclared: string,
  sourcePath: string,
  home: string,
): string | null {
  let target = resolveHomePath(context.path, home);
  let shadowingOverride = false;
  if (name === "codex" && context.kind === "symlink" && context.override_path) {
    const override = resolveHomePath(context.override_path, home);
    if (isNonEmptyFile(override)) {
      target = override;
      shadowingOverride = true;
    }
  }

  const wired = context.kind === "symlink"
    ? symlinkPointsAt(target, sourcePath)
    : symlinkPointsAt(target, sourcePath) || importsSource(target, sourceDeclared, sourcePath);
  if (wired) return null;

  const shadowNote = shadowingOverride
    ? " (Codex AGENTS.override.md shadows AGENTS.md)"
    : "";
  return `global governance is not wired for ${name}${shadowNote}: ${target} does not point at ${sourceDeclared}; run harness-config to repair the wiring`;
}

function isNonEmptyFile(path: string): boolean {
  try {
    return readFileSync(path, "utf-8").trim() !== "";
  } catch {
    return false;
  }
}

function symlinkPointsAt(entry: string, source: string): boolean {
  try {
    return lstatSync(entry).isSymbolicLink() && realpathSync(entry) === realpathSync(source);
  } catch {
    return false;
  }
}

function importsSource(entry: string, sourceDeclared: string, sourcePath: string): boolean {
  try {
    const body = readFileSync(entry, "utf-8");
    return [`@${sourceDeclared}`, `@${sourcePath}`, sourceDeclared, sourcePath].some((needle) => body.includes(needle));
  } catch {
    return false;
  }
}
