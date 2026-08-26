# Implement — 运行时 skill 路径单一来源

任务上下文优先级:本文件 → `design.md` → `prd.md`。父 design D5 已定方案;本文件到文件粒度的步骤与门禁。

## 1 单一来源函数(manifest.ts)

1. `application/workspace/manifest.ts` 新增:
   ```ts
   export function skillRel(name: string): string;   // `.jspace/skills/${name}`
   export function skillRoot(root: string, name: string): string; // join(root, skillRel(name))
   ```
2. `materializedRel` 的 `skills/` 分支改为复用:`return skillRel(key.slice("skills/".length))`。`join` 已在 import 中。

**门1**:`bun test application/workspace/manifest.test.ts` 绿(现有 `materializedRel` 断言保持)。

## 2 引用修正

3. `application/automation/definitions.ts`:
   - `skillRoot` 改为 `skillRoot(wbRoot, target.skill)`(import 自 manifest.ts)。
   - fix 文案 `skills/${target.skill}/SKILL.md` → `skillRel(target.skill)/SKILL.md`。
   - diff 前缀 `skills/${target.skill}/` → `skillRel(target.skill) + "/"`。
   - prompt `join(skillRoot, "SKILL.md")` 保留(经 skillRoot)。
4. `application/automation/execute.ts`:守卫 `join(root, "skills", "asset-ingest")` → `skillRoot(root, "asset-ingest")`;报错文案指向 `.jspace/skills/`。
5. `application/registry/filehub.ts`:notes `skills/asset-ingest` → `skillRel("asset-ingest")`(或字面量 `.jspace/skills/asset-ingest`)。

## 3 测试同步

6. `application/automation/definitions.test.ts`:
   - fixture `readFile` 匹配 `.jspace/skills/asset-ingest/SKILL.md`;`recorded` key 同步。
   - prompt 断言 `/wb/.jspace/skills/asset-ingest/SKILL.md`。
   - fix 断言核对新文案。
7. `application/automation/execute.test.ts`:守卫 fixture `mkdir .jspace/skills/asset-ingest`;补「不存在 → 拒绝」断言(如有)。
8. `application/workspace/manifest.test.ts`:新增 `skillRel`/`skillRoot` 断言(AC1)。

## 4 门禁

9. `bunx tsc --noEmit`、`bun test` 全绿。
10. 全仓库 grep 运行时 `skills/<name>`(非 `.jspace` 前缀、非 test、非 generated)无残留:
    ```bash
    grep -rn 'skills/[a-z-]*/' cli/ application/ --include="*.ts" | grep -v test | grep -v generated | grep -v '\.jspace/skills'
    ```
11. 端到端:`bun run cli/main.ts init /tmp/jspace-smoke` → `cron install --dry-run`(或直接看 compileSkillTarget 返回)通过。
