// application/context/briefing.test.ts — briefing machine state.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRIEFING_STALE_MS, isBriefingStale, readBriefing, touchBriefing, type BriefingStateV1 } from "./briefing.ts";

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "jspace-briefing-"));
  mkdirSync(join(root, ".jspace", "state"), { recursive: true });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

test("touchBriefing writes and increments session_count", () => {
  touchBriefing(root, new Date("2026-08-17T10:00:00Z"));
  let s = readBriefing(root);
  expect(s.issues).toEqual([]);
  expect(s.state?.last_session_start_at).toBe("2026-08-17T10:00:00.000Z");
  expect(s.state?.session_count).toBe(1);

  touchBriefing(root, new Date("2026-08-17T11:00:00Z"));
  s = readBriefing(root);
  expect(s.state?.session_count).toBe(2);
});

test("missing briefing -> state null; stale is true", () => {
  expect(readBriefing(root).state).toBeNull();
  expect(isBriefingStale(null)).toBe(true);
});

test("recent briefing is not stale; old briefing is stale", () => {
  const now = Date.parse("2026-08-17T12:00:00Z");
  const recent: BriefingStateV1 = { schema_version: 1, last_session_start_at: new Date(now - 1000).toISOString(), session_count: 1 };
  expect(isBriefingStale(recent, now)).toBe(false);
  const old: BriefingStateV1 = { schema_version: 1, last_session_start_at: new Date(now - BRIEFING_STALE_MS - 1000).toISOString(), session_count: 1 };
  expect(isBriefingStale(old, now)).toBe(true);
});

test("damaged briefing -> issues + state null", () => {
  writeFileSync(join(root, ".jspace", "state", "briefing.json"), "{ not json");
  const r = readBriefing(root);
  expect(r.state).toBeNull();
  expect(r.issues.length).toBeGreaterThan(0);
});
