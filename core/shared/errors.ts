// core/shared/errors.ts — shared error/exit contract (mirrors Python
// fail()/_reject_errors). Lives in the shared kernel so adapters, application
// and cli all use the same primitives without a layer depending on a higher one.
export class CliError extends Error {
  exitCode: number;
  printed: boolean;
  constructor(message: string, exitCode = 1, printed = false) {
    super(message);
    this.exitCode = exitCode;
    this.printed = printed;
  }
}

/** jspace: error: <msg> to stderr, exit 1. */
export function fail(message: string): never {
  throw new CliError(message, 1);
}

/** Print each error, then exit 1 (mirrors _reject_errors: no-op when empty). */
export function rejectErrors(errors: string[]): void {
  for (const e of errors) console.error(`jspace: error: ${e}`);
  if (errors.length) throw new CliError("", 1, true);
}
