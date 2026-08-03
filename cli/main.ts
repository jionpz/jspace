#!/usr/bin/env bun
// cli/main.ts — entry point + top-level dispatch (CommandSpec-driven).
import {
  ArgError,
  parse,
  render,
  type CmdContext,
  type CommandSpec,
} from "../application/commands/command.ts";
import { COMMANDS } from "./commands/registry.ts";
import { CliError } from "./errors.ts";
import { VERSION } from "./version.generated.ts";
import { expandTilde } from "./embed.ts";
import { resolvePath } from "./paths.ts";

const ROOT: CommandSpec = {
  name: "",
  summary: "",
  description:
    "JSpace - create and validate local workbenches.\n\nExit codes: 0 success; 1 business failure / unhealthy check (doctor, cron check); 2 argument error.",
  children: COMMANDS,
};

async function main(): Promise<void> {
  try {
    const outcome = parse(process.argv.slice(2), ROOT);
    switch (outcome.kind) {
      case "version":
        console.log(`jspace ${VERSION}`);
        return;
      case "help":
        console.log(outcome.text);
        return;
      case "run": {
        const ctx: CmdContext = {
          json: outcome.args.json === true,
          dryRun: outcome.args.dryRun === true,
          dir: outcome.dir,
          root: resolvePath(expandTilde(outcome.dir ?? process.cwd())),
          cwd: process.cwd(),
        };
        const result = await outcome.spec.handler!(ctx, outcome.args);
        for (const e of result.errors ?? []) console.error(`jspace: error: ${e}`);
        for (const w of result.warnings ?? []) console.error(`jspace: warning: ${w}`);
        for (const line of render(ctx, result)) console.log(line);
        if (result.exitCode !== undefined) process.exitCode = result.exitCode;
        return;
      }
    }
  } catch (e) {
    if (e instanceof CliError) {
      if (!e.printed) console.error(`jspace: error: ${e.message}`);
      process.exitCode = e.exitCode;
      return;
    }
    if (e instanceof ArgError) {
      console.error(e.usage);
      console.error(`${e.prog}: error: ${e.message}`);
      process.exitCode = 2;
      return;
    }
    throw e;
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exitCode = 1;
});
