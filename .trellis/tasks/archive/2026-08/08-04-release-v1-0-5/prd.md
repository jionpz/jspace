# 完善 ingest cleanup recovery 并发布 v1.0.5

## Goal

在 `f951e3f` 已消除 journal/envelope 截断写和“先删 source、后记 committed”死状态的基础上，补齐 commit 与 source cleanup 之间的最后一段可恢复语义，再将完整修复作为不可变补丁版本 `v1.0.5` 发布。公开二进制不得错误报告 source 已删除，也不得留下没有机械恢复入口的 inbox 残留。

## Background

- 当前正式版本为 `v1.0.4`，annotated tag 指向 `5a8374b`；GitHub Release 已公开。
- `main` 与 `origin/main` 当前指向 `f951e3f`。该提交已实现 journal/envelope 原子写、journal 写失败后的 staged target 补偿，以及先持久化 committed 再删除 source。
- review 发现 `f951e3f` 仍会吞掉 source unlink 失败：journal 已 committed、CLI 报告 `source removed`，但 source 可能永久留在 inbox，且 committed journal 不再可恢复。
- 现有 `IngestJournalV1` 已允许 `status=failed` 与 `failedStep=committed`，可用该合法组合表示 cleanup pending，无需增加字段、状态枚举或 schema version。
- 当前 release workflow 先发布 Release，再运行 3 平台 install smoke；因此必须在规划中明确 immutable tag 下的失败分流，不能用普通提交“修复”已创建的 tag。

## Requirements

### R1. Source cleanup 必须可恢复且不虚报

1. 从 `index` 完成 ingest 时，先原子持久化 `status=failed, failedStep=committed` 的 cleanup-pending 机器状态，再尝试删除 source，删除成功后原子持久化 `status=committed`。
2. cleanup-pending 状态再次执行同一 `jspace ingest advance <id> --complete` 必须幂等：source 存在则重试删除，source 已不存在则直接收敛为 committed。
3. unlink 失败必须保留 cleanup-pending 状态、返回非零并输出可直接执行的重试命令；不得输出 `source removed`。
4. journal 最终写 committed 失败时，cleanup-pending 机器状态必须仍可读；下一次 `--complete` 能在 source 已删除的情况下收敛。
5. `ingest list/status` 与 asset-ingest 文档必须让 cleanup-pending 可见且可操作，prose 日志不得取代 journal 机器状态。
6. 不新增 journal schema 字段或状态枚举；沿用 `IngestJournalV1` 的现有合法组合，保持已存在 v1 journal 可读。

### R2. 回归验证

1. 增加 unlink 失败、cleanup 重试、source 已删除后恢复、最终 committed 写失败/中断等 fault-injection 回归。
2. 正常 `begin -> gbrain -> index -> complete` 仍只删除一次 source 并最终 committed。
3. duplicate/in-progress/rollback 语义不回退；自动化测试只使用临时目录和注入依赖。

### R3. 版本生成必须确定

1. 只在 R1/R2 完成并通过质量门后 bump `package.json` 到 `1.0.5`。
2. 必须显式运行 `JSPACE_BUILD_VERSION=v1.0.5 bun run scripts/gen-version.ts`，再运行 `bun run scripts/gen-assets.ts`；不得依赖 `git describe`（tag 创建前它仍会返回 `v1.0.4`）。
3. `package.json`、`cli/version.generated.ts` 与 `BUNDLE_MANIFEST.bundle_version` 必须一致为 `1.0.5`，generated freshness 无差异。

### R4. 发布前质量门与推送顺序

1. 本地必须通过 TypeScript、全部 Bun 单测、Office 抽取测试、generated freshness、临时工作台全链和本机编译二进制版本/模板版本检查。
2. 发布相关 diff 必须 review，无密钥、环境文件或无关改动。
3. 经用户明确确认后，先正常 push `main`；必须等待该 release commit SHA 的远端 `verify` workflow 成功，才能创建 tag。
4. tag 必须是新建 annotated tag `v1.0.5`，只创建/推送一次；禁止移动旧 tag、force-push 或覆盖既有 release。

### R5. Immutable tag 发布与失败分流

1. tag workflow 必须完成六平台构建、compiled-binary smoke、checksums、Release 发布和现有 3 平台 install smoke。
2. 纯 runner/network 等瞬态故障且 source/tag 内容无需修改时，可以 rerun 同一 workflow；不得重建 tag。
3. 任何需要代码、workflow 或生成物提交才能修复的问题，均不得进入 `v1.0.5`：保留失败证据，递增到新的补丁版本（至少 `v1.0.6`）重新走完整流程。
4. Release 已公开后 install smoke 暴露真实缺陷时，给 `v1.0.5` Release 增加醒目警告，随后以新补丁版本修复；不得替换原资产或移动 tag。
5. 发布后核对 Release 非 draft/非 prerelease、六平台资产与 `checksums.txt` 齐全；用临时目录下载本机资产，验证 SHA-256、`jspace 1.0.5`、初始化后 marker `template_version=1.0.5`，并确认 tag 包含 cleanup recovery 修复提交与 `f951e3f`。
6. Release notes 至少说明 ingest journal/envelope 原子持久化与 source cleanup 可恢复性修复。

## Acceptance Criteria

- [ ] **AC1 / R1**：unlink fault 后 journal 为 `failed + failedStep=committed`，CLI 非零且不声称 source 已删除，并给出 `--complete` 重试动作。
- [ ] **AC2 / R1**：cleanup-pending 在 source 存在和 source 已不存在两种情况下重复 `--complete` 均收敛为 committed；正常路径最终 source 不存在。
- [ ] **AC3 / R1-R2**：commit 前后所有故障点都有回归测试，现有 duplicate/resume/rollback 行为不回退，测试总数不少于当前 219。
- [ ] **AC4 / R1**：asset-ingest、batch 和运维说明均记录 cleanup-pending 的发现与重试路径，生成后的工作台 skill 引用同步。
- [ ] **AC5 / R3**：显式版本生成后 `package.json`、`VERSION` 与 `BUNDLE_MANIFEST.bundle_version` 均为 `1.0.5`，generated freshness 无差异。
- [ ] **AC6 / R4**：`bunx tsc --noEmit`、`bun test`、Office 抽取测试、临时工作台全链、本机 compiled binary 版本/marker 检查全部通过。
- [ ] **AC7 / R4**：release diff 已 review；经用户明确确认后 push `main`，且该 release commit SHA 的远端 verify 成功后才创建 annotated tag。
- [ ] **AC8 / R4-R5**：`v1.0.5` 与 `main` 正常推送，无 force-push、tag 移动或资产覆盖。
- [ ] **AC9 / R5**：GitHub Release `v1.0.5` 发布成功，六平台二进制与 `checksums.txt` 齐全，build/release/install workflow 成功。
- [ ] **AC10 / R5**：下载的本机发布资产校验通过，CLI 与 marker 版本均为 `1.0.5`，tag history 包含 `f951e3f` 及 cleanup recovery 修复。

## Out Of Scope

- 重构 GitHub workflow 为 draft/candidate release；本任务只定义现有先发布后 smoke 流程的失败处置。
- scheduler 真实 apply 的 workbench tag 隔离。
- `cron status --dir`、weekly-report/memory-consolidate skill target 等能力补齐。
- 修改、移动或重建 `v1.0.4` tag/release。
- 对 ingest 的 gbrain/index 事务模型做额外重构。

## Key Decisions

- cleanup-pending 复用现有 `failed + failedStep=committed`，避免新增 journal schema 版本；这是对已合法状态组合的明确语义，不改变 v1 形状。
- 同一 `--complete` 同时承担首次 cleanup 和幂等恢复，不新增一次性 CLI 命令。
- 使用语义化补丁版本 `1.0.5`，不改写已发布的 `v1.0.4`。
- 发布提交远端 verify 成功是 tag 创建的硬 gate；tag 后需要提交的修复一律进入下一补丁版本。
- push、tag、Release metadata 修改均为外部动作，必须在本地实现、check、commit 和 diff review 后再次取得用户明确确认。

## Risks And Deferred Items

- `failedStep=committed` 过去虽可解码但没有恢复语义；本任务需确保 status/list/skill 不把它当作一般不可重试失败。
- Release workflow 仍会在 install smoke 前公开 Release；candidate/draft 改造后续单独评估。
- scheduler、真实第二机和更广泛的跨平台 scheduler 验证继续单独建任务，不阻塞本补丁。
