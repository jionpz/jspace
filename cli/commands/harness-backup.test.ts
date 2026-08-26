// cli/commands/harness-backup.test.ts — backupConfig retains only the last 3
// timestamped `.jspace-bak-*` siblings.
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupConfig } from "./harness.ts";

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
    backupConfig(configPath);
  }
  const backups = readdirSync(dir).filter((n) => n.startsWith("mcp.json.jspace-bak-"));
  expect(backups.length).toBeLessThanOrEqual(3);
  expect(existsSync(configPath)).toBe(true);
});
