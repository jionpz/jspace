// application/registry/filehub.ts — `jspace filehub init` use case (moved from cli/cmds.ts).
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail } from "../../cli/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import { isId } from "../../core/contracts/ids.ts";
import { PairedWriteError, writeHubAndLocal } from "../../adapters/fs/workbench-state.ts";
import { loadHub, loadLocal, freshLocal } from "../workspace/state.ts";
import { cleanTags, isWithin } from "./helpers.ts";
import {
  DEFAULT_DOMAIN_PURPOSE,
  rollbackDomainSkeleton,
  writeDomainSkeleton,
} from "./domain.ts";
import { isFile } from "../fs.ts";

export interface FilehubDeps {
  resolvePath: (p: string) => string;
  expandTilde: (p: string) => string;
  filehubReadme: (devRootStr: string) => string;
  devRoot: () => string;
  /** workbench root for --register (current cwd) */
  wbRoot: string;
}

/** Register the filehub root as a type=filehub resource in the given workbench.
 *  Validation runs first so --dry-run can report an accurate plan. */
function registerFilehub(
  wbRoot: string,
  root: string,
  domainOpt: string | undefined,
  lines: string[],
  dryRun: boolean,
): void {
  const hub = loadHub(wbRoot);
  if (hub.resources.some((r) => r.type === "filehub")) {
    const existing = hub.resources.find((r) => r.type === "filehub")!;
    fail(
      `filehub already registered: ${existing.id} (remove it first with jspace resource remove, or reuse)`,
    );
  }

  const domain = (domainOpt ?? "files").trim() || "files";
  if (!isId(domain)) fail(`invalid domain id: ${domain}`);
  const domainPath = `workspace/${domain}`;
  const domainExists = hub.domains.some((d) => d.id === domain);
  let domainDir: string | null = null;
  if (!domainExists) {
    domainDir = resolve(resolve(wbRoot, domainPath));
    if (!isWithin(domainDir, wbRoot) || domainDir === wbRoot) {
      fail(`domain path must resolve inside the workbench root: ${domainPath}`);
    }
  }

  const bindingKey = "filehub-path";
  const local = loadLocal(wbRoot) ?? freshLocal();
  if (local.bindings[bindingKey] !== undefined) {
    fail(`binding already exists: ${bindingKey} (remove the orphan binding first)`);
  }

  if (dryRun) {
    if (!domainExists) lines.push(`jspace: ok: would create domain: ${domain}`);
    lines.push(`jspace: ok: would register filehub resource (type=filehub, primary=${root})`);
    return;
  }

  let created: string[] = [];
  let nearestExisting = join(wbRoot, "workspace");
  if (!domainExists) {
    ({ created, nearestExisting } = writeDomainSkeleton(
      domainDir as string,
      domain,
      DEFAULT_DOMAIN_PURPOSE,
      [],
    ));
    hub.domains.push({ id: domain, path: domainPath });
    lines.push(`jspace: ok: created domain: ${domain}`);
  }

  local.bindings[bindingKey] = root;
  hub.resources.push({
    id: "filehub",
    type: "filehub",
    domain,
    tags: cleanTags(["assets"]),
    entrypoints: [{ id: "path", kind: "path", binding: bindingKey, primary: true }],
    notes: "文件管理中心(资产层本体);归位/整理见 skills/asset-ingest",
  });
  try {
    writeHubAndLocal(wbRoot, hub, local);
  } catch (e) {
    if (created.length) {
      rollbackDomainSkeleton(resolve(wbRoot, domainPath), nearestExisting, created);
    }
    if (e instanceof PairedWriteError) fail(e.message);
    throw e;
  }
  lines.push(`jspace: ok: registered filehub resource (type=filehub, primary=${root})`);
}

export function filehubInit(
  rootArg: string,
  register: boolean,
  domainOpt: string | undefined,
  deps: FilehubDeps,
  dryRun: boolean,
): CmdResult {
  const root = deps.resolvePath(deps.expandTilde(rootArg));
  if (existsSync(root) && !statSync(root).isDirectory()) {
    fail(`not a directory: ${root}`);
  }
  const lines: string[] = [];

  if (dryRun) {
    lines.push(`jspace: ok: would initialize filehub at ${root}`);
    if (register) {
      registerFilehub(deps.wbRoot, root, domainOpt, lines, true);
    } else {
      lines.push(
        `jspace: hint: register later from a workbench dir with: jspace resource add filehub --type filehub --domain <domain> --path ${root} (or re-run with --register)`,
      );
    }
    return { lines };
  }

  const readme = join(root, "README.md");
  const obsidianVault =
    existsSync(join(root, ".obsidian")) && statSync(join(root, ".obsidian")).isDirectory();

  // Always ensure the skeleton dirs (mkdir is idempotent; never touches user
  // files). Write the README only when missing, so a re-run is a no-op.
  mkdirSync(root, { recursive: true });
  for (const d of ["_inbox", "projects", "areas", "archive"]) {
    mkdirSync(join(root, d), { recursive: true });
  }
  if (!isFile(readme)) {
    writeFileSync(readme, deps.filehubReadme(deps.devRoot()), "utf-8");
    lines.push(`jspace: ok: initialized filehub at ${root}`);
  } else {
    lines.push(`jspace: ok: filehub already initialized at ${root} (skeleton kept, nothing overwritten)`);
  }
  lines.push(
    obsidianVault
      ? "jspace: info: existing Obsidian vault detected; structure is vault-compatible (no .obsidian written)"
      : "jspace: info: not an Obsidian vault yet; open this folder as a vault in Obsidian any time (structure is vault-compatible)",
  );

  if (register) {
    registerFilehub(deps.wbRoot, root, domainOpt, lines, false);
  } else {
    lines.push(
      `jspace: hint: register later from a workbench dir with: jspace resource add filehub --type filehub --domain <domain> --path ${root} (or re-run with --register)`,
    );
  }
  return { lines };
}
