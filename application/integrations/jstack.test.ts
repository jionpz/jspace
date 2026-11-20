// application/integrations/jstack.test.ts — workbench-only integration lifecycle.
import { expect, test } from "bun:test";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync,
  rmSync, writeFileSync, symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initWorkbench } from "../workspace/init.ts";
import { materializeTree, expandTilde, isCompiled, devRoot } from "../../cli/embed.ts";
import { resolvePath } from "../../cli/paths.ts";
import { BUNDLE_MANIFEST } from "../../cli/manifest.generated.ts";
import { ASSETS } from "../../cli/assets.generated.ts";
import { decodeIntegrations } from "../../core/contracts/integrations.ts";
import {
  JSTACK_BRIDGE_ASSET, enableJstack, disableJstack, readIntegrations, jstackStatus,
  jstackIntegrationStatus, refreshEnabledJstack, checkJstackIntegration,
} from "./jstack.ts";
import { workspaceUpgrade } from "../workspace/workspace.ts";

const BRIDGE = ASSETS[JSTACK_BRIDGE_ASSET];
function workbench(): string {
  const root = mkdtempSync(join(tmpdir(), "jspace-jstack-"));
  initWorkbench(root, false, {
    resolvePath, expandTilde, isCompiled, devRoot,
    materialize: materializeTree, manifest: BUNDLE_MANIFEST,
  });
  return root;
}
const skill = (root: string) => join(root, ".jspace", "skills", "jspace-jstack", "SKILL.md");
const state = (root: string) => join(root, ".jspace", "integrations.json");
const projection = (root: string) => join(root, ".agents", "skills", "jspace-jstack");
function inWorkbench(fn: (root: string) => void): void {
  const root = workbench();
  try { fn(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("contract strictly rejects unknown fields and enabled bridge without fingerprint", () => {
  expect(decodeIntegrations({ schema_version: 1, integrations: { jstack: { enabled: false } } }).ok).toBe(true);
  expect(decodeIntegrations({ schema_version: 1, integrations: { jstack: { enabled: true } } }).ok).toBe(false);
  expect(decodeIntegrations({ schema_version: 1, integrations: { jstack: { enabled: false, extra: 1 } } }).ok).toBe(false);
  expect(decodeIntegrations({ schema_version: 1, integrations: {}, unknown: 123 }).ok).toBe(false);
  expect(decodeIntegrations({ schema_version: 2, integrations: {} }).ok).toBe(false);
});

test("default workbench ships disabled integration, zero bridge skills", () => inWorkbench((root) => {
  expect(readIntegrations(root)).toMatchObject({ status: "ok", value: { integrations: { jstack: { enabled: false } } } });
  expect(existsSync(skill(root))).toBe(false);
  expect(existsSync(projection(root))).toBe(false);
  expect(jstackIntegrationStatus(root, BRIDGE).lines.join("\n")).toContain("disabled");
  expect(checkJstackIntegration(root)).toEqual([]);
}));

test("enable creates one authoritative skill and per-harness thin links; idempotent", () => inWorkbench((root) => {
  const first = enableJstack(root, BRIDGE);
  expect(first.lines.join("\n")).toContain("enabled");
  expect(readFileSync(skill(root), "utf8")).toBe(BRIDGE);
  expect(lstatSync(projection(root)).isSymbolicLink()).toBe(true);
  expect(resolve(join(root, ".agents", "skills"), readlinkSync(projection(root)))).toBe(join(root, ".jspace", "skills", "jspace-jstack"));
  expect(jstackStatus(root, BRIDGE).enabled).toBe(true);
  expect(checkJstackIntegration(root)).toEqual([]);
  expect(enableJstack(root, BRIDGE).lines.join("\n")).toContain("already enabled");
}));

test("dry-run enable/disable performs no writes", () => inWorkbench((root) => {
  const initial = readFileSync(state(root), "utf8");
  enableJstack(root, BRIDGE, true);
  expect(readFileSync(state(root), "utf8")).toBe(initial);
  expect(existsSync(skill(root))).toBe(false);
  enableJstack(root, BRIDGE);
  const enabledState = readFileSync(state(root), "utf8");
  disableJstack(root, true);
  expect(readFileSync(state(root), "utf8")).toBe(enabledState);
  expect(existsSync(projection(root))).toBe(true);
}));

test("disable removes only workbench-owned projections; unrelated project untouched", () => inWorkbench((root) => {
  const project = join(root, "an-external-project");
  mkdirSync(join(project, ".jstack"), { recursive: true });
  writeFileSync(join(project, ".jstack", "lock.json"), "{}\n");
  enableJstack(root, BRIDGE);
  disableJstack(root);
  expect(existsSync(skill(root))).toBe(false);
  expect(existsSync(projection(root))).toBe(false);
  expect(readFileSync(join(project, ".jstack", "lock.json"), "utf8")).toBe("{}\n");
  expect(jstackStatus(root).enabled).toBe(false);
  expect(disableJstack(root).lines.join("\n")).toContain("already disabled");
}));

test("modified skill is preserved: enable refuses overwrite and disable preserves source", () => inWorkbench((root) => {
  enableJstack(root, BRIDGE);
  writeFileSync(skill(root), BRIDGE + "\nmy local customization\n");
  expect(() => enableJstack(root, BRIDGE)).toThrow(/local edits/);
  const result = disableJstack(root);
  expect(result.warnings?.join("\n")).toContain("preserved");
  expect(readFileSync(skill(root), "utf8")).toContain("my local customization");
  expect(existsSync(projection(root))).toBe(false);
  expect(checkJstackIntegration(root).map((d) => d.code)).toContain("integrations.jstack.disabled-residue");
}));

test("foreign projection collision is rejected without modifying user data", () => inWorkbench((root) => {
  const outside = mkdtempSync(join(tmpdir(), "jstack-foreign-"));
  try {
    const foreign = projection(root);
    mkdirSync(join(root, ".agents", "skills"), { recursive: true });
    symlinkSync(outside, foreign, "dir");
    const initial = readFileSync(state(root), "utf8");
    expect(() => enableJstack(root, BRIDGE)).toThrow(/collision/);
    expect(readFileSync(state(root), "utf8")).toBe(initial);
    expect(resolve(join(root, ".agents", "skills"), readlinkSync(foreign))).toBe(outside);
  } finally { rmSync(outside, { recursive: true, force: true }); }
}));

test("refresh upgrades unchanged bridge and preserves enabled choice", () => inWorkbench((root) => {
  enableJstack(root, BRIDGE);
  const nextBridge = BRIDGE + "\n<!-- updated bridge -->\n";
  const result = refreshEnabledJstack(root, nextBridge);
  expect(result.exitCode).toBeUndefined();
  expect(readFileSync(skill(root), "utf8")).toBe(nextBridge);
  expect(jstackStatus(root, nextBridge).enabled).toBe(true);
  expect(jstackStatus(root, nextBridge).bundled_bridge_current).toBe(true);
}));

test("refresh fails closed on local modifications and does not disable the integration", () => inWorkbench((root) => {
  enableJstack(root, BRIDGE);
  writeFileSync(skill(root), BRIDGE + "\nuser-owned customization\n");
  const result = refreshEnabledJstack(root, BRIDGE + "\n<!-- new -->\n");
  expect(result.exitCode).toBe(1);
  expect(result.warnings?.join("\n")).toContain("preserved");
  expect(jstackStatus(root).enabled).toBe(true);
  expect(readFileSync(skill(root), "utf8")).toContain("user-owned customization");
}));

test("doctor detects malformed integration state and broken projection", () => inWorkbench((root) => {
  writeFileSync(state(root), "{ this is not JSON }");
  expect(checkJstackIntegration(root).map((d) => d.code)).toContain("integrations.parse");
  expect(() => enableJstack(root, BRIDGE)).toThrow(/damaged/);
  writeFileSync(state(root), JSON.stringify({ schema_version: 1, integrations: { jstack: { enabled: false } } }));
  enableJstack(root, BRIDGE);
  rmSync(projection(root));
  expect(checkJstackIntegration(root).map((d) => d.code)).toContain("integrations.jstack.projection-invalid");
}));

test("normal workspace upgrade leaves enabled opt-in state and bridge intact", () => inWorkbench((root) => {
  enableJstack(root, BRIDGE);
  const before = readFileSync(state(root), "utf8");
  const upgrade = workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, {
    manifest: BUNDLE_MANIFEST,
    assets: ASSETS,
    readFile: (path) => { try { return readFileSync(path, "utf8"); } catch { return null; } },
    writeFile: (path, content) => writeFileSync(path, content, "utf8"),
  });
  expect(upgrade.exitCode).toBeUndefined();
  expect(readFileSync(state(root), "utf8")).toBe(before);
  expect(existsSync(skill(root))).toBe(true);
  expect(jstackStatus(root).enabled).toBe(true);
}));
