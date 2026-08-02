// cli/init.ts — `jspace init` (mirrors Python cmd_init + _materialize_placeholders).
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "./errors.ts";
import { devRoot, expandTilde, isCompiled, materializeTree } from "./embed.ts";
import { resolvePath } from "./paths.ts";

export const MARKER_FILE = ".jspace.json";
export const VERSION = "1.0.0";

export function cmdInit(targetArg: string | undefined, force: boolean): void {
  const target = resolvePath(expandTilde(targetArg ?? "."));
  if (existsSync(target) && !statSync(target).isDirectory()) {
    fail(`target is not a directory: ${target}`);
  }
  if (existsSync(target) && readdirSync(target).length > 0 && !force) {
    fail(`target directory is not empty: ${target} (use --force to initialize anyway)`);
  }
  if (existsSync(join(target, MARKER_FILE)) && !force) {
    fail(`target is already a JSpace workbench: ${target}`);
  }

  mkdirSync(target, { recursive: true });
  // Template + skills are embedded in the binary (assets.generated.ts); the
  // standalone CLI is self-contained and needs no on-disk template checkout.
  materializeTree(target, devRoot());

  const marker = {
    product: "JSpace",
    template_version: VERSION,
    created_at: new Date().toISOString().slice(0, 10),
    source: devRoot(),
  };
  writeFileSync(join(target, MARKER_FILE), JSON.stringify(marker, null, 2) + "\n", "utf-8");

  console.log(`Initialized JSpace workbench at ${target}`);
  // D4 (owner-confirmed): workbench references the `jspace` command on PATH;
  // source checkouts still resolve to <dev>/bin/jspace.
  const validateCmd = isCompiled() ? "jspace" : join(devRoot(), "bin", "jspace");
  console.log(`Validate: ${validateCmd} doctor --dir ${target}`);
  console.log("Next: read AGENTS.md, then follow skills/jspace-bootstrap/SKILL.md");
}
