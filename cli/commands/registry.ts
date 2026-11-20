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
import { b, cronDeps } from "./helpers.ts";
import { domainSpec } from "./domain.ts";
import { resourceSpec } from "./resource.ts";
import { filehubSpec, inboxSpec, projectSpec } from "./project.ts";
import { cronSpec } from "./cron.ts";
import { ingestSpec } from "./ingest.ts";
import { pendingSpec } from "./pending.ts";
import { updateSpec, workspaceSpec } from "./workspace.ts";
import { contextSpec } from "./context.ts";
import { skillsSpec } from "./skills.ts";
import { harnessSpec } from "./harness.ts";
import { memorySpec } from "./memory.ts";
import { integrationSpec, bundledJstackBridge } from "./integration.ts";
import { enableJstack } from "../../application/integrations/jstack.ts";
import { fail } from "../../core/shared/errors.ts";

const initSpec: CommandSpec = {
  name: "init",
  summary: "initialize a new JSpace workbench in a target directory",
  features: { dir: true },
  options: [
    { name: "--force", takesValue: false, help: "allow initialization into a non-empty directory" },
    { name: "--integration", takesValue: true, repeatable: true, metavar: "NAME", help: "enable an optional integration at creation (currently: jstack)" },
  ],
  handler: (ctx, args) => {
    const integrations = (args.integration as string[] | undefined) ?? [];
    if (integrations.some((name) => name !== "jstack")) {
      fail(`unsupported integration: ${integrations.filter((name) => name !== "jstack").join(", ")} (supported: jstack)`);
    }
    const bridge = integrations.includes("jstack") ? bundledJstackBridge() : null;
    const initialized = initWorkbench(ctx.root, b(args.force), {
      resolvePath,
      expandTilde,
      isCompiled,
      devRoot,
      materialize: materializeTree,
      manifest: BUNDLE_MANIFEST,
    });
    if (bridge === null) return initialized;
    const enabled = enableJstack(ctx.root, bridge);
    return { ...initialized, lines: [...initialized.lines, ...enabled.lines] };
  },
};

const doctorSpec: CommandSpec = {
  name: "doctor",
  summary: "validate an existing JSpace workbench registry",
  features: { dir: true, json: true },
  options: [{ name: "--verbose", dest: "verbose", takesValue: false, help: "also print info-level diagnostics (human mode)" }],
  handler: (ctx, args) => doctorWorkbench(ctx.root, cronDeps, b(args.verbose)),
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
  memorySpec,
  harnessSpec,
  skillsSpec,
  integrationSpec,
];
