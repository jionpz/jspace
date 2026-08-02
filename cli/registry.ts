// cli/registry.ts — hub.json load/save + validation (mirrors Python validate_hub).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fail } from "./errors.ts";
import { isFile, resolvePath } from "./paths.ts";

export const REGISTRY_FILE = ".jspace/hub.json";
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function workbenchRoot(): string {
  return resolvePath(process.cwd());
}

/** Mirrors pathlib child.relative_to(parent) succeeding. */
export function isWithin(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function loadRegistry(root: string): Record<string, unknown> {
  const p = join(root, REGISTRY_FILE);
  if (!isFile(p)) fail(`registry not found: ${p}`);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(p, "utf-8"));
  } catch (e) {
    fail(`${REGISTRY_FILE} is not valid JSON: ${(e as Error).message}`);
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail(`${REGISTRY_FILE} root must be an object`);
  }
  return data as Record<string, unknown>;
}

export function saveRegistry(root: string, data: unknown): void {
  writeFileSync(
    join(root, REGISTRY_FILE),
    JSON.stringify(data, null, 2) + "\n",
    "utf-8",
  );
}

export function cleanTags(tags: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const t of tags ?? []) {
    const s = (t ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function findIndex(records: unknown[], id: string): number | null {
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (r && typeof r === "object" && !Array.isArray(r) && (r as Record<string, unknown>).id === id) {
      return i;
    }
  }
  return null;
}

/** Mirrors Python validate_hub(data, root, warnings) -> errors. */
export function validateHub(
  data: unknown,
  root: string,
  warnings: string[],
): string[] {
  const errors: string[] = [];
  const check = (cond: boolean, msg: string) => {
    if (!cond) errors.push(msg);
  };
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);

  if (!isObj(data)) return ["hub.json root must be an object"];

  check(data.version === "3", 'hub.json version must be "3"');
  const domains = data.domains;
  const resources = data.resources;
  check(Array.isArray(domains), "hub.json domains must be an array");
  check(Array.isArray(resources), "hub.json resources must be an array");
  if (!Array.isArray(domains) || !Array.isArray(resources)) return errors;

  const domainIds: string[] = [];
  const seenIds = new Set<string>();

  domains.forEach((item, index) => {
    const prefix = `domains[${index}]`;
    check(isObj(item), `${prefix} must be an object`);
    if (!isObj(item)) return;
    const domainId = item.id;
    const domainPath = item.path;
    check(
      typeof domainId === "string" && !!domainId,
      `${prefix}.id must be a non-empty string`,
    );
    check(
      typeof domainPath === "string" && !!domainPath,
      `${prefix}.path must be a non-empty string`,
    );
    if (typeof domainId === "string" && domainId) {
      check(
        ID_PATTERN.test(domainId),
        `${prefix}.id must match [a-z0-9][a-z0-9-]*`,
      );
      check(!seenIds.has(domainId), `duplicate id: ${domainId}`);
      seenIds.add(domainId);
      domainIds.push(domainId);
    }
    if (typeof domainPath === "string" && domainPath) {
      check(!isAbsolute(domainPath), `${prefix}.path must be a relative path`);
      const domainDir = resolvePath(resolve(root, domainPath));
      check(
        isWithin(domainDir, root) && domainDir !== root,
        `${prefix}.path must resolve inside the workbench root`,
      );
      check(
        isFile(join(domainDir, "README.md")),
        `missing domain context: ${domainPath}/README.md`,
      );
      check(
        isFile(join(domainDir, "domain.json")),
        `missing domain metadata: ${domainPath}/domain.json`,
      );
      const metadataPath = join(domainDir, "domain.json");
      if (isFile(metadataPath)) {
        try {
          const metadata: unknown = JSON.parse(readFileSync(metadataPath, "utf-8"));
          if (isObj(metadata)) {
            check(
              metadata.id === domainId,
              `${prefix}.id must match ${domainPath}/domain.json id`,
            );
            const purpose = metadata.purpose;
            check(
              typeof purpose === "string" && !!purpose,
              `${prefix}/domain.json purpose must be non-empty`,
            );
          }
        } catch {
          errors.push(`${domainPath}/domain.json is not valid JSON`);
        }
      }
    }
  });

  resources.forEach((item, index) => {
    const prefix = `resources[${index}]`;
    check(isObj(item), `${prefix} must be an object`);
    if (!isObj(item)) return;
    const resourceId = item.id;
    const resourceDomain = item.domain;
    const entrypoints = item.entrypoints;
    check(
      typeof resourceId === "string" && !!resourceId,
      `${prefix}.id must be a non-empty string`,
    );
    if (typeof resourceId === "string" && resourceId) {
      check(
        ID_PATTERN.test(resourceId),
        `${prefix}.id must match [a-z0-9][a-z0-9-]*`,
      );
      check(!seenIds.has(resourceId), `duplicate id: ${resourceId}`);
      seenIds.add(resourceId);
    }
    check(
      typeof resourceDomain === "string" && domainIds.includes(resourceDomain),
      `${prefix}.domain must reference a registered domain`,
    );
    check(
      Array.isArray(entrypoints) && entrypoints.length > 0,
      `${prefix}.entrypoints must be a non-empty array`,
    );
    if (!Array.isArray(entrypoints)) return;

    let pathEntrypoints = 0;
    let primaryPaths = 0;
    entrypoints.forEach((entry, entryIndex) => {
      const entryPrefix = `${prefix}.entrypoints[${entryIndex}]`;
      check(isObj(entry), `${entryPrefix} must be an object`);
      if (!isObj(entry)) return;
      const kind = entry.kind;
      const value = entry.value;
      check(kind === "path" || kind === "url", `${entryPrefix}.kind must be path or url`);
      check(
        typeof value === "string" && !!value,
        `${entryPrefix}.value must be a non-empty string`,
      );
      if (kind === "path") {
        pathEntrypoints += 1;
        check(
          typeof value === "string" && isAbsolute(value),
          `${entryPrefix}.value must be an absolute path`,
        );
        if (entry.primary === true) primaryPaths += 1;
      }
      if ("primary" in entry && kind !== "path") {
        check(false, `${entryPrefix}.primary is only valid on path entrypoints`);
      }
      // Python: entry.get("primary") not in (None, True, False)  — 0/1 pass because == semantics.
      const pr = entry.primary;
      const prValid =
        pr === undefined || pr === null || pr === true || pr === false ||
        pr === 0 || pr === 1;
      check(prValid, `${entryPrefix}.primary must be boolean`);
    });

    if (pathEntrypoints > 0) {
      check(
        primaryPaths === 1,
        `${prefix} must have exactly one primary path entrypoint`,
      );
      for (const entry of entrypoints) {
        if (
          isObj(entry) &&
          entry.kind === "path" &&
          entry.primary === true &&
          typeof entry.value === "string"
        ) {
          if (!existsSync(entry.value)) {
            warnings.push(`${prefix} primary path missing: ${entry.value}`);
          }
        }
      }
    }
  });

  return errors;
}
