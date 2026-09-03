// application/context/payload.test.ts — injection payload rendering.
// Run: bun test application/context/payload.test.ts
import { expect, test } from "bun:test";
import type { WorkbenchState } from "./collect.ts";
import { renderSessionStart, renderTurn, renderPreCompact, renderSessionEnd } from "./payload.ts";
import skillsManifest from "../../skills-manifest.json";

const empty: WorkbenchState = {
  domains: [],
  domainsDetail: [],
  pendingCount: 0,
  pendingProducers: [],
  pendingDamaged: 0,
  ingestDamaged: 0,
  cronIncidents: [],
  inboxCount: 0,
  hubBroken: false,
  projects: [],
  profiles: [],
  recentKnowledge: [],
};

function doms(n: number, prefix = "d"): WorkbenchState {
  const ids = Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
  return {
    ...empty,
    domains: ids,
    domainsDetail: ids.map((id) => ({ id, path: `workspace/${id}`, summary: "" })),
  };
}

test("empty workbench -> pointer block + neutral next-action, NO empty current-state (noise)", () => {
  const r = renderSessionStart(empty, "/wb");
  expect(r).toContain("<jspace-workbench>");
  expect(r).toContain("JSpace 工作台 /wb");
  expect(r).not.toContain("<current-state>"); // no empty block on a clean workbench
  expect(r).not.toContain("域:");
  expect(r).not.toContain("pending:");
  expect(r).not.toContain("待办:");
  expect(r).not.toContain("<available>"); // no empty read list either
  expect(r).toContain("<next-action>");
  expect(r).toContain("当前无待办");
});

test("3 domains + 2 pending + 1 incident + inbox -> all populated, next-action hits pending", () => {
  const state: WorkbenchState = {
    ...empty,
    domains: ["acme", "research", "ops"],
    domainsDetail: [
      { id: "acme", path: "workspace/acme", summary: "客户交付" },
      { id: "research", path: "workspace/research", summary: "" },
      { id: "ops", path: "workspace/ops", summary: "" },
    ],
    pendingCount: 2,
    pendingProducers: ["asset-ingest", "memory-writeback"],
    cronIncidents: [{ cronId: "inbox-tidy", failureClass: "failed" }],
    inboxCount: 4,
  };
  const r = renderSessionStart(state, "/wb");
  expect(r).toContain("域: 3 个 — acme（客户交付） / research / ops"); // B2.1: 名 + 一行摘要
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

test("session-start skills line lists every manifest workbench skill (no hardcoded drift)", () => {
  // <available> renders only with at least one domain path to list
  const r = renderSessionStart(doms(1), "/wb");
  const avail = r.slice(r.indexOf("<available>"), r.indexOf("</available>"));
  for (const s of skillsManifest.workbench) {
    expect(avail).toContain(s.name);
  }
});

test("broken hub -> alert line in current-state and top-priority next-action", () => {
  const r = renderSessionStart({ ...empty, hubBroken: true }, "/wb");
  expect(r).toContain("告警: hub.json 缺失或损坏");
  expect(r).toContain("先跑 jspace doctor --dir . 修复注册表");
  const t = renderTurn({ ...empty, hubBroken: true });
  expect(t).toContain("hub.json 缺失或损坏");
});

test("pre-compact emits a passive reminder + state, recommends explicit actions only (never auto-writes)", () => {
  const state: WorkbenchState = { ...empty, pendingCount: 1, pendingProducers: ["asset-ingest"] };
  const r = renderPreCompact(state, "/wb");
  expect(r).toContain("会话即将 compaction");
  expect(r).toContain("本提醒不自动写 gbrain"); // passive: no auto write
  expect(r).toContain("pending: 1 笔 gbrain 暂存写待落盘（asset-ingest）"); // state surfaced
  // the reminder nudges an EXPLICIT action (user-initiated apply), never auto-writes
  expect(r).toContain("jspace pending apply"); // explicit command is the recommendation
  expect(r).toContain("<next-action>");
  // the write-back action rides along with the pending one, not instead of it
  expect(r).toContain("说一句「收工」触发 memory-writeback");
  expect(r).toContain("source:session");
});

test("session-end emits a settlement reminder + state, never auto-writes", () => {
  const state: WorkbenchState = { ...empty, cronIncidents: [{ cronId: "inbox-tidy", failureClass: "failed" }] };
  const r = renderSessionEnd(state, "/wb");
  expect(r).toContain("会话结束");
  expect(r).toContain("本提醒不自动写 gbrain");
  expect(r).toContain("cron: inbox-tidy[failed] 上次失败，未确认");
  expect(r).toContain("处理 cron 失败"); // explicit action recommended
  // clean workbench still emits the discipline nudge (the reminder is the point)
  const clean = renderSessionEnd(empty, "/wb");
  expect(clean).toContain("会话结束");
  expect(clean).toContain("本提醒不自动写 gbrain");
});

test("closing events: next-action is the executable write-back line, never routing advice (B)", () => {
  for (const render of [renderPreCompact, renderSessionEnd]) {
    const clean = render(empty, "/wb");
    const action = clean.slice(clean.indexOf("<next-action>"), clean.indexOf("</next-action>"));
    // names the trigger phrase, the skill, and the provenance tag retro counts
    expect(action).toContain("「收工」");
    expect(action).toContain("memory-writeback");
    expect(action).toContain("tags: source:session");
    expect(action).toContain("无则静默结束"); // no facts -> silence, not a forced write
    // a session that is closing is never told to go route into a domain
    expect(action).not.toContain("按 AGENTS.md 路由");
    expect(action).not.toContain("当前无待办");

    // higher-priority state keeps its place; the write-back line comes last
    const busy = render({ ...empty, pendingCount: 2, pendingProducers: ["asset-ingest"] }, "/wb");
    const busyAction = busy.slice(busy.indexOf("<next-action>"), busy.indexOf("</next-action>"));
    expect(busyAction.indexOf("jspace pending apply")).toBeLessThan(busyAction.indexOf("memory-writeback"));
  }
  // session-start is unaffected: an idle workbench still gets routing advice
  const start = renderSessionStart(empty, "/wb");
  expect(start).toContain("当前无待办");
  expect(start).not.toContain("memory-writeback");
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

test("projects populated -> project line in current-state; none -> no line", () => {
  const withProjects: WorkbenchState = {
    ...empty,
    projects: [
      { id: "jspace", summary: "记忆模型重构设计期", updatedAt: "2026-08-10" },
      { id: "wms", summary: "", updatedAt: "2026-08-05" },
    ],
  };
  const r = renderSessionStart(withProjects, "/wb");
  expect(r).toContain("项目: 2 个活跃 — jspace（记忆模型重构设计期） / wms");
  // empty projects -> project line omitted entirely (no noise)
  expect(renderSessionStart(empty, "/wb")).not.toContain("项目:");
  // pre-compact surfaces the project line too (state that could be lost)
  expect(renderPreCompact(withProjects, "/wb")).toContain("项目: 2 个活跃");
  // turn stays single-line and never emits a project line (not actionable)
  expect(renderTurn(withProjects)).toBe("");
});

test("profiles populated -> 偏好 line after 项目; empty -> omitted; turn never emits 偏好", () => {
  const withProfiles: WorkbenchState = {
    ...empty,
    projects: [{ id: "jspace", summary: "记忆模型重构设计期", updatedAt: "2026-08-10" }],
    profiles: [
      { theme: "沟通偏好", summary: "一句话", updatedAt: "2026-08-10" },
      { theme: "报告格式", summary: "", updatedAt: "2026-08-09" },
    ],
  };
  const r = renderSessionStart(withProfiles, "/wb");
  expect(r).toContain("项目: 1 个活跃 — jspace（记忆模型重构设计期）");
  expect(r).toContain("偏好: 沟通偏好（一句话） / 报告格式");
  expect(r.indexOf("项目:")).toBeLessThan(r.indexOf("偏好:"));
  expect(renderSessionStart(empty, "/wb")).not.toContain("偏好:");
  expect(renderPreCompact(withProfiles, "/wb")).toContain("偏好: 沟通偏好（一句话） / 报告格式");
  expect(renderTurn(withProfiles)).toBe("");
  expect(renderTurn(withProfiles)).not.toContain("偏好:");
});

test("recentKnowledge populated -> 近期沉淀 line after 偏好; empty -> omitted", () => {
  const withKnowledge: WorkbenchState = {
    ...empty,
    recentKnowledge: [
      { slug: "project/acme/decisions/tech-stack", summary: "选 React 不选 Vue", updatedAt: "2026-08-10" },
      { slug: "knowledge/governance/naming", summary: "ascii slug 约定", updatedAt: "2026-08-09" },
    ],
  };
  const r = renderSessionStart(withKnowledge, "/wb");
  expect(r).toContain("近期沉淀: project/acme/decisions/tech-stack（选 React 不选 Vue） / knowledge/governance/naming（ascii slug 约定）");
  expect(renderSessionStart(empty, "/wb")).not.toContain("近期沉淀:");
  expect(renderPreCompact(withKnowledge, "/wb")).toContain("近期沉淀:");
  expect(renderTurn(withKnowledge)).toBe("");
});

test("payload does not embed AGENTS.md content (dedup, AC-B8)", () => {
  const r = renderSessionStart(doms(3), "/wb");
  expect(r).not.toContain("JSPACE:START");
  expect(r).not.toContain("Daily Work Intake");
  expect(r).not.toContain("Domain Governance");
});

test("oversized workbench -> session-start stays under 4KiB and keeps core blocks", () => {
  // 40 domains with very long paths to blow well past 4KiB; profiles are
  // already truncated at 80 chars so they must not push the payload over.
  const state: WorkbenchState = {
    ...doms(40, "very-long-domain-name-that-will-blow-the-budget"),
    profiles: Array.from({ length: 4 }, (_, i) => ({
      theme: `theme-${i}`,
      summary: "字".repeat(80),
      updatedAt: "2026-08-10",
    })),
  };
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

test("turn write-back nudge: lowest priority, single line, only when opted in (B4)", () => {
  // opt-out (default): clean workbench stays silent
  expect(renderTurn(empty)).toBe("");

  const nudged = renderTurn(empty, { writebackNudge: true });
  expect(nudged).toContain("「收工」"); // the exact trigger phrase, not a vague "记得写回"
  expect(nudged).toContain("memory-writeback");
  expect(nudged).toContain("tags: source:session"); // the tag retro counts write-back rate on
  expect(nudged).toContain("静默结束"); // no facts -> silence, never a forced write
  expect(nudged).toContain("不写 gbrain"); // nudge only, never an auto write
  expect(nudged.split("\n").length).toBe(1);
  expect(Buffer.byteLength(nudged, "utf-8")).toBeLessThan(512);

  // high-priority states (pending/incident/broken) still outrank the nudge
  const pending = { ...empty, pendingCount: 1, pendingProducers: ["asset-ingest"] };
  const inc = { ...empty, cronIncidents: [{ cronId: "x", failureClass: "failed" }] };
  const broken = { ...empty, hubBroken: true };
  for (const s of [pending, inc, broken]) {
    expect(renderTurn(s, { writebackNudge: true })).toBe(renderTurn(s));
    expect(renderTurn(s, { writebackNudge: true })).not.toContain("memory-writeback");
  }
  // inbox no longer starves the nudge: both coexist (flywheel-boost)
  const inbox = { ...empty, inboxCount: 3 };
  const inboxNudged = renderTurn(inbox, { writebackNudge: true });
  expect(inboxNudged).toContain("inbox: 3 份待整理");
  expect(inboxNudged).toContain("memory-writeback");
  expect(inboxNudged).toContain("source:session");
  expect(inboxNudged.split("\n").length).toBe(1);
  expect(Buffer.byteLength(inboxNudged, "utf-8")).toBeLessThan(512);
  // inbox without nudge opt-in is still inbox-only
  expect(renderTurn(inbox)).toBe("<jspace-state>inbox: 3 份待整理（「整理一下 inbox」）</jspace-state>");
  expect(renderTurn(inbox)).not.toContain("memory-writeback");
  // domains alone are not actionable, so the nudge does surface there
  expect(renderTurn(doms(2), { writebackNudge: true })).toContain("memory-writeback");
});

test("many cron incidents -> current-state caps at MAX_CRON_LINES with tail", () => {
  const state = {
    ...empty,
    cronIncidents: Array.from({ length: 40 }, (_, i) => ({ cronId: `cron-${i}`, failureClass: "failed" })),
  };
  const r = renderSessionStart(state, "/wb");
  const stateBlock = r.slice(r.indexOf("<current-state>"), r.indexOf("</current-state>"));
  expect((stateBlock.match(/cron: cron-\d+\[failed\] 上次失败，未确认/g) ?? []).length).toBe(5);
  expect(stateBlock).toContain("另有 35 个 cron 失败");
});

test("open incidents -> banner at the very top of session-start/precompact/session-end (issue #13)", () => {
  const state = { ...empty, cronIncidents: [{ cronId: "inbox-tidy", failureClass: "failed" }] };
  const ss = renderSessionStart(state, "/wb");
  expect(ss.startsWith("⚠️ open incidents: 1（jspace cron check）")).toBe(true);
  const pc = renderPreCompact(state, "/wb");
  expect(pc.startsWith("⚠️ open incidents: 1（jspace cron check）")).toBe(true);
  const se = renderSessionEnd(state, "/wb");
  expect(se.startsWith("⚠️ open incidents: 1（jspace cron check）")).toBe(true);
  // no incidents -> no banner
  expect(renderSessionStart(empty, "/wb")).not.toContain("⚠️ open incidents");
});

test("long cronId -> truncated in both session-start and turn (stays under budget)", () => {
  const longId = "x".repeat(500);
  const state = { ...empty, cronIncidents: [{ cronId: longId, failureClass: "failed" }] };
  const r = renderSessionStart(state, "/wb");
  expect(r).toContain(`cron: ${"x".repeat(48)}…[failed]`); // truncated to MAX_CRON_ID_CHARS
  expect(r).not.toContain("x".repeat(60)); // the full 500 never appears
  const t = renderTurn(state);
  expect(Buffer.byteLength(t, "utf-8")).toBeLessThan(512);
});
