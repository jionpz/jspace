// cli/lifecycle-and-safety.test.ts — harness lifecycle matrix honesty (AC-D3/D7)
// and bootstrap pipe-install / gbrain safety checks (AC-D5). These guard the
// materialized skill docs that describe harness capabilities and remote
// installs; they live apart from reachability (Child D M7/M8).
// Run: bun test cli/lifecycle-and-safety.test.ts
import { expect, test } from "bun:test";
import { ASSETS } from "./assets.generated.ts";

/** Bundled .md files that land in the workbench (filehub is on-demand). */
function workbenchMds(): Array<[string, string]> {
  return Object.entries(ASSETS).filter(([key]) => {
    if (!key.endsWith(".md")) return false;
    if (key.startsWith("templates/filehub/")) return false;
    return key.startsWith("templates/workbench/") || key.startsWith("skills/");
  });
}

test("lifecycle matrix is the authoritative single source (AC-D3/D7)", () => {
  const matrix = ASSETS["skills/jspace-bootstrap/references/harnesses.md"];
  expect(matrix, "lifecycle matrix must be bundled").toBeDefined();
  expect(matrix).toContain("Lifecycle 能力矩阵");
  for (const grade of ["automated", "best_effort", "manual", "unsupported"]) {
    expect(matrix, `matrix must define grade: ${grade}`).toContain(grade);
  }
});

test("no unqualified harness 'automatically' claims in the materialized tree (AC-D3)", () => {
  for (const [key, body] of workbenchMds()) {
    for (const line of body.split("\n")) {
      if (!/\bautomatically\b/i.test(line)) continue;
      const qualified = /best-effort|best_effort|manual|按需|显式|usually|需真实触发/i.test(line);
      expect(qualified, `${key}: unqualified 'automatically': ${line}`).toBe(true);
    }
  }
});

test("bootstrap pipe installs are guarded, never default-executed (AC-D5)", () => {
  const skill = ASSETS["skills/jspace-bootstrap/SKILL.md"];
  const lines = skill.split("\n");
  let checked = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!/\|\s*bash|\|\s*iex/i.test(lines[i])) continue;
    checked++;
    const window = lines.slice(Math.max(0, i - 8), i + 8).join("\n");
    const guarded = /不默认执行|显式确认|下载到临时文件|核验/.test(window);
    expect(guarded, `bootstrap line ${i + 1} pipe install not guarded:\n${lines[i]}`).toBe(true);
  }
  expect(checked, "expected at least one pipe install line to guard").toBeGreaterThan(0);
});

test("gbrain version range + upgrade health check are declared (AC-D5)", () => {
  const gbrain = ASSETS["skills/jspace-bootstrap/references/gbrain.md"];
  expect(gbrain, "gbrain reference must be bundled").toBeDefined();
  expect(gbrain).toContain("版本兼容");
  expect(gbrain).toContain("gbrain doctor --json");
  expect(gbrain).toContain("升级前健康检查");
});
