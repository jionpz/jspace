# Implement — 官方 skill 移入 .jspace/skills/

任务上下文优先级:本文件 → `design.md` → `prd.md`。核心策略是「改 key→路径映射,不改 bundle key」。

## 1 核心映射(先做,门禁在 AC1)

1. `application/workspace/manifest.ts` `materializedRel`:`skills/<name>/...` 分支返回 `.jspace/skills/<name>/...`。
2. `cli/embed.ts` `materializeTree`:`skills/` 分支 `rel` 改为 `.jspace/skills/` 前缀(`key.slice("skills/".length)` 拼接,保持 `/` 分隔)。
3. 更新 `application/workspace/manifest.test.ts`(`materializedRel` 断言 + journal 用例 key)→ 新 rel;`application/workspace/workspace.test.ts` `skillRel`;核对 `cli/init.test.ts` 产物断言。

**门1**:`bun test application/workspace/manifest.test.ts application/workspace/workspace.test.ts` 绿;AC1 断言成立。

## 2 工作台模板 + CLI 文案

4. `templates/workbench/AGENTS.md`:所有 `skills/<name>` 路径 → `.jspace/skills/<name>`;「Skill Governance」措辞(根 `skills/` = 用户自建;官方在 `.jspace/skills/`);「Durable Knowledge Routing」行 `skills/<jspace-skill>/` → `.jspace/skills/<jspace-skill>/`。生成块标记内外界不可动。
5. `templates/workbench/README.md`:skills 列表(15-18 行)+ 36、49 行路径。
6. `application/workspace/init.ts` 输出:`follow skills/jspace-bootstrap/SKILL.md` → `.jspace/skills/jspace-bootstrap/SKILL.md`。

## 3 仓库顶层文档(描述工作台的部分)

7. `README.md`:第 8 行工作台产物描述 `skills/` → `.jspace/skills/`;第 79 行 `skills/jspace-bootstrap/` → `.jspace/skills/jspace-bootstrap/`。
8. `AGENTS.md`:11-12、44、50 行(工作台生成物描述)。
9. `docs/PLATFORMS.md`:35 行「见工作台 `skills/...`」。
10. `GOAL.md`:仅 57 行前瞻性「见工作台 skills/...」同步;87-97 行 milestone 记录**不改**。

## 4 skill 内交叉引用(按 design D2 分类逐一改写)

11. (a) 文档指针 → `../<skill>/...`:
    - `skills/memory-recall/SKILL.md`(2:gbrain-write.md ×2)
    - `skills/memory-writeback/SKILL.md`(2:gbrain.md、asset-ingest/SKILL.md)
    - `skills/jspace-bootstrap/references/gbrain.md`(1)
    - `skills/memory-recall/references/discipline.md`(2)
    - `skills/memory-writeback/references/example-writeback.md`(1)
12. (b) run-command → `.jspace/skills/...`:
    - `skills/asset-ingest/references/deep-extract.md`(2:extract.py 统一入口 + run 示例)
    - `skills/asset-ingest/references/example-ingest.md`(1,核对上下文)
    - `skills/memory-recall/references/memory-acceptance.md`(office-extract.py 路径)
13. (c) 全局引用(`harness-config` 的 `~/.agents/skills/...` 等)→ **不改**。

**门2**:`bun run scripts/check-skills.ts` 全绿(C1 引用完整性含改写后的 `../` 引用;C2/C3 渲染一致性;C4 freshness)。

## 5 重跑生成 + 质量门(Phase 2.2)

14. `bun run scripts/gen-assets.ts`(刷新 `cli/assets.generated.ts` / `manifest.generated.ts` / `skills.generated.ts`;重写 workbench AGENTS.md 生成块)。
15. `bun run scripts/check-skills.ts`、`bunx tsc --noEmit`、`bun test` 全绿。
16. `git diff` 人工 review:确认无「工作台语义」的 `skills/` 旧路径残留;确认 bundle key(`cli/assets.generated.ts` 内 `"skills/..."`)未动;`cli/init.test.ts` 等未误改 bundle-key 断言。

**门3**:tsc + bun test + check-skills 全绿;diff 无异常。

## 6 端到端验证(对应 AC2/AC3/AC6)

17. 源码态:临时目录 `bun run cli/main.ts init --force /tmp/ws-space-test` → 断言官方 skill 在 `.jspace/skills/`、AGENTS/README 引用新路径、init 文案正确。
18. 旧工作台兼容:`bun run cli/main.ts init --force /tmp/ws-legacy`(当前 bin 1.0.6 生成)→ 新代码 `workspace diff` 断言 `.jspace/skills/` create + 旧 `skills/` stale;`workspace upgrade --dry-run` 复核;真实 upgrade 后 `.jspace/skills/` 就位、旧 `skills/` 未删。
19. 边角:改旧工作台 `skills/<name>/SKILL.md` 后 diff 断言 `skip`(seed: local content kept),改动保留。

## 7 发布(门4:用户确认后执行)

20. bump `package.json` → 1.0.7 → `bun run build` 重编译 `bin/jspace` → `jspace --version` 验证。
21. (可选)`bun run build:all` 全平台 + `git tag v1.0.7` 由发布流程决定。

## 回滚点

- 实现阶段:每文件粒度 `git checkout`(纯代码 + 文档,无不可逆操作)。
- 发布前任一门禁失败:回退代码,不 bump 不 build。
- 已发布编译二进制不自动回滚(版本语义),下次 build 前 `git revert`。

## 验证命令速查

```bash
bun test application/workspace/manifest.test.ts application/workspace/workspace.test.ts
bun run scripts/gen-assets.ts
bun run scripts/check-skills.ts
bunx tsc --noEmit
bun test
bun run cli/main.ts init --force /tmp/ws-space-test
bun run cli/main.ts workspace diff --dir /tmp/ws-legacy
```
