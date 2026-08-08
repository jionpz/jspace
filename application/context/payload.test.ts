// application/context/payload.test.ts — injection payload rendering.
// Run: bun test application/context/payload.test.ts
import { expect, test } from "bun:test";
import type { WorkbenchState } from "./collect.ts";
import { renderSessionStart, renderTurn } from "./payload.ts";

const empty: WorkbenchState = {
  domains: [],
  domainsDetail: [],
  pendingCount: 0,
  pendingProducers: [],
  cronIncidents: [],
  inboxCount: 0,
  hubBroken: false,
};

function doms(n: number, prefix = "d"): WorkbenchState {
  const ids = Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
  return {
    ...empty,
    domains: ids,
    domainsDetail: ids.map((id) => ({ id, path: `workspace/${id}` })),
  };
}

test("empty workbench -> pointer block + neutral next-action, no state lines", () => {
  const r = renderSessionStart(empty, "/wb");
  expect(r).toContain("<jspace-workbench>");
  expect(r).toContain("JSpace 工作台 /wb");
  expect(r).toContain("<current-state>");
  expect(r).not.toContain("域:");
  expect(r).not.toContain("pending:");
  expect(r).not.toContain("待办:");
  expect(r).toContain("<next-action>");
  expect(r).toContain("当前无待办");
});

test("3 domains + 2 pending + 1 incident + inbox -> all populated, next-action hits pending", () => {
  const state: WorkbenchState = {
    ...empty,
    domains: ["acme", "research", "ops"],
    domainsDetail: [
      { id: "acme", path: "workspace/acme" },
      { id: "research", path: "workspace/research" },
      { id: "ops", path: "workspace/ops" },
    ],
    pendingCount: 2,
    pendingProducers: ["asset-ingest", "memory-writeback"],
    cronIncidents: [{ cronId: "inbox-tidy", failureClass: "failed" }],
    inboxCount: 4,
  };
  const r = renderSessionStart(state, "/wb");
  expect(r).toContain("域: 3 个 — acme / research / ops");
  expect(r).toContain("pending: 2 笔 gbrain 暂存写待落盘（asset-ingest, memory-writeback）");
  expect(r).toContain("cron: inbox-tidy[failed] 上次失败，未确认");
  expect(r).toContain("待办: filehub/_inbox 有 4 份未归档资料");
  expect(r).toContain("- workspace/acme/README.md");
  expect(r).toContain("技能: jspace-use");
  // next-action: pending first, then incident, then inbox
  expect(r).toContain("先跑 jspace pending apply 落盘 2 笔暂存写");
  expect(r).toContain("处理 cron 失败: inbox-tidy[failed]");
  expect(r).toContain("inbox 有 4 份待整理");
});

test("broken hub -> alert line in current-state and top-priority next-action", () => {
  const r = renderSessionStart({ ...empty, hubBroken: true }, "/wb");
  expect(r).toContain("告警: hub.json 缺失或损坏");
  expect(r).toContain("先跑 jspace doctor --dir . 修复注册表");
  const t = renderTurn({ ...empty, hubBroken: true });
  expect(t).toContain("hub.json 缺失或损坏");
});

test("many domains -> current-state caps at 5, available caps at 12 with tails", () => {
  const state = doms(20);
  const r = renderSessionStart(state, "/wb");
  expect(r).toMatch(/域: 20 个 — d1 \/ d2 \/ d3 \/ d4 \/ d5（另有 15 个）/);
  expect(r).toContain("（另有 8 个域，见 .jspace/hub.json）"); // 20 - 12
  // available lists exactly 12 paths + the tail + the skills line
  const avail = r.slice(r.indexOf("<available>"), r.indexOf("</available>"));
  expect((avail.match(/- workspace\//g) ?? []).length).toBe(12);
});

test("payload does not embed AGENTS.md content (dedup, AC-B8)", () => {
  const r = renderSessionStart(doms(3), "/wb");
  expect(r).not.toContain("JSPACE:START");
  expect(r).not.toContain("Daily Work Intake");
  expect(r).not.toContain("Domain Governance");
});

test("oversized workbench -> session-start stays under 4KiB and keeps core blocks", () => {
  // 40 domains with very long paths to blow well past 4KiB
  const state = doms(40, "very-long-domain-name-that-will-blow-the-budget");
  const r = renderSessionStart(state, "/wb");
  expect(Buffer.byteLength(r, "utf-8")).toBeLessThanOrEqual(4 * 1024);
  expect(r).toContain("<jspace-workbench>");
  expect(r).toContain("<next-action>");
  expect(r).toContain("按 AGENTS.md 路由");
});

test("turn: clean workbench -> empty (no noise); each state -> single-line top priority", () => {
  expect(renderTurn(empty)).toBe("");
  expect(renderTurn(doms(2))).toBe(""); // domains alone are not actionable

  const pending = { ...empty, pendingCount: 2, pendingProducers: ["asset-ingest"] };
  const inc = { ...empty, cronIncidents: [{ cronId: "x", failureClass: "failed" }] };
  const inbox = { ...empty, inboxCount: 3 };
  const broken = { ...empty, hubBroken: true };

  expect(renderTurn({ ...pending, cronIncidents: inc.cronIncidents })).toBe("<jspace-state>pending: 2 笔暂存写待落盘（jspace pending apply）</jspace-state>");
  expect(renderTurn(inc)).toBe("<jspace-state>cron: x[failed] 失败未确认（jspace cron check）</jspace-state>");
  expect(renderTurn(inbox)).toBe("<jspace-state>inbox: 3 份待整理（「整理一下 inbox」）</jspace-state>");
  expect(renderTurn(broken)).toContain("hub.json 缺失或损坏");
  // turn single-line, well under 512B
  for (const s of [pending, inc, inbox, broken]) {
    expect(Buffer.byteLength(renderTurn(s), "utf-8")).toBeLessThan(512);
  }
});
