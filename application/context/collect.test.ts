// application/context/collect.test.ts — workbench state collection.
// Run: bun test application/context/collect.test.ts
import { expect, test } from "bun:test";
import type { HubV4 } from "../../core/contracts/hub.ts";
import type { PendingWriteEnvelopeV1 } from "../../core/contracts/pending.ts";
import { collectWorkbenchState, type CollectDeps } from "./collect.ts";

function stubDeps(over: Partial<CollectDeps> = {}): CollectDeps {
  return {
    readHub: () => ({ schema_version: 1, domains: [], resources: [], projects: [] }),
    hubOk: () => true,
    resolveFilehubRoot: () => null,
    readEnvelopes: () => ({ records: [], issues: [] }),
    readIncidents: () => ({ records: [], issues: [] }),
    readInboxCount: () => 0,
    readIngestIssues: () => ({ issues: [] }),
    readDomainSummary: () => null,
    ...over,
  };
}

function env(over: Partial<PendingWriteEnvelopeV1>): PendingWriteEnvelopeV1 {
  return {
    version: 1,
    id: "e",
    idempotencyKey: "k",
    producer: "asset-ingest",
    slug: "s",
    content: "c",
    status: "staged",
    retryCount: 0,
    createdAt: "2026-08-06T00:00:00",
    ...over,
  };
}

const hubWith = (domains: { id: string; path: string }[]): HubV4 => ({
  schema_version: 1,
  domains,
  resources: [],
  projects: [],
});

test("empty workbench -> empty state, not broken", () => {
  const s = collectWorkbenchState("/wb", stubDeps());
  expect(s.domains).toEqual([]);
  expect(s.pendingCount).toBe(0);
  expect(s.inboxCount).toBe(0);
  expect(s.cronIncidents).toEqual([]);
  expect(s.hubBroken).toBe(false);
});

test("3 domains + 2 pending + 1 open incident + inbox -> all populated", () => {
  const s = collectWorkbenchState(
    "/wb",
    stubDeps({
      readHub: () =>
        hubWith([
          { id: "acme", path: "workspace/acme" },
          { id: "research", path: "workspace/research" },
          { id: "ops", path: "workspace/ops" },
        ]),
      readDomainSummary: (_r, p) => (p === "workspace/acme" ? "客户交付" : p === "workspace/research" ? "论文跟读" : null),
      resolveFilehubRoot: () => "/fh",
      readEnvelopes: () => ({
        records: [
          env({ id: "e1", status: "staged", producer: "asset-ingest" }),
          env({ id: "e2", status: "terminal_failed", producer: "memory-writeback", retryCount: 2 }),
          env({ id: "e3", status: "applied", producer: "asset-ingest" }), // not actionable
        ],
        issues: [],
      }),
      readIncidents: () => ({
        records: [
          { version: 1, id: "i1", cronId: "inbox-tidy", failureClass: "failed", status: "open", openedAt: "2026-08-05T12:00:00", evidence: [] },
          { version: 1, id: "i2", cronId: "weekly-report", failureClass: "failed", status: "acknowledged", openedAt: "2026-08-05T12:00:00", evidence: [] },
        ],
        issues: [],
      }),
      readInboxCount: () => 4,
    }),
  );
  expect(s.domains).toEqual(["acme", "research", "ops"]);
  expect(s.domainsDetail).toHaveLength(3);
  expect(s.domainsDetail[0]).toEqual({ id: "acme", path: "workspace/acme", summary: "客户交付" });
  expect(s.domainsDetail[2]).toEqual({ id: "ops", path: "workspace/ops", summary: "" });
  expect(s.pendingCount).toBe(2);
  expect(s.pendingProducers.sort()).toEqual(["asset-ingest", "memory-writeback"]);
  expect(s.cronIncidents).toEqual([{ cronId: "inbox-tidy", failureClass: "failed" }]);
  expect(s.inboxCount).toBe(4);
  expect(s.hubBroken).toBe(false);
});

test("broken hub -> hubBroken true, domains degrade to empty", () => {
  const s = collectWorkbenchState("/wb", stubDeps({ hubOk: () => false }));
  expect(s.hubBroken).toBe(true);
  expect(s.domains).toEqual([]);
});

test("filehub resolution throws -> pending/inbox stay default, no throw", () => {
  const s = collectWorkbenchState(
    "/wb",
    stubDeps({
      resolveFilehubRoot: () => {
        throw new Error("boom");
      },
    }),
  );
  expect(s.pendingCount).toBe(0);
  expect(s.inboxCount).toBe(0);
  expect(s.hubBroken).toBe(false);
});

test("incident read throws -> incidents degrade, no throw", () => {
  const s = collectWorkbenchState(
    "/wb",
    stubDeps({
      readIncidents: () => {
        throw new Error("boom");
      },
    }),
  );
  expect(s.cronIncidents).toEqual([]);
});

test("damaged pending envelopes surface as pendingDamaged (P2-6)", () => {
  const s = collectWorkbenchState("root", stubDeps({
    resolveFilehubRoot: () => "/fh",
    readEnvelopes: () => ({ records: [], issues: [{ code: "pending.json.parse", path: "corrupt.APPLY.json", message: "not valid JSON" }] }),
  }));
  expect(s.pendingDamaged).toBe(1);
  expect(s.pendingCount).toBe(0); // actionable count unaffected
});

test("damaged ingest journals surface as ingestDamaged (symmetric with pending)", () => {
  const s = collectWorkbenchState(
    "root",
    stubDeps({
      readIngestIssues: () => ({ issues: [{ code: "ingest.root.type", path: "corrupt.json", message: "ingest journal must be an object" }] }),
    }),
  );
  expect(s.ingestDamaged).toBe(1);
});

test("ingest read throws -> ingestDamaged stays 0, no throw", () => {
  const s = collectWorkbenchState(
    "root",
    stubDeps({
      readIngestIssues: () => {
        throw new Error("boom");
      },
    }),
  );
  expect(s.ingestDamaged).toBe(0);
});
