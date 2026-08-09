// cli/commands/registry.ts — top-level CommandSpec tree (root assembly).
//
// Single source for the whole command surface. Command families live in their
// own files (domain / resource / project / cron / ingest / pending / workspace);
// this file only owns the top-level init + doctor commands and the COMMANDS
// order (which fixes the help listing). Handlers bind CommandSpec args to
// application use cases; cron scheduling reconciles through the automation
// layer + scheduler adapters (dry-run and real install share one engine).
import type { CommandSpec } from "../../application/commands/command.ts";
import { initWorkbench } from "../../application/workspace/init.ts";
import { doctorWorkbench } from "../../application/diagnostics/doctor.ts";
import { expandTilde, isCompiled, devRoot, materializeTree } from "../embed.ts";
import { resolvePath } from "../paths.ts";
import { BUNDLE_MANIFEST } from "../manifest.generated.ts";
import { CliError } from "../../core/shared/errors.ts";
import { b, cronDeps, s } from "./helpers.ts";
import { domainSpec } from "./domain.ts";
import { resourceSpec } from "./resource.ts";
import { filehubSpec, inboxSpec, projectSpec } from "./project.ts";
import { cronSpec } from "./cron.ts";
import { ingestSpec } from "./ingest.ts";
import { pendingSpec } from "./pending.ts";
import { updateSpec, workspaceSpec } from "./workspace.ts";
import { contextSpec } from "./context.ts";
import { gbrainSpec } from "./gbrain.ts";
import { skillsSpec } from "./skills.ts";
import { harnessSpec } from "./harness.ts";

const initSpec: CommandSpec = {
  name: "init",
  summary: "initialize a new JSpace workbench in a target directory",
  // --dir aligns init with every other workbench command; the positional target
  // stays for backward compatibility. Both given -> ambiguous (exit 2).
  features: { dir: true },
  positionals: [{ name: "target", help: "target directory (default: current directory)" }],
  options: [{ name: "--force", takesValue: false, help: "allow initialization into a non-empty directory" }],
  handler: (ctx, args) => {
    if (ctx.dir !== undefined && args.target !== undefined) {
      throw new CliError("argument target: not allowed with argument --dir", 2);
    }
    // positional wins for legacy scripts; otherwise the resolved --dir / cwd.
    const target = args.target === undefined ? ctx.root : s(args.target);
    return initWorkbench(target, b(args.force), {
      resolvePath,
      expandTilde,
      isCompiled,
      devRoot,
      materialize: materializeTree,
      manifest: BUNDLE_MANIFEST,
    });
  },
};

const doctorSpec: CommandSpec = {
  name: "doctor",
  summary: "validate an existing JSpace workbench registry",
  features: { dir: true, json: true },
  handler: (ctx) => doctorWorkbench(ctx.root, cronDeps),
};

export const COMMANDS: CommandSpec[] = [
  initSpec,
  doctorSpec,
  domainSpec,
  resourceSpec,
  projectSpec,
  filehubSpec,
  inboxSpec,
  cronSpec,
  ingestSpec,
  pendingSpec,
  updateSpec,
  workspaceSpec,
  contextSpec,
  gbrainSpec,
  harnessSpec,
  skillsSpec,
];
