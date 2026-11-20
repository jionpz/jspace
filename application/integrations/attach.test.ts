// application/integrations/attach.test.ts — explicit JStack install delegation.
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkbench } from "../workspace/init.ts";
import { materializeTree, expandTilde, isCompiled, devRoot } from "../../cli/embed.ts";
import { resolvePath } from "../../cli/paths.ts";
import { BUNDLE_MANIFEST } from "../../cli/manifest.generated.ts";
import { ASSETS } from "../../cli/assets.generated.ts";
import { domainAdd } from "../registry/domain.ts";
import { resourceAdd } from "../registry/resource.ts";
import { attachJstack, type JStackRunner } from "./attach.ts";
import { JSTACK_BRIDGE_ASSET, enableJstack } from "./jstack.ts";

function tempFixture(fn: (root: string, repo: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "jspace-jstack-attach-"));
  const repo = mkdtempSync(join(tmpdir(), "jstack-project-"));
  try {
    initWorkbench(root, false, {
      resolvePath, expandTilde, isCompiled, devRoot,
      materialize: materializeTree, manifest: BUNDLE_MANIFEST,
    });
    execFileSync("git", ["init", "-q", repo]);
    enableJstack(root, ASSETS[JSTACK_BRIDGE_ASSET]);
    fn(root, repo);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
}
function register(root: string, repo: string): void {
  domainAdd(root, "engineering", undefined, undefined, "software", false);
  resourceAdd(root, "example-code", "engineering", "project", repo, undefined, undefined, undefined, false);
}
test("attach rejects unregistered Git roots before it tries to execute a script", () => tempFixture((root, repo) => {
  let called = false;
  expect(() => attachJstack(root, repo, "/some/source", true, {
    runner: () => { called = true; return { exit: 0, output: "ok" }; },
    locateScript: () => "/mock/jstack",
  })).toThrow(/not a registered JSpace resource/);
  expect(called).toBe(false);
}));

test("dry-run delegates to the JStack project installer without actual install", () => tempFixture((root, repo) => {
  register(root, repo);
  const calls: string[][] = [];
  const runner: JStackRunner = (_script, args, cwd) => {
    expect(cwd).toBe(repo);
    calls.push(args);
    return { exit: 0, output: "JStack dry-run plan" };
  };
  const result = attachJstack(root, repo, "/trusted/jstack", true, {
    runner, locateScript: () => "/trusted/jstack/jstack",
  });
  expect(result.exitCode).toBeUndefined();
  expect(result.lines.join("\n")).toContain("no project files changed");
  expect(calls).toEqual([["install", "--all", "--scope", "project", "--repo", repo, "--dry-run"]]);
  expect(readFileSync(join(root, ".jspace", "integrations.json"), "utf8")).toContain('"enabled": true');
}));

test("actual attach runs dry-run -> project install -> doctor in order", () => tempFixture((root, repo) => {
  register(root, repo);
  const calls: string[][] = [];
  const result = attachJstack(root, repo, "/trusted/jstack", false, {
    locateScript: () => "/trusted/jstack/jstack",
    runner: (_script, args) => {
      calls.push(args);
      return { exit: 0, output: "ok" };
    },
  });
  expect(result.exitCode).toBeUndefined();
  expect(calls.map((args) => args[0])).toEqual(["install", "install", "doctor"]);
  expect(calls[1]).toEqual(["install", "--all", "--scope", "project", "--repo", repo]);
  expect(calls[2]).toEqual(["doctor", "--repo", repo, "--json"]);
  expect(result.lines.join("\n")).toContain("configuration checked; runtime phase enforcement not proven");
}));

test("attach stops after failed dry-run, and doctor failure is not reported as verified", () => tempFixture((root, repo) => {
  register(root, repo);
  let call = 0;
  const deps = {
    locateScript: () => "/trusted/jstack/jstack",
    runner: () => {
      call++;
      return { exit: call === 1 ? 1 : 0, output: "problem" };
    },
  };
  expect(attachJstack(root, repo, "/trusted/jstack", false, deps).exitCode).toBe(1);
  expect(call).toBe(1);
  call = 0;
  const result = attachJstack(root, repo, "/trusted/jstack", false, {
    locateScript: deps.locateScript,
    runner: () => ({ exit: ++call === 3 ? 1 : 0, output: "output" }),
  });
  expect(result.exitCode).toBe(1);
  expect(result.lines.join("\n")).toContain("could not confirm");
}));

test("attach reports missing JStack source cleanly without touching the project", () => tempFixture((root, repo) => {
  register(root, repo);
  expect(() => attachJstack(root, repo, join(root, "missing-checkout"), true)).toThrow(/trusted JStack checkout does not exist/);
}));

test("attach rejects nested source paths to prevent installer self-modification", () => tempFixture((root, repo) => {
  register(root, repo);
  const nestedSource = join(repo, "jstack-checkout");
  mkdirSync(nestedSource);
  expect(() => attachJstack(root, repo, nestedSource, true)).toThrow(/must not overlap/);
}));

test("attach refuses disabled workbench integration", () => tempFixture((root, repo) => {
  register(root, repo);
  const statePath = join(root, ".jspace", "integrations.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  state.integrations.jstack = { enabled: false };
  writeFileSync(statePath, JSON.stringify(state));
  expect(() => attachJstack(root, repo, "/trusted", true, {
    locateScript: () => "/trusted/jstack",
    runner: () => ({ exit: 0, output: "ok" }),
  })).toThrow(/not enabled/);
}));
