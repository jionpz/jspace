# P0 正确性 / 死链 — 执行计划

## 执行顺序(每项:定位 → 修 → 补回归)

### 1. P0-1 todaySuccess 读 RunRecord
1. 读 `application/automation/runs.ts`,确认 `lastRun` / RunRecord 数据结构与存储路径。
2. 改 `application/automation/execute.ts:56–67` `todaySuccess` 读结构化 RunRecord(同目录同 cron 最近一次 RunRecord 的 day)。
3. 保留 prose log 写入(人类 payload),但 skip 决策与 prose log 解耦。
4. 回归用例:`execute.test.ts` 构造「`.md` 含 status: ok 但 RunRecord 缺」→ 断言 same-day skip **不**触发。

### 2. P0-2 _inbox 计数唯一实现
1. `application/registry/inbox.ts` 加 `countInbox(dir)`(顶层项 + 10000 cap)。
2. `application/workspace/doctor.ts:41–49, 178` 删递归版,改调 `countInbox`。
3. `application/context/collect.ts:50–63` 删本地实现,改调 `countInbox`。
4. 回归用例:`doctor.test.ts` 用 nested 目录(如 `_inbox/sub/` 下文件)断言三处一致。

### 3. P0-3 AGENTS.md 死链
1. 核对工作台物化后实际路径(init 后 `.jspace/skills/jspace-use/references/registry.md` 是否在;不在则找真实文件位置)。
2. `templates/workbench/AGENTS.md:39, 43` 改真实路径。
3. `cli/assets-reachability.test.ts` 扩展:对 `templates/` 前缀也解析引用、拒绝指向不存在的相对路径。
4. 断链回归用例(指向不存在文件 → 测试红)。
5. `bun run scripts/gen-assets.ts` 同步模板资产。

### 4. P0-4 skill install 两段策略
1. 读 `application/skills/install.ts`(hash-compare 可行性)、`application/workspace/init.ts`(返回 lines 构造点)、`application/workspace/upgrade` 链路。
2. A 首启:`initWorkbench` 返回 lines 加「安装外部 skills: `jspace skills install --dir <path>`」;workbench README / AGENTS.md first-use 段落补。
3. B upgrade:`installSkills` 加 hash-compare(相同跳过、不同刷新);`workspace upgrade` 成功后对 `~/.agents/skills/` drift 检测/刷新。
4. `templates/filehub/README.md:17` 路径改 `~/.agents/skills/`。
5. 回归:upgrade 后 `~/.agents/skills/` 副本与 `.jspace/skills/` 一致。

## 验证命令
- `bun test application/automation/execute.test.ts application/workspace/doctor.test.ts application/registry application/context cli/assets-reachability.test.ts`
- `bun test`(全仓)+ `bunx tsc --noEmit`
- `bun run scripts/gen-assets.ts`(改模板后)+ `git status` 检查 generated 同步

## Review Gates
- P0-1 变更前后跑 `execute.test.ts` + 手测一次 cronRun 同天重复触发。
- P0-3 改完模板后本地 init 一个临时工作台验证 AGENTS.md 引用可达。
