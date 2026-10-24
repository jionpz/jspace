import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { filehubRefresh } from "./refresh.ts";
import { NAV_BLOCK_START, NAV_PROJECTS_BLOCK_START } from "./navigation.ts";

let wb: string;
let root: string;

interface RefreshData {
  root: string;
  changed: boolean;
  dryRun?: boolean;
  partial?: boolean;
  files: { path: string; action: string; error?: string }[];
}

function run(dryRun = false, json = true) {
  return filehubRefresh({ wbRoot: wb }, dryRun, json);
}

function data(result: ReturnType<typeof run>): RefreshData {
  return result.data as RefreshData;
}

beforeEach(() => {
  wb = mkdtempSync(join(tmpdir(), "jspace-filehub-refresh-"));
  root = join(wb, "filehub");
  mkdirSync(join(root, "projects", "acme"), { recursive: true });
  mkdirSync(join(root, "projects", "old"), { recursive: true });
  mkdirSync(join(root, "projects", "stray"), { recursive: true });
  mkdirSync(join(root, "areas", "research"), { recursive: true });
  writeFileSync(join(root, "projects", "acme", "index.md"), "# Acme\n");
  writeFileSync(join(root, "projects", "old", "index.md"), "# Old\n");
  writeFileSync(join(root, "areas", "research", "index.md"), "# Research\n");
  mkdirSync(join(wb, ".jspace"), { recursive: true });
  writeFileSync(
    join(wb, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [
        {
          id: "filehub",
          type: "filehub",
          domain: "files",
          entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }],
        },
      ],
      projects: [
        { id: "acme", domain: "files", asset_rel_path: "projects/acme", status: "active" },
        { id: "old", domain: "files", asset_rel_path: "projects/old", status: "archived" },
        { id: "gap", domain: "files", asset_rel_path: "projects/gap", status: "active" },
      ],
    }),
  );
  writeFileSync(
    join(wb, ".jspace", "local.json"),
    JSON.stringify({ schema_version: 1, installation_id: "inst", bindings: { "filehub-path": root } }),
  );
});

afterEach(() => {
  rmSync(wb, { recursive: true, force: true });
});

describe("filehubRefresh", () => {
  test("creates both navigation blocks and then reports a no-op", () => {
    const first = run();
    expect(first.exitCode).toBeUndefined();
    expect(existsSync(join(root, "README.md"))).toBe(true);
    expect(existsSync(join(root, "projects", "README.md"))).toBe(true);
    expect(readFileSync(join(root, "README.md"), "utf-8")).toContain(NAV_BLOCK_START);
    expect(readFileSync(join(root, "projects", "README.md"), "utf-8")).toContain(
      NAV_PROJECTS_BLOCK_START,
    );
    expect(data(first).changed).toBe(true);

    const second = run();
    expect(data(second).changed).toBe(false);
    expect(data(second).files.map((file) => file.action)).toEqual(["no-op", "no-op"]);
  });

  test("shows active, archived and unregistered directories in their own views", () => {
    run();
    const rootReadme = readFileSync(join(root, "README.md"), "utf-8");
    expect(rootReadme).toContain("projects/acme/index.md");
    expect(rootReadme).not.toContain("projects/old");
    expect(rootReadme).toContain("areas/research/index.md");

    const projectsReadme = readFileSync(join(root, "projects", "README.md"), "utf-8");
    expect(projectsReadme).toContain("[acme](acme/index.md)");
    expect(projectsReadme).toContain("[old](old/index.md)");
    expect(projectsReadme).toContain("projects/stray");
    expect(projectsReadme).toContain("- gap — 待补 `projects/gap/index.md`");
  });

  test("dry-run writes nothing but reports the same plan", () => {
    const result = run(true);
    expect(existsSync(join(root, "README.md"))).toBe(false);
    expect(existsSync(join(root, "projects", "README.md"))).toBe(false);
    expect(data(result).dryRun).toBe(true);
    expect(data(result).changed).toBe(true);
    expect(data(result).files.map((file) => file.action)).toEqual(["create", "create"]);
  });

  test("preserves user text outside the block on update", () => {
    writeFileSync(join(root, "README.md"), "# My filehub\n\nkeep me\n");
    writeFileSync(join(root, "projects", "README.md"), "# My projects\n");
    run();

    // User text lives outside the markers and must survive a registry change.
    writeFileSync(
      join(root, "README.md"),
      `${readFileSync(join(root, "README.md"), "utf-8")}\nextra note\n`,
    );
    writeFileSync(
      join(root, "projects", "README.md"),
      `${readFileSync(join(root, "projects", "README.md"), "utf-8")}tail note\n`,
    );
    const hubPath = join(wb, ".jspace", "hub.json");
    const hub = JSON.parse(readFileSync(hubPath, "utf-8"));
    hub.projects[1].status = "active";
    writeFileSync(hubPath, JSON.stringify(hub));

    const updated = run();
    expect(data(updated).files.map((file) => file.action)).toContain("update");
    expect(readFileSync(join(root, "README.md"), "utf-8")).toContain("extra note");
    expect(readFileSync(join(root, "projects", "README.md"), "utf-8")).toContain("tail note");
  });

  test.skipIf(process.getuid?.() === 0 || process.platform === "win32")(
    "an unreadable owner index is a gap, not a link",
    () => {
      chmodSync(join(root, "projects", "acme", "index.md"), 0o000);
      run();
      const rootReadme = readFileSync(join(root, "README.md"), "utf-8");
      expect(rootReadme).toContain("- acme — 待补 `projects/acme/index.md`");
      expect(rootReadme).not.toContain("(projects/acme/index.md)");
    },
  );

  test("a malformed block in either file blocks both writes", () => {
    writeFileSync(join(root, "projects", "README.md"), `${NAV_PROJECTS_BLOCK_START}\n`);
    const result = run();
    expect(result.exitCode).toBe(1);
    expect(data(result).changed).toBe(false);
    expect(data(result).files.map((file) => file.action)).toContain("conflict");
    expect(existsSync(join(root, "README.md"))).toBe(false);
  });

  test("refuses a symlinked README instead of following it", () => {
    const target = join(wb, "outside.md");
    writeFileSync(target, "# outside\n");
    symlinkSync(target, join(root, "README.md"));
    const result = run();
    expect(result.exitCode).toBe(1);
    expect(existsSync(join(root, "projects", "README.md"))).toBe(false);
    expect(readFileSync(target, "utf-8")).toBe("# outside\n");
  });

  test("a failed second write reports partial and a re-run converges", () => {
    const writes: string[] = [];
    const failing = filehubRefresh(
      {
        wbRoot: wb,
        write: (path, content) => {
          writes.push(path);
          if (path.endsWith(join("filehub", "README.md"))) throw new Error("disk full");
          writeFileSync(path, content);
        },
      },
      false,
      true,
    );
    expect(failing.exitCode).toBe(1);
    expect(data(failing).partial).toBe(true);
    expect(writes.at(-1)).toBe(join(root, "README.md"));
    expect(existsSync(join(root, "projects", "README.md"))).toBe(true);
    expect(existsSync(join(root, "README.md"))).toBe(false);

    const retry = run();
    expect(retry.exitCode).toBeUndefined();
    expect(existsSync(join(root, "README.md"))).toBe(true);
    expect(data(retry).files.map((file) => file.action)).toEqual(["no-op", "create"]);
  });

  test("an unregistered workbench fails without touching anything", () => {
    writeFileSync(
      join(wb, ".jspace", "local.json"),
      JSON.stringify({ schema_version: 1, installation_id: "inst", bindings: {} }),
    );
    expect(() => run()).toThrow(/no registered filehub/);
    expect(existsSync(join(root, "README.md"))).toBe(false);
  });
});
