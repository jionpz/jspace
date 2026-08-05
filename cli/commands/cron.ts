// cli/commands/cron.ts — `jspace cron` command family.
// Handlers bind to application use cases + the scheduler service; platform
// scheduling identity/content stays in the adapters + scheduler-service.
import type { CommandSpec } from "../../application/commands/command.ts";
import { fail } from "../../core/shared/errors.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import { cronAck, cronAdd, cronList, cronRemove, cronSetEnabled } from "../../application/automation/use-cases.ts";
import { cronInstall } from "../../application/automation/scheduler-service.ts";
import { cronRun } from "../../application/automation/execute.ts";
import { compileSkillTarget, type SkillTargetContext } from "../../application/automation/definitions.ts";
import { readMaterializedJournal } from "../../application/workspace/journal.ts";
import { cronFailures, cronLogDir, cronStatus, filehubRoot } from "../../application/automation/status.ts";
import { schedulerAdapter } from "../../adapters/scheduler/index.ts";
import { cronIsInstalledForRoot, schedulerEnv, workbenchTagFor } from "../scheduler.ts";
import { BUNDLE_MANIFEST } from "../manifest.generated.ts";
import { SKILLS_MANIFEST } from "../skills.generated.ts";
import { b, readFileOrNull, s } from "./helpers.ts";

const cronAddSpec: CommandSpec = {
  name: "add",
  summary: "add a cron definition",
  positionals: [{ name: "id", required: true, help: "cron id (lowercase letters, digits, and hyphens)" }],
  features: { dir: true },
  options: [
    { name: "--schedule", takesValue: true, required: true, help: 'restricted 5-field cron expression (e.g. "0 21 * * *"; single values or *; no lists/ranges/steps)' },
    { name: "--harness", takesValue: true, required: true, help: "harness to run: claude | codex | pi" },
    { name: "--prompt", takesValue: true, required: true, help: "instruction for the headless harness" },
    { name: "--disabled", takesValue: false, help: "add the cron disabled" },
  ],
  handler: (ctx, args) => cronAdd(ctx.root, s(args.id), s(args.schedule), s(args.harness), s(args.prompt), b(args.disabled), { isInstalled: (id) => cronIsInstalledForRoot(ctx.root, id) }),
};

const cronListSpec: CommandSpec = {
  name: "list",
  summary: "list cron definitions",
  features: { json: true, dir: true },
  handler: (ctx, args) => cronList(ctx.root, b(args.json)),
};

const cronRemoveSpec: CommandSpec = {
  name: "remove",
  summary: "remove a cron definition",
  positionals: [{ name: "id", required: true, help: "cron id" }],
  features: { dir: true },
  handler: (ctx, args) => cronRemove(ctx.root, s(args.id), { isInstalled: (id) => cronIsInstalledForRoot(ctx.root, id) }),
};

const cronEnableSpec: CommandSpec = {
  name: "enable",
  summary: "enable a cron definition",
  positionals: [{ name: "id", required: true, help: "cron id" }],
  features: { dir: true },
  handler: (ctx, args) => cronSetEnabled(ctx.root, s(args.id), true),
};

const cronDisableSpec: CommandSpec = {
  name: "disable",
  summary: "disable a cron definition",
  positionals: [{ name: "id", required: true, help: "cron id" }],
  features: { dir: true },
  handler: (ctx, args) => cronSetEnabled(ctx.root, s(args.id), false),
};

const cronInstallSpec: CommandSpec = {
  name: "install",
  summary: "reconcile enabled crons into the platform scheduler",
  features: { dir: true, dryRun: true },
  handler: (ctx, args) => {
    // single engine for both dry-run and real install: the scheduler service
    // owns desired compilation + platform batching; this handler only composes
    // adapter + env and validates skill targets.
    const tag = workbenchTagFor(ctx.root);
    const adapter = schedulerAdapter(process.platform);
    if (!adapter) fail(`unsupported platform: ${process.platform}`);
    const env = schedulerEnv();
    const validateSkillTargets = (enabled: CronDefinition[]): string | null => {
      const skillCtx: SkillTargetContext = {
        skillsManifest: SKILLS_MANIFEST,
        bundleManifest: BUNDLE_MANIFEST,
        readFile: readFileOrNull,
        recorded: readMaterializedJournal(ctx.root)?.files ?? {},
      };
      for (const c of enabled) {
        if (!c.target) continue;
        const r = compileSkillTarget(c.target, ctx.root, skillCtx);
        if (!r.ok) return r.fix;
      }
      return null;
    };
    return cronInstall(ctx.root, b(args.dryRun), { tag, adapter, env, validateSkillTargets });
  },
};

const cronUninstallSpec: CommandSpec = {
  name: "uninstall",
  summary: "remove installed launchd agents for this workbench",
  features: { dir: true },
  handler: (ctx) => {
    const tag = workbenchTagFor(ctx.root);
    const adapter = schedulerAdapter(process.platform);
    if (!adapter) fail(`unsupported platform: ${process.platform}`);
    const env = schedulerEnv();
    const lines = adapter.uninstallAll(tag, ctx.root, env);
    return { lines: lines.length > 0 ? lines : ["jspace: ok: no jspace cron tasks to remove"] };
  },
};

const cronRunSpec: CommandSpec = {
  name: "run",
  summary: "run a cron headlessly now",
  positionals: [{ name: "id", help: "cron id (alternative to --id)" }],
  options: [
    { name: "--id", dest: "id", takesValue: true, help: "cron id (canonical scheduler form)" },
    { name: "--force", dest: "force", takesValue: false, help: "run even if the cron already succeeded today" },
    { name: "--dry-run", dest: "dryRun", takesValue: false, help: "print the command that would run, without executing" },
    {
      name: "--timeout",
      takesValue: true,
      metavar: "SECONDS",
      validate: (v) => (Number(v) > 0 ? null : "argument --timeout: invalid number"),
      help: "per-run timeout (default: 1800)",
    },
    { name: "--dir", takesValue: true, metavar: "DIR", help: "workbench root (default: current directory; schedulers pass this explicitly)" },
  ],
  handler: async (ctx, args) => {
    if (s(args.id) === "") fail("the following arguments are required: id");
    return cronRun(
      ctx.root,
      {
        cronId: s(args.id),
        dryRun: b(args.dryRun),
        timeoutSec: Number(s(args.timeout) || "1800"),
        force: b(args.force),
      },
      {
        platform: process.platform,
        filehubRoot,
        logDir: cronLogDir,
        now: Date.now,
        skillsManifest: SKILLS_MANIFEST,
        bundleManifest: BUNDLE_MANIFEST,
        readFile: readFileOrNull,
      },
    );
  },
};

const cronStatusSpec: CommandSpec = {
  name: "status",
  summary: "show last run result",
  positionals: [{ name: "id", help: "cron id (default: all)" }],
  handler: (ctx, args) => cronStatus(ctx.root, args.id === undefined ? undefined : s(args.id)),
};

const cronFailuresSpec: CommandSpec = {
  name: "failures",
  aliases: ["check"],
  summary: "show recent failures + pending staged writes (alias: check)",
  description:
    "One-place session-start surface: recent failures + pending staged gbrain writes (APPLY.json) + per-cron status. Exit 1 when anything needs attention.",
  features: { dir: true, json: true },
  handler: (ctx) => cronFailures(ctx.root),
};

const cronAckSpec: CommandSpec = {
  name: "ack",
  summary: "acknowledge open incidents (evidence retained, stops alerting)",
  features: { dir: true },
  positionals: [{ name: "id", help: "cron id (default: all incidents)" }],
  handler: (ctx, args) => cronAck(ctx.root, args.id === undefined ? undefined : s(args.id)),
};

export const cronSpec: CommandSpec = {
  name: "cron",
  summary: "manage scheduled tasks (declarative + launchd)",
  commandArgName: "cron_command",
  children: [
    cronAddSpec,
    cronListSpec,
    cronRemoveSpec,
    cronEnableSpec,
    cronDisableSpec,
    cronInstallSpec,
    cronUninstallSpec,
    cronRunSpec,
    cronStatusSpec,
    cronFailuresSpec,
    cronAckSpec,
  ],
};
