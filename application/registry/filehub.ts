// application/registry/filehub.ts — `jspace filehub init` use case (moved from cli/cmds.ts).
import { existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail } from "../../core/shared/errors.ts";
import type { CmdResult } from "../commands/command.ts";
import { isId } from "../../core/contracts/ids.ts";
import { PairedWriteError, writeBytesAtomic, writeHubAndLocal } from "../../adapters/fs/workbench-state.ts";
import { extractFilehubContractBlock, inspectFilehubContractBlock, replaceFilehubContractBlock } from "./filehub-block.ts";
import { resolveFilehubRoot } from "./filehub-lookup.ts";

export {
  extractFilehubContractBlock,
  inspectFilehubContractBlock,
  replaceFilehubContractBlock,
  parseFilehubContractVersion,
  FILEHUB_BLOCK_START,
  FILEHUB_BLOCK_END,
  FILEHUB_CONTRACT_VERSION,
} from "./filehub-block.ts";
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
  filehubReadme: () => string;
  devRoot: () => string;
  /** workbench root for --register (current cwd) */
  wbRoot: string;
}

/** Dependencies for the explicit README-contract upgrade use case. */
export interface FilehubUpgradeDeps {
  resolvePath: (p: string) => string;
  expandTilde: (p: string) => string;
  filehubReadme: () => string;
  /** workbench root used to resolve the registered filehub when no path is given */
  wbRoot: string;
}

/** `jspace filehub upgrade [path]` — replace/insert ONLY the managed contract
 *  block in the filehub README. Never moves, renames or deletes assets; never
 *  touches hub.json/local.json. Marker damage or a symlinked README is refused
 *  so a damaged file is never half-rewritten. Idempotent: an already-current
 *  block is a no-op with no write. */
export function filehubUpgrade(
  pathArg: string | undefined,
  deps: FilehubUpgradeDeps,
  dryRun: boolean,
): CmdResult {
  const explicit = pathArg !== undefined && pathArg.trim().length > 0;
  const root = explicit
    ? deps.resolvePath(deps.expandTilde(pathArg as string))
    : resolveFilehubRoot(deps.wbRoot);
  if (root === null) {
    fail(
      "no registered filehub found; pass an explicit path (jspace filehub upgrade <path>) " +
        "or register one with: jspace filehub init <path> --register",
    );
  }

  let rootStat: ReturnType<typeof statSync>;
  try {
    rootStat = statSync(root);
  } catch {
    fail(`filehub root not found: ${root}`);
  }
  if (!rootStat.isDirectory()) fail(`not a directory: ${root}`);

  const readme = join(root, "README.md");
  const template = deps.filehubReadme();
  const block = extractFilehubContractBlock(template);
  if (block === null) {
    fail("embedded filehub README is missing the JSPACE:FILEHUB contract block (template error)");
  }

  const lines: string[] = [];
  let action: "create-readme" | "create-block" | "update-block" | "no-op";
  let next: string;

  if (!existsSync(readme)) {
    action = "create-readme";
    next = template;
  } else {
    if (lstatSync(readme).isSymbolicLink()) {
      fail(`refusing to write a symlinked README: ${readme} (replace it with a regular file first)`);
    }
    if (!statSync(readme).isFile()) fail(`not a file: ${readme}`);
    const current = readFileSync(readme, "utf-8");
    const state = inspectFilehubContractBlock(current);
    if (state.kind === "malformed") {
      fail(
        `filehub README has a malformed JSPACE:FILEHUB block (${state.reason}); ` +
          `fix the markers by hand, then re-run: ${readme}`,
      );
    }
    next = replaceFilehubContractBlock(current, block);
    action = next === current ? "no-op" : state.kind === "ok" ? "update-block" : "create-block";
  }

  if (action === "no-op") {
    lines.push(`jspace: ok: no-op: filehub README contract is current (${readme})`);
    lines.push("jspace: info: assets untouched (only the README contract block is managed)");
    return { lines };
  }

  if (dryRun) {
    lines.push(`jspace: ok: would ${action}: ${readme} (dry-run, nothing written)`);
    lines.push("jspace: info: assets untouched (only the README contract block is managed)");
    return { lines };
  }

  writeBytesAtomic(readme, next);
  lines.push(`jspace: ok: ${action}: ${readme}`);
  lines.push("jspace: info: assets untouched (only the README contract block is managed)");
  return { lines };
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
    notes: "文件管理中心(资产层本体);归位/整理见 .jspace/skills/asset-ingest",
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
    writeFileSync(readme, deps.filehubReadme(), "utf-8");
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
