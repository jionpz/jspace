# Design — Round 8 健康审查修复 (issue #9)

## 边界与合同

- **9 个独立可验证交付物**，按 issue #9 的推荐合入顺序串行执行；每个子任务对应一个可单独 merge 的改动集。
- 各子项间的耦合：仅 #9-02/#9-03 同改 doctor.ts（可同文件不同位置）；#9-08 涉及 workspace.ts/init.ts 与 #9-02 无关。
- 回归契约：每条修复必须带针对性测试或复测证据；全部完成后跑验收判据。

## 数据流 / 关键改动面

| 子项 | 改动面 | 数据流 |
|---|---|---|
| #9-01 | templates/workbench/.jspace/cron.json 等模板 + scripts/migrate-memory-model.ts:101 + skills 两处引用 | 模板 slug 物化进生成资产 → 新 init 读取 |
| #9-02/#9-03 | application/diagnostics/doctor.ts（checkGBrain / :738 readJson 闭包） | harness 配置读入 → JSON.parse → 失败降级 info |
| #9-04 | adapters/scheduler/{linux,win32,darwin}.ts → 复用 adapters/process/spawn.ts | 外部命令统一经 timeout 封装 |
| #9-05 | application/automation/use-cases.ts（cronAdd） | Windows 前置 isWindowsInstallable 校验 |
| #9-06 | 根 AGENTS.md 命令面 | 文档 ↔ 真实 CLI 对齐 |
| #9-07 | doctor.ts:564-569 toml 段解析 | section 作用域限定 |
| #9-08 | workspace.ts:282 / init.ts:73 备份写 | 统一 writeBytesAtomic |
| #9-09 | skills/jspace-use/SKILL.md + README/GOAL.md + docs/PLATFORMS.md | 口径对齐 |

## 权衡与决策

1. **先止血后统一**：#9-01（模板一行修）先合入，避免新 init 再产脏 slug；再 doctor 崩溃红线；再调度器 timeout（跨文件动面广，独立 PR 降低 review 认知负担）。
2. **P1-4 选改代码而非改文档**：「add/install 都报错」是更安全默认，代码向文档对齐。
3. **gbrain 红线平移而非新建抽象**：调度器 timeout 复用 adapters/process/spawn.ts 既有语义，不引入第三套进程封装。
4. **两轴分立**：合并列按顺序便于跟踪，commit 分类仍按 Standards/Spec 写。

## 兼容性 / 回滚

- 全部为既有代码的修正，不引入新命令、不改变对外 CLI 契约（除 #9-05 Windows 新增拒绝路径）。
- 每子项独立 commit，可单独 revert；回滚点 = 各子任务完成时点。
- #9-01 改动模板后必须重跑 gen-assets 重编译（见 jspace-cli-assets-regeneration 教训），否则编译产物仍含旧 slug。

## 风险

- doctor.ts 改动面两处（#9-02/#9-03/#9-07），需在改完统一跑 doctor.test.ts 全量。
- gen-assets 与 check 脚本联动：#9-01/#9-09 改模板/文档后，三 check 脚本是回归闸。
