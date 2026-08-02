// cli/main.ts — entry point. Mirrors Python bin/jspace main() + argparse top level.
import { ArgError, VERSION, parseArgs } from "./args.ts";
import { CliError } from "./errors.ts";

function main(): void {
  try {
    const argv = process.argv.slice(2);
    const invocation = parseArgs(argv);
    switch (invocation.action) {
      case "version":
        console.log(`jspace ${VERSION}`);
        return;
      case "help":
        console.log(invocation.text);
        return;
      case "run":
        invocation.run!(invocation.values!);
        return;
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

main();
