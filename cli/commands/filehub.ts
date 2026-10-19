// cli/commands/filehub.ts — read-only filehub consistency audit command.
import type { CmdContext, CmdResult, CommandSpec } from "../../application/commands/command.ts";
import {
  filehubCheck,
  renderFilehubCheck,
  type FilehubRegistryProject,
} from "../../application/filehub/check.ts";
import { resolveFilehubRoot } from "../../application/registry/filehub-lookup.ts";
import { readWorkbenchState, type WorkbenchStateReads } from "../../adapters/fs/workbench-state.ts";
import { realGbrain, type GbrainDeps } from "../../adapters/gbrain/gbrain.ts";

export interface FilehubCheckCommandDeps {
  gbrain: () => GbrainDeps;
  filehubRoot: (root: string) => string | null;
  readState: (root: string) => WorkbenchStateReads;
}

const defaultDeps: FilehubCheckCommandDeps = {
  gbrain: () => realGbrain(),
  filehubRoot: resolveFilehubRoot,
  readState: readWorkbenchState,
};

function registrySnapshot(
  state: WorkbenchStateReads,
): { projects: readonly FilehubRegistryProject[] | null; issue?: string } {
  if (state.hub.status === "ok") {
    return { projects: state.hub.value.projects };
  }
  if (state.hub.status === "missing") {
    return {
      projects: null,
      issue: ".jspace/hub.json is missing; project ownership and asset roots are unverified",
    };
  }
  return {
    projects: null,
    issue: state.hub.issues
      .map((entry) => `${entry.path}: ${entry.message} (${entry.code})`)
      .join("; "),
  };
}

export async function filehubCheckCommand(
  ctx: CmdContext,
  deps: FilehubCheckCommandDeps = defaultDeps,
): Promise<CmdResult> {
  const state = deps.readState(ctx.root);
  const registry = registrySnapshot(state);
  const report = await filehubCheck(deps.gbrain(), {
    root: deps.filehubRoot(ctx.root),
    projects: registry.projects,
    ...(registry.issue !== undefined ? { registryIssue: registry.issue } : {}),
  });
  if (ctx.json) {
    return {
      lines: [],
      data: report,
      ...(report.status === "ok" ? {} : { exitCode: 1 }),
    };
  }
  const rendered = renderFilehubCheck(report);
  return {
    lines: rendered.lines,
    data: report,
    ...(rendered.exitCode !== undefined ? { exitCode: rendered.exitCode } : {}),
  };
}

export const filehubCheckSpec: CommandSpec = {
  name: "check",
  summary: "audit assets, owner indexes and gbrain pointers for consistency (read-only)",
  features: { dir: true, json: true },
  handler: (ctx) => filehubCheckCommand(ctx),
};
