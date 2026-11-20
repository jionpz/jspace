// application/integrations/jstack.test.ts — workbench-only integration lifecycle.
import { expect, test } from "bun:test";
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync,
  rmSync, writeFileSync, symlinkSync, unlinkSync,
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
  jstackIntegrationStatus, previewEnabledJstack, checkJstackIntegration,
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

test("one-skill enable never sweeps unrelated empty skill directories", () => inWorkbench((root) => {
  const unrelated = join(root, ".claude", "skills", "my-own-empty-skill");
  mkdirSync(unrelated);
  enableJstack(root, BRIDGE);
  expect(existsSync(unrelated)).toBe(true);
}));

test("enable rejects symlinked parent directory to prevent writes outside the workbench", () => inWorkbench((root) => {
  const outside = mkdtempSync(join(tmpdir(), "jspace-outside-skills-"));
  try {
    rmSync(join(root, ".agents", "skills"), { recursive: true, force: true });
    symlinkSync(outside, join(root, ".agents", "skills"), "dir");
    expect(() => enableJstack(root, BRIDGE)).toThrow(/parent must be a normal directory/);
    expect(readdirSync(outside)).toEqual([]);
    expect(readIntegrations(root)).toMatchObject({ status: "ok", value: { integrations: { jstack: { enabled: false } } } });
  } finally { rmSync(outside, { recursive: true, force: true }); }
}));

test("enable refuses a symlinked mutation-lock directory without touching its external target", () => inWorkbench((root) => {
  const outside = mkdtempSync(join(tmpdir(), "jspace-outside-lock-"));
  try {
    rmSync(join(root, ".jspace", "state", "locks"), { recursive: true, force: true });
    symlinkSync(outside, join(root, ".jspace", "state", "locks"), "dir");
    expect(() => enableJstack(root, BRIDGE)).toThrow(/parent must be a normal directory/);
    expect(readdirSync(outside)).toEqual([]);
  } finally { rmSync(outside, { recursive: true, force: true }); }
}));

test("doctor reports a symlinked parent introduced after integration was enabled", () => inWorkbench((root) => {
  enableJstack(root, BRIDGE);
  const outside = mkdtempSync(join(tmpdir(), "jspace-doctor-outside-"));
  const proj = join(root, ".agents", "skills");
  try {
    rmSync(proj, { recursive: true, force: true });
    symlinkSync(outside, proj, "dir");
    expect(jstackStatus(root).parent_safe).toBe(false);
    expect(checkJstackIntegration(root).map((d) => d.code)).toContain("integrations.jstack.parent-unsafe");
    expect(jstackIntegrationStatus(root, BRIDGE).exitCode).toBe(1);
  } finally { rmSync(outside, { recursive: true, force: true }); }
}));

test("missing integration config warns when an old bridge or projected entry remains", () => inWorkbench((root) => {
  enableJstack(root, BRIDGE);
  rmSync(state(root));
  expect(checkJstackIntegration(root).map((d) => d.code)).toContain("integrations.jstack.untracked-residue");
}));

test("refresh upgrades unchanged bridge and preserves enabled choice", () => inWorkbench((root) => {
  enableJstack(root, BRIDGE);
  const nextBridge = BRIDGE + "\n<!-- updated bridge -->\n";
  const result = enableJstack(root, nextBridge);
  expect(result.exitCode).toBeUndefined();
  expect(readFileSync(skill(root), "utf8")).toBe(nextBridge);
  expect(jstackStatus(root, nextBridge).enabled).toBe(true);
  expect(jstackStatus(root, nextBridge).bundled_bridge_current).toBe(true);
}));

test("upgrade preview truthfully shows a pending bridge refresh without writing state", () => inWorkbench((root) => {
  enableJstack(root, BRIDGE);
  const oldState = readFileSync(state(root), "utf8");
  const oldBridge = readFileSync(skill(root), "utf8");
  const newer = BRIDGE + "\n<!-- next version -->\n";
  const preview = previewEnabledJstack(root, newer);
  expect(preview.lines.join("\n")).toContain("bridge refresh or repair is available");
  expect(readFileSync(state(root), "utf8")).toBe(oldState);
  expect(readFileSync(skill(root), "utf8")).toBe(oldBridge);
  expect(previewEnabledJstack(root, BRIDGE).lines).toEqual([]);
}));

test("refresh fails closed on local modifications and does not disable the integration", () => inWorkbench((root) => {
  enableJstack(root, BRIDGE);
  writeFileSync(skill(root), BRIDGE + "\nuser-owned customization\n");
  const result = previewEnabledJstack(root, BRIDGE + "\n<!-- new -->\n");
  expect(result.warnings?.join("\n")).toContain("manual attention");
  expect(jstackStatus(root).enabled).toBe(true);
  expect(readFileSync(skill(root), "utf8")).toContain("user-owned customization");
}));

test("doctor refuses symlinked integration JSON without following it", () => inWorkbench((root) => {
  const outside = mkdtempSync(join(tmpdir(), "jspace-symlink-state-"));
  try {
    const config = state(root);
    rmSync(config);
    const source = join(outside, "outside.json");
    writeFileSync(source, '{"schema_version":1,"integrations":{"jstack":{"enabled":false}}}');
    symlinkSync(source, config);
    expect(readIntegrations(root).status).toBe("invalid");
    expect(checkJstackIntegration(root).map((d) => d.code)).toContain("integrations.file-type");
    expect(() => enableJstack(root, BRIDGE)).toThrow(/damaged/);
    expect(readFileSync(source, "utf8")).toContain("false");
  } finally { rmSync(outside, { recursive: true, force: true }); }
}));

test("doctor detects malformed integration state and broken projection", () => inWorkbench((root) => {
  writeFileSync(state(root), "{ this is not JSON }");
  expect(checkJstackIntegration(root).map((d) => d.code)).toContain("integrations.parse");
  expect(() => enableJstack(root, BRIDGE)).toThrow(/damaged/);
  writeFileSync(state(root), JSON.stringify({ schema_version: 1, integrations: { jstack: { enabled: false } } }));
  enableJstack(root, BRIDGE);
  unlinkSync(projection(root)); // remove the link itself, not its target (Windows-safe)
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
