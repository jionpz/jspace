// application/workspace/legacy-data-migrations.test.ts — migration-only
// contracts. These fixtures exercise old schema readers without changing the
// normal runtime contracts.
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import type { DistributionManifestV1 } from "../../core/contracts/distribution.ts";
import type { HubV1 } from "../../core/contracts/hub.ts";
import { decodeIngestJournal } from "../../core/contracts/ingest.ts";
import { decodePendingEnvelope, ENVELOPE_EXT } from "../../core/contracts/pending.ts";
import { MATERIALIZED_FILE, readMaterializedJournal } from "./journal.ts";
import { sha256Of } from "./manifest.ts";
import {
  planLegacyIngestMigrations,
  planLegacyPendingMigrationsForWorkbench,
} from "./legacy-data-migrations.ts";
import { workspaceUpgrade, type UpgradeDeps } from "./workspace.ts";

const roots: string[] = [];

function tmp(prefix = "jspace-legacy-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function readText(path: string): string {
  return readFileSync(path, "utf-8");
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function emptyManifest(bundleVersion = "1.1.0"): DistributionManifestV1 {
  return { schema_version: 1, bundle_version: bundleVersion, files: [] };
}

function upgradeDeps(
  filehubRoot: string | null,
  manifest: DistributionManifestV1 = emptyManifest(),
  readOverride?: (path: string) => string | null,
): UpgradeDeps {
  const readFile = (path: string): string | null => {
    if (readOverride) {
      const overridden = readOverride(path);
      if (overridden !== null) return overridden;
    }
    try {
      return readText(path);
    } catch {
      return null;
    }
  };
  return {
    manifest,
    assets: {},
    readFile,
    writeFile: (path, content) => writeText(path, content),
    filehubRoot,
  };
}

function createWorkbench(hub: HubV1 | null = null): string {
  const root = tmp("jspace-migration-wb-");
  mkdirSync(join(root, ".jspace"), { recursive: true });
  writeText(
    join(root, ".jspace", "marker.json"),
    JSON.stringify({
      schema_version: 1,
      product: "JSpace",
      workbench_id: "wb-migration",
      template_version: "1.0.0",
      created_at: "2026-01-01",
    }, null, 2) + "\n",
  );
  if (hub !== null) {
    writeText(join(root, ".jspace", "hub.json"), JSON.stringify(hub, null, 2) + "\n");
  }
  return root;
}

const HUB: HubV1 = {
  schema_version: 1,
  domains: [{ id: "work", path: "workspace/work" }],
  resources: [],
  projects: [{ id: "acme", domain: "work", asset_rel_path: "projects/acme", status: "active" }],
};

function pendingContent(overrides: Record<string, string> = {}): string {
  const fields = {
    type: "note",
    project: "acme",
    tags: "[project, source:session]",
    source: "codex",
    ...overrides,
  };
  return [
    "---",
    ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    "---",
    "# Project state",
    "",
  ].join("\n");
}

function v1Pending(
  id: string,
  content: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 1,
    id,
    idempotencyKey: sha256Text(content),
    producer: "memory-writeback",
    slug: "project/acme/state",
    content,
    status: "staged",
    retryCount: 0,
    createdAt: "2026-10-18T120000",
    ...overrides,
  };
}

function v2Pending(
  id: string,
  content: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: 2,
    id,
    requestId: id,
    intent: "create",
    contentHash: sha256Text(content),
    contentOrigin: "tool_output",
    sourceId: "fixture:pending",
    producer: "memory-writeback",
    slug: "project/acme/state",
    content,
    status: "staged",
    retryCount: 0,
    createdAt: "2026-10-18T120000",
    ...overrides,
  };
}

function writeLegacyPending(filehub: string, value: Record<string, unknown>): string {
  const path = join(filehub, ".jspace-logs", `${value.id as string}${ENVELOPE_EXT}`);
  writeText(path, JSON.stringify(value, null, 2) + "\n");
  return path;
}

function v1Ingest(
  target: string,
  content: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const hash = sha256Text(content);
  return {
    schema_version: 1,
    id: "7c6b5a40-0000-4000-8000-000000000001",
    source: join(dirname(target), "_inbox", "doc.md"),
    target,
    relPath: "projects/acme/doc.md",
    slug: "assets/acme/doc",
    projectId: "acme",
    contentHash: hash,
    status: "index",
    indexEntry: "2026-10-18 | doc | assets/acme/doc",
    createdAt: "2026-10-18T120000",
    updatedAt: "2026-10-18T120100",
    ...overrides,
  };
}

function writeLegacyIngest(root: string, value: Record<string, unknown>): string {
  const path = join(root, ".jspace", "state", "ingest", `${value.id as string}.json`);
  writeText(path, JSON.stringify(value, null, 2) + "\n");
  return path;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("pending planner migrates only independently proven ownership and preserves conflicts", () => {
  const root = createWorkbench(HUB);
  const filehub = tmp("jspace-pending-fh-");
  const content = pendingContent();
  const validId = "11111111-1111-4111-8111-111111111111";
  writeLegacyPending(filehub, v1Pending(validId, content));

  const unregisteredId = "22222222-2222-4222-8222-222222222222";
  writeLegacyPending(
    filehub,
    v1Pending(unregisteredId, pendingContent({ project: "other" })),
  );

  const conflictId = "33333333-3333-4333-8333-333333333333";
  writeLegacyPending(filehub, v1Pending(conflictId, content));
  writeText(
    join(root, ".jspace", "state", "pending", `${conflictId}${ENVELOPE_EXT}`),
    JSON.stringify(v2Pending(conflictId, pendingContent({ tags: "[project, source:cron]" })), null, 2) + "\n",
  );

  const plan = planLegacyPendingMigrationsForWorkbench(root, {
    hub: HUB,
    filehubRoot: filehub,
    readFile: (path) => {
      try {
        return readText(path);
      } catch {
        return null;
      }
    },
  });
  expect(plan.moves.map((move) => move.id)).toEqual([validId]);
  expect(plan.notices.some((item) => item.code === "pending.legacy.owner" && item.subject === unregisteredId)).toBe(true);
  expect(plan.notices.some((item) => item.code === "pending.legacy.target_conflict" && item.subject === conflictId)).toBe(true);
});

test("workspace upgrade moves proven pending state, is dry-run safe, and is idempotent", () => {
  const root = createWorkbench(HUB);
  const filehub = tmp("jspace-pending-fh-");
  const id = "44444444-4444-4444-8444-444444444444";
  const content = pendingContent();
  const source = writeLegacyPending(filehub, v1Pending(id, content));
  const deps = upgradeDeps(filehub);

  const before = readText(source);
  const preview = workspaceUpgrade(root, { dryRun: true, acceptConflicts: false }, deps);
  expect(preview.lines.join("\n")).toContain("[retire] .jspace-logs/");
  expect(existsSync(join(root, ".jspace", "state", "pending", `${id}${ENVELOPE_EXT}`))).toBe(false);
  expect(readText(source)).toBe(before);

  const applied = workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, deps);
  expect(applied.lines.join("\n")).toContain("retired 1 legacy pending envelope");
  const target = join(root, ".jspace", "state", "pending", `${id}${ENVELOPE_EXT}`);
  const migrated = decodePendingEnvelope(JSON.parse(readText(target)));
  expect(migrated.ok).toBe(true);
  if (migrated.ok) {
    expect(migrated.value.schema_version).toBe(2);
    expect(migrated.value.contentOrigin).toBe("inferred");
    expect(migrated.value.contentHash).toBe(sha256Text(content));
    expect(migrated.value.content).toBe(content);
  }
  expect(existsSync(source)).toBe(false);
  expect(readdirSync(join(root, ".jspace", "state", "upgrades")).length).toBe(1);

  const again = workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, deps);
  expect(again.lines.join("\n")).toContain("up to date");
  expect(readdirSync(join(root, ".jspace", "state", "upgrades")).length).toBe(1);
});

test("workspace upgrade refuses to retire a legacy pending source that changed before the write", () => {
  const root = createWorkbench(HUB);
  const filehub = tmp("jspace-pending-fh-");
  const id = "55555555-5555-4555-8555-555555555555";
  const original = JSON.stringify(v1Pending(id, pendingContent()), null, 2) + "\n";
  const source = writeLegacyPending(filehub, v1Pending(id, pendingContent()));
  let sourceReads = 0;
  const changed = original.replace('"retryCount": 0', '"retryCount": 1');
  const deps = upgradeDeps(filehub, emptyManifest(), (path) => {
    if (path === source) {
      sourceReads++;
      return sourceReads === 1 ? original : changed;
    }
    return null;
  });

  expect(() => workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, deps)).toThrow(
    /legacy pending source changed/,
  );
  expect(existsSync(source)).toBe(true);
  expect(existsSync(join(root, ".jspace", "state", "pending", `${id}${ENVELOPE_EXT}`))).toBe(true);
});

test("ingest planner preserves historical hashes but never promotes an unverified checkpoint", () => {
  const root = createWorkbench(HUB);
  const filehub = tmp("jspace-ingest-fh-");
  const content = "verified copy\n";
  const target = join(filehub, "projects", "acme", "doc.md");
  writeText(target, content);
  const raw = v1Ingest(target, content);
  writeLegacyIngest(root, raw);

  const plan = planLegacyIngestMigrations(root, {
    hub: HUB,
    filehubRoot: filehub,
    readFile: (path) => {
      try {
        return readText(path);
      } catch {
        return null;
      }
    },
  });
  expect(plan.ops).toHaveLength(1);
  const decoded = decodeIngestJournal(JSON.parse(plan.ops[0]!.content));
  expect(decoded.ok).toBe(true);
  if (decoded.ok) {
    expect(decoded.value.status).toBe("failed");
    expect(decoded.value.failedStep).toBe("staged");
    expect(decoded.value.sourceHash).toBe(sha256Text(content));
    expect(decoded.value.targetHash).toBe(sha256Text(content));
    expect(decoded.value.gbrainEvidence).toBeUndefined();
    expect(decoded.value.indexEvidence).toBeUndefined();
  }
});

test("ingest planner leaves unknown owners, changed targets, and symlink escapes in place", () => {
  const root = createWorkbench(HUB);
  const filehub = tmp("jspace-ingest-fh-");
  const target = join(filehub, "projects", "acme", "doc.md");
  writeText(target, "verified copy\n");

  const unknown = v1Ingest(target, "verified copy\n", {
    id: "66666666-6666-4666-8666-666666666666",
    projectId: "other",
  });
  const changed = v1Ingest(target, "expected copy\n", {
    id: "77777777-7777-4777-8777-777777777777",
  });
  const escapedTarget = join(filehub, "projects", "acme", "escape.md");
  const outside = join(tmp("jspace-ingest-outside-"), "outside.md");
  writeText(outside, "outside\n");
  symlinkSync(outside, escapedTarget);
  const escaped = v1Ingest(escapedTarget, "outside\n", {
    id: "88888888-8888-4888-8888-888888888888",
    relPath: "projects/acme/escape.md",
  });
  for (const value of [unknown, changed, escaped]) writeLegacyIngest(root, value);

  const plan = planLegacyIngestMigrations(root, {
    hub: HUB,
    filehubRoot: filehub,
    readFile: (path) => {
      try {
        return readText(path);
      } catch {
        return null;
      }
    },
  });
  expect(plan.ops).toHaveLength(0);
  expect(plan.notices.map((item) => item.code)).toEqual(
    expect.arrayContaining(["ingest.legacy.owner", "ingest.legacy.target"]),
  );
});

test("legacy failed/committed never becomes a cleanup-pending shortcut", () => {
  const root = createWorkbench(HUB);
  const filehub = tmp("jspace-ingest-fh-");
  const target = join(filehub, "projects", "acme", "doc.md");
  writeText(target, "x\n");
  writeLegacyIngest(root, v1Ingest(target, "x\n", {
    id: "99999999-9999-4999-8999-999999999999",
    status: "failed",
    failedStep: "committed",
    failureReason: "source cleanup pending",
  }));
  const plan = planLegacyIngestMigrations(root, {
    hub: HUB,
    filehubRoot: filehub,
    readFile: (path) => {
      try {
        return readText(path);
      } catch {
        return null;
      }
    },
  });
  expect(plan.ops).toHaveLength(1);
  const decoded = decodeIngestJournal(JSON.parse(plan.ops[0]!.content));
  expect(decoded.ok).toBe(true);
  if (decoded.ok) {
    expect(decoded.value.status).toBe("failed");
    expect(decoded.value.failedStep).toBe("staged");
    expect(decoded.value.failureReason).toContain("without verifiable current evidence");
  }
});

test("materialized v1 migration preserves the recorded hash and rollback stays v2", () => {
  const root = createWorkbench(HUB);
  const content = "# same\n";
  const rel = "AGENTS.md";
  writeText(join(root, rel), content);
  writeText(join(root, MATERIALIZED_FILE), JSON.stringify({
    schema_version: 1,
    asset_version: "1.0.0",
    applied_at: "2026-01-01",
    files: { [rel]: { sha256: sha256Of(content) } },
  }, null, 2) + "\n");
  const manifest: DistributionManifestV1 = {
    schema_version: 1,
    bundle_version: "1.1.0",
    files: [{ path: "templates/workbench/AGENTS.md", sha256: sha256Of(content), ownership: "seed" }],
  };
  const deps = upgradeDeps(null, manifest);

  const dry = workspaceUpgrade(root, { dryRun: true, acceptConflicts: false }, deps);
  expect(dry.lines.join("\n")).toContain("materialized journal v1 -> v2");
  expect(JSON.parse(readText(join(root, MATERIALIZED_FILE))).schema_version).toBe(1);

  workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, deps);
  const migrated = readMaterializedJournal(root);
  expect(migrated?.schema_version).toBe(2);
  expect(migrated?.files[rel]?.sha256).toBe(sha256Of(content));
  const upgradeId = readdirSync(join(root, ".jspace", "state", "upgrades"))[0]!;
  workspaceUpgrade(root, {
    dryRun: false,
    acceptConflicts: false,
    rollbackId: upgradeId,
  }, deps);
  expect(readMaterializedJournal(root)?.schema_version).toBe(2);
  expect(JSON.parse(readText(join(root, MATERIALIZED_FILE))).schema_version).toBe(2);
});

test("legacy upgrade journal delete migrates to remove as forward-only with a backup", () => {
  const root = createWorkbench(HUB);
  const oldId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const oldRel = join(".jspace", "state", "upgrades", oldId, "journal.json");
  const oldRaw = JSON.stringify({
    schema_version: 1,
    id: oldId,
    from_version: "0.9.0",
    to_version: "1.0.0",
    plan: [{ action: "delete", rel: "AGENTS.md" }],
    status: "applied",
  }, null, 2) + "\n";
  writeText(join(root, oldRel), oldRaw);
  const deps = upgradeDeps(null);

  const preview = workspaceUpgrade(root, { dryRun: true, acceptConflicts: false }, deps);
  expect(preview.lines.join("\n")).toContain("delete -> remove");
  expect(readText(join(root, oldRel))).toBe(oldRaw);

  const applied = workspaceUpgrade(root, { dryRun: false, acceptConflicts: false }, deps);
  const newId = applied.lines.find((line) => line.startsWith("Upgrade journal:"))!.split(": ")[1]!.split(" ")[0]!;
  expect(readText(join(root, oldRel))).toContain('"action": "remove"');
  const newJournal = JSON.parse(readText(join(root, ".jspace", "state", "upgrades", newId, "journal.json"))) as {
    plan: Array<{ action: string; rel: string }>;
  };
  expect(newJournal.plan).toContainEqual({ action: "migrate-forward", rel: oldRel.replace(/\\/g, "/") });
  expect(readText(join(root, ".jspace", "state", "upgrades", newId, "before", oldRel))).toBe(oldRaw);

  workspaceUpgrade(root, {
    dryRun: false,
    acceptConflicts: false,
    rollbackId: newId,
  }, deps);
  expect(readText(join(root, oldRel))).toContain('"action": "remove"');
});
