// cli/commands/harness-backup.test.ts — machine config writes: backupConfig
// retains only the last 3 timestamped `.jspace-bak-*` siblings, and
// writeConfigAtomic preserves the existing file mode while replacing symlinks.
import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync, existsSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupConfig, writeConfigAtomic } from "./harness.ts";

let dir: string;
let configPath: string;
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test("backupConfig keeps at most 3 .jspace-bak-* siblings after repeated writes", () => {
  dir = mkdtempSync(join(tmpdir(), "jspace-harness-bak-"));
  configPath = join(dir, "mcp.json");
  writeFileSync(configPath, "{}", "utf-8");
  for (let i = 0; i < 10; i++) {
    writeFileSync(configPath, `{"v":${i}}`, "utf-8");
    expect(backupConfig(configPath).ok).toBe(true);
  }
  const backups = readdirSync(dir).filter((n) => n.startsWith("mcp.json.jspace-bak-"));
  expect(backups.length).toBeLessThanOrEqual(3);
  expect(existsSync(configPath)).toBe(true);
});

test("writeConfigAtomic keeps an existing 0600 mode and replaces symlinks", () => {
  dir = mkdtempSync(join(tmpdir(), "jspace-harness-mode-"));
  configPath = join(dir, "claude.json");
  writeFileSync(configPath, "{}", "utf-8");
  chmodSync(configPath, 0o600);
  writeConfigAtomic(configPath, '{"token":"x"}');
  expect(statSync(configPath).mode & 0o777).toBe(0o600);

  // a symlink is replaced, not written through — and the target is untouched
  const outside = join(dir, "outside.json");
  writeFileSync(outside, "secret", "utf-8");
  const link = join(dir, "link.json");
  symlinkSync(outside, link);
  writeConfigAtomic(link, "new");
  expect(statSync(link).isSymbolicLink()).toBe(false);
  expect(readFileSync(outside, "utf-8")).toBe("secret");
});
