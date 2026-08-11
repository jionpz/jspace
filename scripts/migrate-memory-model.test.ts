// scripts/migrate-memory-model.test.ts — memory-model migration plan logic.
// Run: bun test scripts/migrate-memory-model.test.ts
import { expect, test } from "bun:test";
import { buildPlan, rewriteBody, type MigrateGbrain } from "./migrate-memory-model.ts";

function fakeG(slugs: string[]): MigrateGbrain {
  return {
    list: async () => ({ ok: true, rows: slugs.map((slug) => ({ slug })) }),
    get: async () => ({ ok: true, content: `---\ntype: reference\nproject: 52期体验营\ntags: [x]\n---\nbody` }),
    put: async () => ({ ok: true }),
  };
}

const LEGACY_SLUGS = [
  "project/52期体验营/state",          // Chinese id -> ascii
  "project/报表模块/state",
  "project/机器学习/state",            // domain, unmapped -> left in place
  "project/gbrain/state",              // tech topic, unmapped -> left in place
  "knowledge/governance/记忆积累全局规则", // clean knowledge (unmapped owner) -> left
  "knowledge/jspace/单一事实源架构的红利与代价", // jspace lesson -> project/jspace/lessons/
  "knowledge/52期体验营/同修经验",       // known project owner -> lessons
  "memory/consolidate/2026-08-09",     // prefix
  "memory/consolidate/2026-08-03",
  "memory/retro/2026-08-10",
  "assets/周报/2026-08-03",            // area asset -> left
  "assets/52期体验营/同修回访登记-v1",   // project asset -> ascii
  "assets/机器学习/机器学习基础-第二章笔记", // area asset -> left
  "assets/报表模块/会议沟通记录",        // project asset -> ascii
  "assets/foo/doc",                    // test residue -> left (deletion is a separate decision)
];

test("buildPlan maps the 14 legacy pages per design §5.1", async () => {
  const plan = await buildPlan(fakeG(LEGACY_SLUGS));
  const byFrom = new Map(plan.map((r) => [r.from, r.to]));

  // project id normalization
  expect(byFrom.get("project/52期体验营/state")).toBe("project/tiyanying-52/state");
  expect(byFrom.get("project/报表模块/state")).toBe("project/baobiao-module/state");
  // domain/tech cards stay (unmapped — a legacy page is safer than a guess)
  expect(byFrom.get("project/机器学习/state")).toBeUndefined();
  expect(byFrom.get("project/gbrain/state")).toBeUndefined();
  // lessons promotion
  expect(byFrom.get("knowledge/jspace/单一事实源架构的红利与代价")).toBe("project/jspace/lessons/单一事实源架构的红利与代价");
  expect(byFrom.get("knowledge/52期体验营/同修经验")).toBe("project/tiyanying-52/lessons/同修经验");
  // clean knowledge / area assets stay
  expect(byFrom.get("knowledge/governance/记忆积累全局规则")).toBeUndefined();
  expect(byFrom.get("assets/周报/2026-08-03")).toBeUndefined();
  expect(byFrom.get("assets/机器学习/机器学习基础-第二章笔记")).toBeUndefined();
  expect(byFrom.get("assets/foo/doc")).toBeUndefined();
  // prefix rename
  expect(byFrom.get("memory/consolidate/2026-08-09")).toBe("records/consolidate/2026-08-09");
  expect(byFrom.get("memory/consolidate/2026-08-03")).toBe("records/consolidate/2026-08-03");
  expect(byFrom.get("memory/retro/2026-08-10")).toBe("records/retro/2026-08-10");
  // asset id normalization
  expect(byFrom.get("assets/52期体验营/同修回访登记-v1")).toBe("assets/tiyanying-52/同修回访登记-v1");
  expect(byFrom.get("assets/报表模块/会议沟通记录")).toBe("assets/baobiao-module/会议沟通记录");
});

test("buildPlan: empty brain -> no plan (clean)", async () => {
  const plan = await buildPlan(fakeG([]));
  expect(plan).toEqual([]);
});

test("rewriteBody: type -> note, project -> ascii, routing tag injected", () => {
  const out = rewriteBody(
    "---\ntype: reference\nproject: 52期体验营\ntags: [acme]\n---\nbody",
    "project/tiyanying-52/state",
  );
  expect(out).toContain("type: note");
  expect(out).toContain("project: tiyanying-52");
  expect(out).toContain("tags: [acme, project]");
});

test("rewriteBody: state-card routing tag = project; asset = asset; records = weekly", () => {
  expect(rewriteBody("---\ntype: note\ntags: [x]\n---", "assets/tiyanying-52/回访登记")).toContain("tags: [x, asset]");
  expect(rewriteBody("---\ntype: note\ntags: [x]\n---", "records/consolidate/2026-08-09")).toContain("tags: [x, weekly]");
  expect(rewriteBody("---\ntype: note\ntags: [x, project]\n---", "project/jspace/state")).not.toContain("project, project]");
});

test("rewriteBody: no frontmatter tags line survives untouched body", () => {
  const out = rewriteBody("plain body", "project/jspace/state");
  expect(out).toContain("plain body");
});
