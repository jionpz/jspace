// cli/commands/memory.ts — shared memory clock and read-only audit commands.
import type { CmdContext, CmdResult, CommandSpec } from "../../application/commands/command.ts";
import { memoryCheck, renderMemoryCheck } from "../../application/memory/check.ts";
import { resolveFilehubRoot } from "../../application/registry/filehub-lookup.ts";
import { realGbrain, type GbrainDeps } from "../../adapters/gbrain/gbrain.ts";
import { weeklyPeriod, type WeeklyPeriod } from "../../core/contracts/weekly-period.ts";

export interface MemoryCheckCommandDeps {
  gbrain: () => GbrainDeps;
  filehubRoot: (root: string) => string | null;
}

export interface MemoryPeriodCommandDeps {
  now: () => Date;
}

const defaultDeps: MemoryCheckCommandDeps = {
  gbrain: () => realGbrain(),
  filehubRoot: resolveFilehubRoot,
};

const defaultPeriodDeps: MemoryPeriodCommandDeps = {
  now: () => new Date(),
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function instant(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new RangeError("now must be a valid ISO-8601 instant");
  return parsed;
}

export function renderWeeklyPeriod(period: WeeklyPeriod): string[] {
  return [
    `timezone: ${period.timezone}`,
    `week_start: ${period.week_start}`,
    `week_end_exclusive: ${period.week_end_exclusive}`,
    `window: [${period.window_start}, ${period.window_end_exclusive})`,
    `observed_through: ${period.observed_through}`,
    `status: ${period.status}`,
  ];
}

export function memoryPeriodCommand(
  ctx: CmdContext,
  args: Record<string, unknown>,
  deps: MemoryPeriodCommandDeps = defaultPeriodDeps,
): CmdResult {
  try {
    const nowArg = optionalString(args.now);
    const timezone = optionalString(args.timezone);
    const week = optionalString(args.week);
    const options = {
      ...(timezone === undefined ? {} : { timeZone: timezone }),
      ...(week === undefined ? {} : { monday: week }),
    };
    const period = weeklyPeriod(nowArg === undefined ? deps.now() : instant(nowArg), options);
    return {
      lines: ctx.json ? [] : renderWeeklyPeriod(period),
      data: period,
    };
  } catch (e) {
    return {
      lines: [],
      errors: [`memory period: ${e instanceof Error ? e.message : String(e)}`],
      exitCode: 2,
    };
  }
}

export async function memoryCheckCommand(
  ctx: CmdContext,
  deps: MemoryCheckCommandDeps = defaultDeps,
): Promise<CmdResult> {
  const report = await memoryCheck(deps.gbrain(), deps.filehubRoot(ctx.root));
  if (ctx.json) {
    return {
      lines: [],
      data: report,
      ...(report.status === "ok" ? {} : { exitCode: 1 }),
    };
  }
  const rendered = renderMemoryCheck(report);
  return {
    lines: rendered.lines,
    data: report,
    ...(rendered.exitCode !== undefined ? { exitCode: rendered.exitCode } : {}),
  };
}

const memoryCheckSpec: CommandSpec = {
  name: "check",
  summary: "audit JSpace memory structure, provenance, lifecycle and asset pointers (read-only)",
  features: { dir: true, json: true },
  handler: (ctx) => memoryCheckCommand(ctx),
};

const memoryPeriodSpec: CommandSpec = {
  name: "period",
  summary: "resolve the canonical local-Monday reporting window (read-only)",
  features: { dir: true, json: true },
  options: [
    {
      name: "--week",
      takesValue: true,
      metavar: "YYYY-MM-DD",
      help: "target Monday for a backfill; default: current local week",
    },
    {
      name: "--timezone",
      takesValue: true,
      metavar: "IANA",
      help: "workbench timezone; default: this machine's local timezone",
    },
    {
      name: "--now",
      takesValue: true,
      metavar: "ISO-8601",
      help: "explicit evidence cutoff for deterministic runs (default: now)",
    },
  ],
  handler: (ctx, args) => memoryPeriodCommand(ctx, args),
};

export const memorySpec: CommandSpec = {
  name: "memory",
  summary: "canonical period clock and read-only memory audits",
  commandArgName: "memory_command",
  children: [memoryPeriodSpec, memoryCheckSpec],
};
