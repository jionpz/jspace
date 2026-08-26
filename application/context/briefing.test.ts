// application/context/briefing.test.ts — briefing machine state.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BRIEFING_STALE_MS, claimWritebackNudge, isBriefingStale, readBriefing, touchBriefing, type BriefingStateV1 } from "./briefing.ts";

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

test("write-back nudge is claimable exactly once per session (B4)", () => {
  // no briefing yet (session-start hook never ran) -> never nudge: without a
  // session counter every turn would nudge.
  expect(claimWritebackNudge(root)).toBe(false);

  touchBriefing(root, new Date("2026-08-17T10:00:00Z"));
  expect(claimWritebackNudge(root)).toBe(true);
  expect(claimWritebackNudge(root)).toBe(false); // same session: spent
  expect(readBriefing(root).state?.writeback_nudge_for_session).toBe(1);

  // next session-start re-arms it (session_count moves past the marker)
  touchBriefing(root, new Date("2026-08-17T11:00:00Z"));
  const carried = readBriefing(root).state;
  expect(carried?.session_count).toBe(2);
  expect(carried?.writeback_nudge_for_session).toBe(1); // carried over, not reset
  expect(claimWritebackNudge(root)).toBe(true);
  expect(claimWritebackNudge(root)).toBe(false);
});

test("briefing written by an older CLI (no nudge marker) still reads + nudges once", () => {
  writeFileSync(
    join(root, ".jspace", "state", "briefing.json"),
    JSON.stringify({ schema_version: 1, last_session_start_at: "2026-08-17T10:00:00.000Z", session_count: 7 }),
  );
  const s = readBriefing(root);
  expect(s.issues).toEqual([]);
  expect(s.state?.writeback_nudge_for_session).toBeUndefined();
  expect(claimWritebackNudge(root)).toBe(true);
  expect(claimWritebackNudge(root)).toBe(false);
});

test("damaged briefing -> issues + state null", () => {
  writeFileSync(join(root, ".jspace", "state", "briefing.json"), "{ not json");
  const r = readBriefing(root);
  expect(r.state).toBeNull();
  expect(r.issues.length).toBeGreaterThan(0);
});
