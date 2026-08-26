# Implement — 工作台资产布局与文档重构

任务上下文优先级:本文件 → `design.md` → `prd.md`。父任务持有源需求、任务地图、跨子任务验收与最终集成 review;子任务按顺序实施,各自独立验收。子任务间共享文件(manifest.ts / workspace.ts / templates)通过顺序与粒度隔离冲突。

## 子任务顺序

1. **C1 `skill-path-single-source`**(先做,零依赖):skillRel/skillRoot 单一来源 + 运行时引用修正 + 测试。这是后续一切的地基(所有路径引用统一)。
2. **C2 `upgrade-stale-cleanup`**(依赖 C1 的 skillRel 已就位):diffBundle 拆 remove/stale + upgrade 执行 remove + legacy 测试反转 + rollback 覆盖。
3. **C3 `workbench-agents-redesign`**(依赖 C1):工作台 AGENTS.md 重写 + README/顶层文档/spec/filehub notes 同步 + gen-assets 重跑。

> 每个子任务用自己的 `prd.md` / `design.md` / `implement.md` 定义验收与步骤;父级只在跨子任务边界(shared 文件)上做协调。

## 父级集成步骤(每个子任务归档后)

### 4 子任务间门禁(shared-file 协调)

- **G1**:C1 完成、C2 开始前,`application/workspace/manifest.ts` 的 `materializedRel` / `skillRel` 已稳定签名;C2 不重复实现路径逻辑。
- **G2**:C2 完成、C3 开始前,`templates/workbench/AGENTS.md` 的生成块标记未被动过(散文可改,标记保留);C3 重写时以生成块为界。
- **G3**:任一子任务改动 `cli/assets.generated.ts` 前必须重跑 `gen-assets`(不得手编)。

### 5 最终集成 review(X1-X5)

- `bunx tsc --noEmit`、`bun test`、`bun run scripts/check-skills.ts` 全绿。
- `bun run scripts/gen-assets.ts` 后 diff 干净(模板与生成物一致)。
- 源码态端到端:`bun run cli/main.ts init /tmp/jspace-smoke` → `doctor` 0 error → `cron install --dry-run` 校验 skill target 通过。
- 旧布局迁移:用旧版本产物(或手动构造 v1.0.5 布局 + materialized journal)模拟升级,验证 remove/stale 行为(X2)。
- `git diff` 人工 review:无 `skills/<name>` 旧路径残留(除历史存档);工作台 AGENTS.md 无开发仓库骨架拷贝。

## 验证命令

```bash
bunx tsc --noEmit
bun test
bun run scripts/check-skills.ts
bun run scripts/gen-assets.ts
bun run cli/main.ts init /tmp/jspace-smoke && bun run cli/main.ts doctor --dir /tmp/jspace-smoke
bun run cli/main.ts workspace diff --dir /tmp/jspace-smoke  # 或 --json
```

## 发布

本任务是否 bump 版本由最终 review 后决定(模板/CLI 均有变化 → 倾向 bump);bump 走既有流程(`bun run build` → gen-version → gen-assets → 重编译 → 校验)。
