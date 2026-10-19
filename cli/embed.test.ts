// cli/embed.test.ts — path-expansion contract for workbench/dir arguments.
// The red line (legacy-removal audit A8): only "~", "~/" and "~\\" expand to
// THIS user's home. A `~user` input must fail loudly — guessing /Users/<name>
// or /home/<name> resolves to a path that may not exist on this machine.
// Run: bun test cli/embed.test.ts
import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandTilde } from "./embed.ts";

test("expandTilde expands the current user's home for ~, ~/ and ~\\", () => {
  expect(expandTilde("~")).toBe(homedir());
  expect(expandTilde("~/jworkspace")).toBe(join(homedir(), "jworkspace"));
  expect(expandTilde("~\\jworkspace")).toBe(join(homedir(), "jworkspace"));
});

test("expandTilde leaves absolute and relative paths untouched", () => {
  expect(expandTilde("/absolute/path")).toBe("/absolute/path");
  expect(expandTilde("relative/path")).toBe("relative/path");
  // a bare `~` inside the path is not a leading expansion
  expect(expandTilde("dir/~user/file")).toBe("dir/~user/file");
});

test("expandTilde refuses ~user instead of guessing another user's home", () => {
  for (const input of ["~someone/jworkspace", "~../etc", "~root"]) {
    expect(() => expandTilde(input)).toThrow(/only "~"/);
  }
});
