// core/contracts/run-record.test.ts — optional reason/durationSec are additive;
// legacy records (without them) must keep decoding.
// Run: bun test core/contracts/run-record.test.ts
import { expect, test } from "bun:test";
import { decodeRunRecord } from "./run-record.ts";

const ID = "a1b2c3d4-0000-4000-8000-000000000102";

function legacy(): Record<string, unknown> {
  return {
    schema_version: 1,
    id: ID,
    cronId: "server-status",
    startedAt: "2026-10-27T090000",
    exit: 143,
    status: "failed",
    timedOut: true,
    outputLog: "/tmp/log.md",
    batchChanged: true,
  };
}

test("legacy run record without reason/durationSec decodes unchanged", () => {
  const r = decodeRunRecord(legacy());
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.reason).toBeUndefined();
    expect(r.value.durationSec).toBeUndefined();
  }
});

test("reason and durationSec decode when present", () => {
  const r = decodeRunRecord({ ...legacy(), reason: "timeout", durationSec: 3141 });
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.value.reason).toBe("timeout");
    expect(r.value.durationSec).toBe(3141);
  }
});

test("unknown reason is rejected", () => {
  const r = decodeRunRecord({ ...legacy(), reason: "mystery" });
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.issues.map((i) => i.code)).toContain("run.reason.invalid");
});

test("negative / non-finite durationSec is rejected", () => {
  for (const durationSec of [-1, Number.NaN, Number.POSITIVE_INFINITY, "12"]) {
    const r = decodeRunRecord({ ...legacy(), durationSec });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.map((i) => i.code)).toContain("run.durationSec.invalid");
  }
});
