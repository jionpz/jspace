// application/pending/use-cases.test.ts — `jspace pending` use cases against a
// temp workbench with a registered filehub (stub gbrain). No real gbrain store.
// Run: bun test application/pending/use-cases.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GbrainDeps } from "./apply.ts";
import { readEnvelopes, writeEnvelope } from "./envelope.ts";
import { pendingAck, pendingApply, pendingList, pendingStage } from "./use-cases.ts";

let wb: string;
let fh: string;
beforeEach(() => {
  wb = mkdtempSync(join(tmpdir(), "jspace-pending-uc-"));
  fh = join(wb, "filehub");
  mkdirSync(join(wb, ".jspace"), { recursive: true });
  writeFileSync(
    join(wb, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [{ id: "filehub", type: "filehub", domain: "files", entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }] }],
      projects: [],
    }),
  );
  writeFileSync(join(wb, ".jspace", "local.json"), JSON.stringify({ schema_version: 1, installation_id: "inst", bindings: { "filehub-path": fh } }));
});
afterEach(() => rmSync(wb, { recursive: true, force: true }));

function contentFile(body = "page content"): string {
  const p = join(wb, "content.md");
  writeFileSync(p, body, "utf-8");
  return p;
}

function id(): string {
  return readEnvelopes(fh).records[0].id;
}

test("stage writes an envelope; list reports it", () => {
  pendingStage(wb, "assets/foo/doc", contentFile(), "asset-ingest");
  expect(readEnvelopes(fh).records).toHaveLength(1);
  const res = pendingList(wb, true);
  expect((res.data as { envelopes: unknown[] }).envelopes).toHaveLength(1);
});

test("apply with a stub gbrain puts once and marks applied", () => {
  pendingStage(wb, "assets/foo/doc", contentFile(), "asset-ingest");
  const envId = id();
  const stub: GbrainDeps = { get: () => ({ ok: false }), put: () => ({ ok: true }) };
  const res = pendingApply(wb, undefined, stub);
  expect(res.lines[0]).toContain("applied 1");
  expect(readEnvelopes(fh).records[0].status).toBe("applied");
  void envId;
});

test("ack only accepts terminal_failed and stops alerting", () => {
  pendingStage(wb, "assets/foo/doc", contentFile(), "asset-ingest");
  const envId = id();
  expect(() => pendingAck(wb, envId)).toThrow(/only terminal_failed can be acked/);
  // force terminal then ack
  const env = readEnvelopes(fh).records[0];
  writeEnvelope(fh, { ...env, status: "terminal_failed", error: "x" });
  const ack = pendingAck(wb, envId);
  expect(ack.lines[0]).toContain("acknowledged");
  expect(readEnvelopes(fh).records[0].status).toBe("acked");
});

test("stage requires an existing content file", () => {
  expect(() => pendingStage(wb, "assets/foo/doc", join(wb, "nope.md"), "asset-ingest")).toThrow(/content file not found/);
});

test("no filehub -> stage fails cleanly", () => {
  const empty = mkdtempSync(join(tmpdir(), "jspace-pending-nofh-"));
  writeFileSync(join(empty, "content.md"), "x", "utf-8");
  expect(() => pendingStage(empty, "assets/foo/doc", join(empty, "content.md"), "asset-ingest")).toThrow(/no filehub registered/);
  expect(existsSync(empty)).toBe(true);
  rmSync(empty, { recursive: true, force: true });
});
