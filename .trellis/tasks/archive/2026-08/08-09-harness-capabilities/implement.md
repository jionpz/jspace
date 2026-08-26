# P1 Implement: capabilities.yaml 数据化

## 有序检查清单（全部完成，2026-08-09）

- [x] **1. yaml 解析确认**：实机已验 `Bun.YAML` 存在 → 用 `Bun.YAML.parse`（gen-assets/P5 脚本期）；**运行时零 yaml 依赖**
- [x] **2. `adapters/harness/capabilities.yaml`**：schema_version + 6 条目（claude/grok/opencode/pi/cursor/codex），字段含 headless/argv_flags/sessions(source)/mcp(native|via)/skills_projection(workbench|user)/hook_format/native_memory/lifecycle(4 grade)/cron_harness_enum_value；pi 按 D4 终值（mcp via、sessions source:extension）；cursor 无 headless + mcp native + sessionStart hook（D6 保留）；codex 标 documented:false；lifecycle 初值照 harnesses.md:87-92（Grok/OpenCode 标待验证）
- [x] **3. gen-assets 加步骤**：render capabilities.yaml → `adapters/harness/capabilities.generated.ts`（TS 对象）；已运行生成 + verify.yml freshness gate 纳入该文件
- [x] **4. `adapters/harness/types.ts`**：`HarnessCapability` 类型（mcp 联合、sessions.source、lifecycle grade 枚举、workbench_projection/user_install 拆分；字段名镜像 yaml snake_case）
- [x] **5. `adapters/harness/registry.ts`**：`resolveCaps()`（**从 generated 模块读**，name 由 key 注入 + 校验）、`getCapability(harness)`（unsupported → fail）、`harnessNames`/`cronHarnessNames`/`workbenchProjectionDirs`
- [x] **6. `adapters/harness/{claude,grok,opencode,pi,codex,cursor}.ts` + `index.ts`**：每文件 export `capability` / `headlessArgv(prompt, platform, bin)`（**保留 bin 参数**）/ `hookFilePath`（pi/codex 无）/ `skillProjectionTargets`；claude 组装顺序与现状逐字节一致；**cursor 的 headlessArgv → `fail("cursor 无 headless CLI")`**
- [x] **7. `adapters/harness/argv.ts`**：删 switch → `registry`→`getAdapter` 派发；新建 `harness.ts` barrel export
- [x] **8. `application/workspace/manifest.ts`**：`SKILL_PROJECTIONS` 从 capabilities.workbench_projection 推导（R6c，含 shared）
- [x] **9. `cli/commands/cron.ts`**：cronRunSpec 加 `--harness <x>` override（R6b）；`cron add` help 从 HARNESSES 派生
- [x] **10. `core/contracts/cron.ts`**：`HARNESSES` 扩为 5 值（claude/codex/grok/opencode/pi，cursor 无 headless 不入）
- [x] **11. `application/diagnostics/doctor.ts`**：`checkHarness()`（**只查活跃 harness**：cron.json harness 值；unknown → warning；headless bin 缺失 → warning；`harnessBinOnPath` 注入），注册进 run 分组
- [x] **12. 测试**：`registry.test.ts`（结构/投影 union/cron 集/unknown fail/cursor fail）、`argv.test.ts` 改造（+grok/opencode/cursor/bogus）、`doctor.test.ts` 补 checkHarness 4 case、`cron.test.ts` enum 扩 5 断言、`manifest.test.ts` 投影集更新
- [x] **13. gen-assets 重跑**（capabilities 进嵌入资产）→ `capabilities.generated.ts` 入库 + verify.yml freshness 覆盖

## 验证命令（全部通过）

```bash
bunx tsc --noEmit                                    # TSC OK
bun test                                             # 451 pass / 0 fail
bun run scripts/gen-assets.ts                        # 幂等; 4 个 generated 文件 freshness OK
bun run cli/main.ts cron run inbox-tidy --harness claude --dry-run   # 回归: argv 逐字节一致
bun run cli/main.ts cron run inbox-tidy --harness grok --dry-run     # grok argv 组装 OK
bun run cli/main.ts cron run inbox-tidy --harness cursor --dry-run   # fail("cursor 无 headless") exit 1
bun run cli/main.ts cron run inbox-tidy --harness bogus --dry-run    # fail("unsupported harness") exit 1
bun run cli/main.ts doctor --dir /tmp/jspace-p1                      # checkHarness: claude ok / grok bin_missing warning
bun run build && ./bin/jspace cron run inbox-tidy --harness grok --dry-run  # 编译二进制嵌入 capabilities(H1 验证)
grep -rn "switch (harness)" adapters/ || echo "no switch left"        # 无遗留 switch
```

## 风险文件 / 回滚点

- `adapters/harness/argv.ts`（核心路径，回归靠 argv.test.ts 逐字节兜底）→ git revert 即回滚
- `core/contracts/cron.ts`（契约，enum 放宽不收紧）
- `application/workspace/manifest.ts`（SKILL_PROJECTIONS 推导，需 init/upgrade 回归）
- `cli/commands/cron.ts`（--harness override，纯新增）
- 回滚策略：本任务纯新增+小改，无数据迁移，revert 即可

## task.py start 前 follow-up

- [ ] capabilities 字段与审查修正后的 R1 对齐复查（mcp 联合 / sessions.source / lifecycle / projection 拆分 / **cursor 无 headless**）
- [ ] yaml 解析=Bun.YAML（脚本期），运行时零依赖
- [ ] argv 组装与现状逐字节一致（argv.test.ts 断言）
- [ ] codex 条目 `documented: false` 标注
- [ ] `cron run --harness` override 实现 + help 派生
- [ ] gen-assets 重跑含 capabilities render（**不再跳过**）
