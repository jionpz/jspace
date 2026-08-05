// cli/commands/registry.ts — top-level CommandSpec tree.
//
// Single source for the whole command surface. Handlers bind CommandSpec args
// to application use cases (business logic moved out of cli/). Cron install
// reconciles through the automation layer + scheduler adapters (dry-run and
// real install share one engine); update keeps its network/binary logic in
// cli/update.ts.
import type { CommandSpec } from "../../application/commands/command.ts";
import { initWorkbench } from "../../application/workspace/init.ts";
import { doctorWorkbench } from "../../application/workspace/doctor.ts";
import { workspaceDiff, workspaceUpgrade } from "../../application/workspace/workspace.ts";
import { domainAdd, domainList, domainRemove } from "../../application/registry/domain.ts";
import {
  resourceAdd,
  resourceList,
  resourceRemove,
} from "../../application/registry/resource.ts";
import { filehubInit } from "../../application/registry/filehub.ts";
import { inboxStatus } from "../../application/registry/inbox.ts";
import { projectAdd, projectList } from "../../application/registry/project.ts";
import { expandTilde, filehubReadme, isCompiled, devRoot, materializeTree } from "../embed.ts";
import { resolvePath } from "../paths.ts";
import { writeBytesAtomic } from "../../adapters/fs/workbench-state.ts";
import { fail } from "../../application/errors.ts";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { BUNDLE_MANIFEST } from "../manifest.generated.ts";
import { ASSETS } from "../assets.generated.ts";
import { SKILLS_MANIFEST } from "../skills.generated.ts";
import { cronAck, cronAdd, cronInstall, cronList, cronRemove, cronSetEnabled } from "../../application/automation/use-cases.ts";
import { cronRun } from "../../application/automation/execute.ts";
import { compileSkillTarget, loadCrons, parseSchedule, type SkillTargetContext } from "../../application/automation/definitions.ts";
import { readMaterializedJournal } from "../../application/workspace/journal.ts";
import {
  ingestAdvance,
  ingestBegin,
  ingestFail,
  ingestList,
  ingestRollback,
  ingestStatus,
} from "../../application/ingest/use-cases.ts";
import type { IngestStep } from "../../core/contracts/ingest.ts";
import type { CronDefinition } from "../../core/contracts/cron.ts";
import { pendingAck, pendingApply, pendingList, pendingStage } from "../../application/pending/use-cases.ts";
import { readMarker } from "../../adapters/fs/workbench-state.ts";
import {
  schedulerAdapter,
  taskIdFor,
  workbenchTag,
  type SchedulerEnv,
} from "../../adapters/scheduler/index.ts";
import type { DesiredTask } from "../../application/automation/scheduler.ts";
import { buildPlist } from "../../adapters/scheduler/types.ts";
import { crontabBlock } from "../../adapters/scheduler/linux.ts";
import { schtasksArgs } from "../../adapters/scheduler/win32.ts";
import {
  cmdCronFailures,
  cmdCronStatus,
  cronLogDir,
  filehubRoot,
  installedCronIds,
  jspaceBinary,
  linuxCronHealth,
  plistExists,
} from "../cron.ts";
import { cmdUpdate } from "../update.ts";

const s = (v: unknown): string => (typeof v === "string" ? v : "");
const b = (v: unknown): boolean => v === true;

const cronDeps = { loadCrons, parseSchedule, installedCronIds, linuxCronHealth };
const readFileOrNull = (p: string): string | null => {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return null;
  }
};

const initSpec: CommandSpec = {
  name: "init",
  summary: "initialize a new JSpace workbench in a target directory",
  positionals: [{ name: "target", help: "target directory (default: current directory)" }],
  options: [{ name: "--force", takesValue: false, help: "allow initialization into a non-empty directory" }],
  handler: (_ctx, args) =>
    initWorkbench(args.target === undefined ? undefined : s(args.target), b(args.force), {
      resolvePath,
      expandTilde,
      isCompiled,
      devRoot,
      materialize: materializeTree,
      manifest: BUNDLE_MANIFEST,
    }),
};

const doctorSpec: CommandSpec = {
  name: "doctor",
  summary: "validate an existing JSpace workbench registry",
  features: { dir: true, json: true },
  handler: (ctx) => doctorWorkbench(ctx.root, cronDeps),
};

const domainListSpec: CommandSpec = {
  name: "list",
  summary: "list domains",
  features: { json: true, dir: true },
  handler: (ctx, args) => domainList(ctx.root, b(args.json)),
};

const domainAddSpec: CommandSpec = {
  name: "add",
  summary: "add a domain",
  positionals: [{ name: "id", required: true, help: "domain id (lowercase letters, digits, and hyphens)" }],
  features: { dir: true, dryRun: true },
  options: [
    { name: "--path", takesValue: true, help: "relative path inside the workbench (default: workspace/<id>)" },
    { name: "--tag", takesValue: true, repeatable: true, help: "domain tag (repeatable)" },
    { name: "--purpose", takesValue: true, help: "domain purpose" },
  ],
  handler: (ctx, args) =>
    domainAdd(
      ctx.root,
      s(args.id),
      args.path === undefined ? undefined : s(args.path),
      args.tags as string[] | undefined,
      args.purpose === undefined ? undefined : s(args.purpose),
      b(args.dryRun),
    ),
};

const domainRemoveSpec: CommandSpec = {
  name: "remove",
  summary: "remove a domain",
  positionals: [{ name: "id", required: true, help: "domain id" }],
  features: { dir: true, dryRun: true },
  options: [{ name: "--purge", takesValue: false, help: "also delete the domain directory" }],
  handler: (ctx, args) => domainRemove(ctx.root, s(args.id), b(args.purge), b(args.dryRun)),
};

const domainSpec: CommandSpec = {
  name: "domain",
  summary: "manage workbench domains",
  commandArgName: "domain_command",
  children: [domainListSpec, domainAddSpec, domainRemoveSpec],
};

const resourceListSpec: CommandSpec = {
  name: "list",
  summary: "list resources",
  features: { json: true, dir: true },
  handler: (ctx, args) => resourceList(ctx.root, b(args.json)),
};

const resourceAddSpec: CommandSpec = {
  name: "add",
  summary: "add a resource",
  positionals: [{ name: "id", required: true, help: "resource id (lowercase letters, digits, and hyphens)" }],
  features: { dir: true, dryRun: true },
  options: [
    { name: "--domain", takesValue: true, required: true, help: "owning domain id" },
    { name: "--type", takesValue: true, help: "resource type (default: project)" },
    { name: "--path", takesValue: true, group: "ep", help: "absolute path entrypoint" },
    { name: "--url", takesValue: true, group: "ep", help: "url entrypoint" },
    { name: "--tag", takesValue: true, repeatable: true, help: "resource tag (repeatable)" },
    { name: "--notes", takesValue: true, help: "resource notes" },
  ],
  groups: [
    {
      id: "ep",
      members: ["--path", "--url"],
      required: true,
      message: "one of the arguments --path --url is required",
    },
  ],
  handler: (ctx, args) =>
    resourceAdd(
      ctx.root,
      s(args.id),
      s(args.domain),
      args.type === undefined ? undefined : s(args.type),
      args.path === undefined ? undefined : s(args.path),
      args.url === undefined ? undefined : s(args.url),
      args.tags as string[] | undefined,
      args.notes === undefined ? undefined : s(args.notes),
      b(args.dryRun),
    ),
};

const resourceRemoveSpec: CommandSpec = {
  name: "remove",
  summary: "remove a resource",
  positionals: [{ name: "id", required: true, help: "resource id" }],
  features: { dir: true, dryRun: true },
  handler: (ctx, args) => resourceRemove(ctx.root, s(args.id), b(args.dryRun)),
};

const resourceSpec: CommandSpec = {
  name: "resource",
  summary: "manage workbench resources",
  commandArgName: "resource_command",
  children: [resourceListSpec, resourceAddSpec, resourceRemoveSpec],
};

const projectListSpec: CommandSpec = {
  name: "list",
  summary: "list projects",
  features: { json: true, dir: true },
  handler: (ctx, args) => projectList(ctx.root, b(args.json)),
};

const projectAddSpec: CommandSpec = {
  name: "add",
  summary: "add a project (register an owning id for ingest --project)",
  positionals: [{ name: "id", required: true, help: "project id (lowercase letters, digits, and hyphens)" }],
  features: { dir: true, dryRun: true },
  options: [
    { name: "--domain", takesValue: true, help: "owning domain id (default: files)" },
    { name: "--asset-rel-path", takesValue: true, help: "asset root rel path under filehub (default: projects/<id>)" },
  ],
  handler: (ctx, args) =>
    projectAdd(
      ctx.root,
      s(args.id),
      args.domain === undefined ? undefined : s(args.domain),
      args.assetRelPath === undefined ? undefined : s(args.assetRelPath),
      b(args.dryRun),
    ),
};

const projectSpec: CommandSpec = {
  name: "project",
  summary: "manage workbench projects",
  commandArgName: "project_command",
  children: [projectListSpec, projectAddSpec],
};

const filehubInitSpec: CommandSpec = {
  name: "init",
  summary: "create a file management center skeleton (asset layer)",
  positionals: [{ name: "root", required: true, help: "filehub root directory (absolute or relative path)" }],
  features: { dir: true, dryRun: true },
  options: [
    { name: "--register", takesValue: false, help: "also register the filehub in the current workbench (.jspace/hub.json) as type=filehub" },
    { name: "--domain", takesValue: true, help: "owning domain id (default: files; created if missing)" },
  ],
  handler: (ctx, args) =>
    filehubInit(s(args.root), b(args.register), args.domain === undefined ? undefined : s(args.domain), {
      resolvePath,
      expandTilde,
      filehubReadme,
      devRoot,
      wbRoot: ctx.root,
    }, b(args.dryRun)),
};

const filehubSpec: CommandSpec = {
  name: "filehub",
  summary: "manage the file management center (asset layer)",
  commandArgName: "filehub_command",
  children: [filehubInitSpec],
};

const inboxStatusSpec: CommandSpec = {
  name: "status",
  summary: "list files waiting in the inbox (read-only)",
  features: { json: true, dir: true },
  handler: (ctx, args) => inboxStatus(ctx.root, b(args.json)),
};

const inboxSpec: CommandSpec = {
  name: "inbox",
  summary: "inspect files waiting in the inbox",
  commandArgName: "inbox_command",
  children: [inboxStatusSpec],
};

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
  handler: (ctx, args) => cronAdd(ctx.root, s(args.id), s(args.schedule), s(args.harness), s(args.prompt), b(args.disabled), { isInstalled: plistExists }),
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
  handler: (ctx, args) => cronRemove(ctx.root, s(args.id), { isInstalled: plistExists }),
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
    // single engine for both dry-run and real install: automation layer plans,
    // scheduler adapter inspects/ applies; taskId is workbench-scoped.
    const marker = readMarker(ctx.root);
    const tag = marker.status === "ok" ? workbenchTag(marker.value.workbench_id) : "unknown";
    const adapter = schedulerAdapter(process.platform);
    if (!adapter) fail(`unsupported platform: ${process.platform}`);
    const data = loadCrons(ctx.root);
    const env: SchedulerEnv = {
      jspaceBinary: jspaceBinary(),
      home: homedir(),
      path: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      resolvePath,
    };
    const buildDesired = (enabled: CronDefinition[]): DesiredTask[] =>
      enabled.map((c) => ({
        taskId: taskIdFor(tag, c.id),
        cronId: c.id,
        schedule: c.schedule,
        argv: `cron run --id ${c.id} --dir ${ctx.root}`,
        content: c.id, // adapter-specific content built per-platform below
      }));
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
    const contentFor = (c: CronDefinition, tag: string): string => {
      if (adapter.platform === "darwin") {
        return buildPlist(c.id, tag, parseSchedule(c.schedule), ctx.root, env.jspaceBinary, env.home, env.path);
      }
      if (adapter.platform === "linux") {
        // content carries the full block; single-cron blocks are rebuilt by the
        // adapter on update — here we pass the per-cron line set via a minimal block
        return c.id;
      }
      // win32: args array space-joined (schtasks)
      const tn = `JSpaceCron_${tag}_${c.id}`;
      const args = schtasksArgs(c, env.jspaceBinary, ctx.root, tn);
      if (!args) fail(`cron ${c.id}: schedule "${c.schedule}" not supported on Windows (MVP: DAILY/WEEKLY with month=*)`);
      return args.join(" ");
    };
    return cronInstall(ctx.root, b(args.dryRun), {
      tag,
      buildDesired: (enabled) => {
        const desired = buildDesired(enabled);
        return desired.map((d) => ({ ...d, content: contentFor(enabled.find((e) => e.id === d.cronId)!, tag) }));
      },
      validateSkillTargets,
      inspect: () => adapter.inspect(tag, env),
      apply: (ops) => {
        // batch by platform: darwin/win32 one op per cron; linux rebuilds block once
        if (adapter.platform === "linux") {
          // rebuild full managed block from desired set
          const enabled = ops
            .filter((o) => o.action !== "delete")
            .map((o) => o.taskId.split(".").pop()!)
            .map((id) => data.crons.find((c) => c.id === id)!);
          const block = crontabBlock(enabled, tag, ctx.root, env.jspaceBinary, env.path, env.home);
          return adapter.apply({ action: "create", taskId: taskIdFor(tag, enabled[0]?.id ?? "block"), content: block }, tag, ctx.root, env);
        }
        return ops.flatMap((o) => adapter.apply(o, tag, ctx.root, env));
      },
    });
  },
};

const cronUninstallSpec: CommandSpec = {
  name: "uninstall",
  summary: "remove installed launchd agents for this workbench",
  features: { dir: true },
  handler: (ctx) => {
    const marker = readMarker(ctx.root);
    const tag = marker.status === "ok" ? workbenchTag(marker.value.workbench_id) : "unknown";
    const adapter = schedulerAdapter(process.platform);
    if (!adapter) fail(`unsupported platform: ${process.platform}`);
    const env: SchedulerEnv = {
      jspaceBinary: jspaceBinary(),
      home: homedir(),
      path: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      resolvePath,
    };
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
  handler: (_ctx, args) => {
    cmdCronStatus(args.id === undefined ? undefined : s(args.id));
    return { lines: [] };
  },
};

const cronFailuresSpec: CommandSpec = {
  name: "failures",
  aliases: ["check"],
  summary: "show recent failures + pending staged writes (alias: check)",
  description:
    "One-place session-start surface: recent failures + pending staged gbrain writes (APPLY.json) + per-cron status. Exit 1 when anything needs attention.",
  features: { dir: true, json: true },
  handler: (ctx, args) => {
    cmdCronFailures(b(args.json), ctx.root);
    return { lines: [] };
  },
};

const cronAckSpec: CommandSpec = {
  name: "ack",
  summary: "acknowledge open incidents (evidence retained, stops alerting)",
  features: { dir: true },
  positionals: [{ name: "id", help: "cron id (default: all incidents)" }],
  handler: (ctx, args) => cronAck(ctx.root, args.id === undefined ? undefined : s(args.id)),
};

const cronSpec: CommandSpec = {
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

const updateSpec: CommandSpec = {
  name: "update",
  summary: "self-update the jspace CLI from GitHub Releases",
  description:
    "Self-update the jspace CLI from GitHub Releases (explicit command only; no background checks). Downloads the matching platform binary, verifies its SHA-256 against the release checksums, and replaces the current binary.",
  options: [
    { name: "--check", takesValue: false, help: "report current vs latest, do not update" },
    { name: "--version", takesValue: true, metavar: "VERSION", help: "install a specific version (e.g. v1.0.1; rollback) (env: JSPACE_VERSION) (env: JSPACE_BASE_URL overrides the download base)" },
  ],
  handler: async (_ctx, args) => {
    await cmdUpdate(b(args.check), args.version === undefined ? undefined : s(args.version));
    return { lines: [] };
  },
};

const workspaceDiffSpec: CommandSpec = {
  name: "diff",
  summary: "show differences between the workbench and the running bundle",
  features: { dir: true, json: true },
  handler: (ctx, args) => workspaceDiff(ctx.root, BUNDLE_MANIFEST, b(args.json)),
};

const workspaceUpgradeSpec: CommandSpec = {
  name: "upgrade",
  summary: "upgrade the workbench to the running bundle (plan + journal + rollback)",
  features: { dir: true, dryRun: true },
  options: [
    { name: "--accept-conflicts", dest: "acceptConflicts", takesValue: false, help: "overwrite locally modified managed files" },
    { name: "--rollback", takesValue: true, metavar: "ID", help: "restore a previous upgrade from its journal" },
  ],
  handler: (ctx, args) => {
    const result = workspaceUpgrade(
      ctx.root,
      {
        dryRun: b(args.dryRun),
        acceptConflicts: b(args.acceptConflicts),
        rollbackId: s(args.rollback) || undefined,
      },
      { manifest: BUNDLE_MANIFEST, assets: ASSETS, readFile: readFileOrNull, writeFile: (p, c) => writeBytesAtomic(p, c) },
    );
    // dry-run is a preview, rollback restores a historical state: neither
    // should run the follow-up doctor (both can report transient mismatches)
    if (result.exitCode || b(args.dryRun) || s(args.rollback)) return result;
    const doctor = doctorWorkbench(ctx.root, cronDeps);
    return {
      ...result,
      lines: [...result.lines, ...doctor.lines],
      warnings: doctor.warnings,
      errors: doctor.errors,
      exitCode: doctor.exitCode,
    };
  },
};

const workspaceSpec: CommandSpec = {
  name: "workspace",
  summary: "inspect and upgrade the workbench",
  commandArgName: "workspace_command",
  children: [workspaceDiffSpec, workspaceUpgradeSpec],
};

const ingestBeginSpec: CommandSpec = {
  name: "begin",
  summary: "stage a file into the filehub and start an ingest journal",
  features: { dir: true },
  positionals: [{ name: "file", required: true, help: "inbox file to ingest" }],
  options: [
    { name: "--target", takesValue: true, required: true, metavar: "PATH", help: "staged target path (absolute or filehub-relative)" },
    { name: "--slug", takesValue: true, required: true, metavar: "SLUG", help: "gbrain slug assets/<project>/<semantic>" },
    { name: "--project", takesValue: true, required: true, metavar: "ID", help: "project id or name (registered id preferred)" },
    { name: "--index", takesValue: true, metavar: "LINE", help: "planned project index.md line" },
  ],
  handler: (ctx, args) =>
    ingestBegin(ctx.root, {
      file: s(args.file),
      target: s(args.target),
      slug: s(args.slug),
      project: s(args.project),
      indexLine: args.index === undefined ? undefined : s(args.index),
    }),
};

const ingestAdvanceSpec: CommandSpec = {
  name: "advance",
  summary: "mark the next mechanical step done (gbrain/index/committed)",
  features: { dir: true },
  positionals: [{ name: "id", required: true, help: "ingest journal id" }],
  options: [
    { name: "--gbrain", takesValue: false, help: "gbrain page written" },
    { name: "--index", takesValue: false, help: "project index updated" },
    { name: "--complete", takesValue: false, help: "remove source + mark committed (idempotent cleanup recovery)" },
  ],
  groups: [
    { id: "step", members: ["--gbrain", "--index", "--complete"], required: true, message: "one of --gbrain --index --complete is required" },
  ],
  handler: (ctx, args) => {
    const step: IngestStep = b(args.complete) ? "committed" : b(args.index) ? "index" : "gbrain";
    return ingestAdvance(ctx.root, s(args.id), step);
  },
};

const ingestFailSpec: CommandSpec = {
  name: "fail",
  summary: "mark an ingest failed with compensation for the failing step",
  features: { dir: true },
  positionals: [{ name: "id", required: true, help: "ingest journal id" }],
  options: [{ name: "--reason", takesValue: true, required: true, metavar: "TEXT", help: "failure reason" }],
  handler: (ctx, args) => ingestFail(ctx.root, s(args.id), s(args.reason)),
};

const ingestRollbackSpec: CommandSpec = {
  name: "rollback",
  summary: "abandon a staged ingest (source stays in inbox)",
  features: { dir: true },
  positionals: [{ name: "id", required: true, help: "ingest journal id" }],
  handler: (ctx, args) => ingestRollback(ctx.root, s(args.id)),
};

const ingestStatusSpec: CommandSpec = {
  name: "status",
  summary: "show one ingest journal",
  features: { dir: true, json: true },
  positionals: [{ name: "id", required: true, help: "ingest journal id" }],
  handler: (ctx, args) => ingestStatus(ctx.root, s(args.id), b(args.json)),
};

const ingestListSpec: CommandSpec = {
  name: "list",
  summary: "list ingest journals",
  features: { dir: true, json: true },
  handler: (ctx, args) => ingestList(ctx.root, b(args.json)),
};

const ingestSpec: CommandSpec = {
  name: "ingest",
  summary: "file-hub ingest journal (stage/advance/commit with compensation)",
  commandArgName: "ingest_command",
  children: [ingestBeginSpec, ingestAdvanceSpec, ingestFailSpec, ingestRollbackSpec, ingestStatusSpec, ingestListSpec],
};

const pendingStageSpec: CommandSpec = {
  name: "stage",
  summary: "stage a deferred gbrain write (lock conflict) as a typed envelope",
  features: { dir: true },
  positionals: [{ name: "slug", required: true, help: "target gbrain slug" }],
  options: [
    { name: "--content", takesValue: true, required: true, metavar: "FILE", help: "file containing the full page markdown" },
    { name: "--producer", takesValue: true, metavar: "NAME", help: "producer (default: asset-ingest)" },
  ],
  handler: (ctx, args) => pendingStage(ctx.root, s(args.slug), s(args.content), s(args.producer) || "asset-ingest"),
};

const pendingListSpec: CommandSpec = {
  name: "list",
  summary: "list pending envelopes",
  features: { dir: true, json: true },
  handler: (ctx, args) => pendingList(ctx.root, b(args.json)),
};

const pendingApplySpec: CommandSpec = {
  name: "apply",
  summary: "apply staged envelopes (dedupe -> put; retry -> terminal-failed)",
  features: { dir: true },
  positionals: [{ name: "id", help: "specific envelope id (default: all staged)" }],
  handler: (ctx, args) => pendingApply(ctx.root, args.id === undefined ? undefined : s(args.id)),
};

const pendingAckSpec: CommandSpec = {
  name: "ack",
  summary: "acknowledge a terminal-failed envelope (evidence retained, stops alerting)",
  features: { dir: true },
  positionals: [{ name: "id", required: true, help: "envelope id" }],
  handler: (ctx, args) => pendingAck(ctx.root, s(args.id)),
};

const pendingSpec: CommandSpec = {
  name: "pending",
  summary: "staged gbrain writes (stage/apply/ack)",
  commandArgName: "pending_command",
  children: [pendingStageSpec, pendingListSpec, pendingApplySpec, pendingAckSpec],
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
];
