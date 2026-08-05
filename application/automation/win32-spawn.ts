// application/automation/win32-spawn.ts — pure Windows spawn-target builder.
// A .cmd/.bat script cannot be executed directly (only .exe/.com can); it must
// go through `cmd.exe /d /s /c` with exact quoting. The quoting lives here so
// it is unit-testable; the actual cmd.exe round-trip is CI-verified on the
// Windows runner. .exe/.com spawn directly (Node quotes args itself).
export interface Win32Spawn {
  command: string;
  args: string[];
  /** Pass args verbatim (we already embedded the quoting) — only for cmd.exe. */
  verbatim: boolean;
}

/** Build the spawn target for one win32 argv. Non-scripts pass through; .cmd/.bat
 *  are wrapped in `cmd.exe /d /s /c ""<script>" <args>""` — the doubled outer
 *  quotes make cmd treat the whole tail as one command line without re-splitting. */
export function win32SpawnTarget(argv: string[]): Win32Spawn {
  const first = argv[0];
  if (!/\.(cmd|bat)$/i.test(first)) {
    return { command: first, args: argv.slice(1), verbatim: false };
  }
  const quoteIf = (a: string): string => (/\s/.test(a) && !/^"/.test(a) ? `"${a}"` : a);
  // script path is always quoted so `cmd /s /c` keeps it as one token
  const cmdline = [`"${first}"`, ...argv.slice(1).map(quoteIf)].join(" ");
  return { command: "cmd.exe", args: ["/d", "/s", "/c", `"${cmdline}"`], verbatim: true };
}
