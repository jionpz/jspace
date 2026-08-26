# P0: 正确性 / 死链修复(P0-1 ~ P0-4)

## Goal

修掉 4 个 P0 问题:崩溃窗口误跳过 cron、`_inbox/` 计数三套算法不一致、工作台 AGENTS.md 死链、skill 引用 `~/.agents/skills/` 但 init 不装到那。这些直接影响正确性 / agent 可操作性,优先于一切。

## Requirements

### P0-1 `todaySuccess` 改读 RunRecord(崩溃窗口误跳过)

- **位置**: `application/automation/execute.ts:56–67` + `application/automation/runs.ts`
- 现状:`todaySuccess()` 用 `readdirSync` 扫 `.md` 找含 `status: ok` 的文件。`cronRun` 先写 `.md` prose log(`execute.ts:200–211`)后写 `RunRecord`(`execute.ts:213–224`)。两次写之间崩溃 → `.md` 已含 `status: ok` 但 RunRecord 缺失 → 下一次 cron 触发被静默跳过。
- **修复**:`todaySuccess` 改读 `runs.ts` 的结构化 RunRecord(`runs.lastRun()` 已提供但无人用)。保留 prose log 作为人类 payload,但 same-day skip 决策不再依赖它。
- **回归用例**:`execute.test.ts` 加崩溃窗口用例 —— 构造 `.md` 含 `status: ok` 但 RunRecord 缺失,断言 **不会** skip。

### P0-2 `_inbox/` 计数抽唯一实现

- **位置**: `application/workspace/doctor.ts:41–49, 178`(递归数文件)、`application/registry/inbox.ts:28–40`(只数顶层项)、`application/context/collect.ts:50–63`(顶层项 + 10000 cap)。
- 现状:`_inbox/foo/` 下 3 个文件 → doctor 报 3、inbox 报 1、context 报 1,三处数字不一致。
- **修复**:唯一实现 `countInbox`(顶层项计数 + 10000 cap,与 hook 简洁语义一致)放 `application/registry/inbox.ts`;doctor 与 collect 都调它。删 doctor 递归版、collect 本地实现。
- **回归用例**:`doctor.test.ts` 用 nested 目录断言计数一致。

### P0-3 工作台 AGENTS.md 死链

- **位置**: `templates/workbench/AGENTS.md:39–43` 引用 `references/registry.md`(根下不存在)。
- **修复**(两处同步):
  1. `templates/workbench/AGENTS.md` 改为 `.jspace/skills/jspace-use/references/registry.md`(绝对工作内路径,或核对实际物化路径)。
  2. `cli/assets-reachability.test.ts:32–57` 扩展:对 `templates/` 也检查 reference reachability(不只 SKILL 包内),拒绝「指向模板文件根内的相对路径但不存在」。
- **回归用例**:断链用例(构造指向不存在的相对引用 → 测试红)。
- **注意**:改 `templates/` 后必须 `bun run scripts/gen-assets.ts` 重同步嵌入式资产。

### P0-4 skill 引用 / install 两段策略

- **位置**: 4 个 skill(jspace-use / asset-ingest / memory-recall / memory-writeback)SKILL.md 引用 `~/.agents/skills/...`;`application/workspace/init.ts` 只物化 `.jspace/skills/`;`application/skills/install.ts:32–33` 已存在文件永不覆盖。
- 问题:首启后 agent 按 SKILL.md 打开 references 大概率 404;upgrade 后 `~/.agents/skills/` 长期是旧副本 → 过期文档比 404 更糟。
- **修复**:
  - A 首启链路:`initWorkbench` 返回 lines 显式提示「安装外部 skills: `jspace skills install --dir <path>`」;workbench README / AGENTS.md first-use 段落同步加这一步。
  - B upgrade 链路:`installSkills` 接受 `--force` 或 hash-compare(相同跳过、不同刷新);`workspace upgrade` 成功后自动对 `~/.agents/skills/` 做 drift 检测 / 刷新。
  - `templates/filehub/README.md:17` 相对路径 `{workbench}/.jspace/skills/...` 改为 `~/.agents/skills/` 或写明 filehub 是独立目录。

## Acceptance Criteria

- [ ] `bun test application/automation/execute.test.ts application/workspace/doctor.test.ts application/registry/*.test.ts application/context/*.test.ts cli/assets-reachability.test.ts` 全绿(含新增回归用例)。
- [ ] 崩溃窗口用例:P0-1 中「`.md` 有 ok 但 RunRecord 缺」→ same-day skip **不**触发。
- [ ] nested `_inbox/` 目录下 doctor / inbox / context 三处计数一致。
- [ ] 重新生成的 `templates/workbench/AGENTS.md` 无 `references/registry.md` 死链;`assets-reachability.test.ts` 新增 templates 断链检查通过。
- [ ] init 返回提示含 `jspace skills install`;upgrade 后 `~/.agents/skills/` 与 `.jspace/skills/` 无旧副本漂移(或明确记录 hash-compare 行为)。
- [ ] `bunx tsc --noEmit` 通过;`bun run scripts/gen-assets.ts` 产物已同步(git status 无未同步 generated 文件)。

## Notes

- 本批次不改 scheduler 契约、不动架构;纯正确性 + 死链。
- 仓库 PUBLIC:提示文案用中性示例路径。
