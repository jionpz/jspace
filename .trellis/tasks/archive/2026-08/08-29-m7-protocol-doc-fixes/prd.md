# M7 协议文档三处修正

## Goal

把 M7 已发行协议里三处「照抄即错 / 口径互斥 / 未实现承诺」修到与 CLI 和 doctor 一致；其中 profile 注入按冻结分类学接到 `jspace context session-start`，独立于项目卡 max-8、最多 4 张。

用户价值：kickoff 第 6 步照抄不再被拒；台账位置与 doctor 一致；工作台偏好页真正进入开会话上下文，而不是只写在文档里。

## Background

审查（2026-08-29）亲证三条协议缺陷。用户拍板：台账收敛到文件路径；profile 这次接线（独立预算、上限 4）。不修 B 组、不改 doctor 行为、不扩 taxonomy。

## Confirmed Facts

1. **kickoff enable 命令非法。** `usage-mileage.md:155` 一次传入四个 id。`cli/commands/cron.ts:52-57` 的 `enable` 只接受单个 `id`。权威写法在 `SKILL.md:64` 与 `example-first-use.md:93` 的 `for id in …` 循环。仓库内仅 `:155` 这一处批量写法；`:28` 已是单 id。
2. **台账位置口径不一。** `usage-mileage.md:118` 允许 gbrain retro 附节或 `.jspace/usage-mileage-ledger.md`。doctor `checkUsageMileageLedger`（`application/diagnostics/checks/usage-mileage.ts:6-24`）只认该文件存在，无 deferred 逃生口。GOAL.md:100、kickoff 第 4 步、SKILL.md:76、template 页眉、同文件 `:229` 都只认文件路径。
3. **example-first-use.md:129 自相矛盾。** 「已复制(或明确 deferred); doctor --verbose 无 `usage.mileage_ledger_missing`」——deferred 时文件仍不存在，该 info 仍会报。
4. **profile 注入未接线。** `gbrain.md:173/:228/:234` 声称 session 注入会 `--tag profile` 并与 state 卡一起出现。`collectActiveProjects` / `listProjectStates` 只查 `tag: "project"`。session-start 只填 `state.projects`。payload 只有「项目:」行。`gbrain list` 无 tags 列，archived 必须 `get` 正文。
5. **项目注入现状。** `MAX_ACTIVE_PROJECTS = 8`；archived / hub 排除不占名额；每卡串行 `get`（2s 超时）；失败降级空列表；turn / pre-compact / session-end 的 CLI 路径不调 gbrain（render 若 state 里已有项目仍会画「项目:」行）。
6. **改 skills/ 必须重跑 `scripts/gen-assets.ts`。**

## Requirements

- **R1** `usage-mileage.md` kickoff 第 6 步改为与 SKILL.md §2.4.5 相同的逐 id 循环（或逐条 `jspace cron enable <id> --dir <wb>`），保留「按需 subset」。仓库内不再出现多 positional 的 `cron enable` 示例。
- **R2** 台账实例的唯一路径是 `<wb>/.jspace/usage-mileage-ledger.md`。改掉 `usage-mileage.md:118` 及「gbrain retro 附节也可当台账」的句子；kickoff 第 4 步去掉「或等价路径」。`example-first-use.md:129` 拆开：复制则无该诊断；跳过 M7 跟踪则该 info 仍在、doctor 不失败。不改 doctor 代码。
- **R3** session-start 接线 profile 注入：`gbrain list --type note --tag profile`，slug 过滤 `profile/<主题>`（单段），跳过 `status:archived`（及 tags 含 `weekly` 的页），失败降级为空。独立于项目 max-8；最多 4 张，超出按 list 既有 recency 截、被跳过的不占名额。与 `collectActiveProjects` 并行。payload 有事才说（单独「偏好:」行）。`gbrain.md` 声明与实现一致。不扩 taxonomy。
- **R4** 改完 skills 后重跑 `bun run scripts/gen-assets.ts`，生成物无残留 diff。

## Acceptance Criteria

- [ ] AC1：kickoff 第 6 步照抄对 `cron enable` 合法；仓库无多 positional `cron enable` 示例。
- [ ] AC2：协议 / first-use / SKILL / GOAL 对台账路径口径一致；不再把 gbrain retro 附节写成台账替代位置。
- [ ] AC3：`example-first-use.md` 不再声称「deferred 时 doctor 无 `usage.mileage_ledger_missing`」。
- [ ] AC4：有未归档 `profile/<主题>` 时，`jspace context session-start --plain` 含「偏好:」行；无页则整行省略；`status:archived` 不出现；gbrain 失败/超时空列表且不阻塞 hook。项目卡 max-8 语义不变。超过 4 张未归档时只注入最近 4 张。
- [ ] AC5：`gbrain.md` 注入段与实现一致（独立预算、上限 4、archived 跳过、`--tag profile`、CLI `collectActiveProfiles`）。
- [ ] AC6：`bun run scripts/gen-assets.ts` 后 `git diff --exit-code cli/*.generated.ts`；`bun run scripts/check-skills.ts` 通过；`bun test` 覆盖 collector（过滤/归档回填/上限/失败降级）与 payload「偏好:」行。session-start 仍 ≤4KiB。

## Out of Scope

- B 组工程缺口（AGENTS 块内覆盖、`~/.agents/skills` refresh、pending get 旁路、win32 三态、briefing.json 无锁）。
- 项目卡内部串行 `get` 重构（审查 A4）。本任务只让两条 list 并行。
- `listProjectStates` / `jspace project list --status` 仍只俯瞰项目卡。
- 改 `cron enable` 接受多个 id；改 doctor 认 gbrain 台账或加 deferred 逃生口。
- 扩 taxonomy。turn / pre-compact / session-end 的 CLI 不新增 gbrain 收集（与项目卡一致，只 session-start 调 collector）。
- 真实工作台 kickoff 与 M7 三腿取证。

## Key Decisions

- 台账唯一路径 = `.jspace/usage-mileage-ledger.md`；retro 页是当周审计，不是里程计。
- **Q1（用户 2026-08-29）**：profile 注入这次接线，不撤回声明。
- **Q2（用户 2026-08-29）**：独立预算，最多 4 张未归档 `profile/<主题>`，不占项目 max-8。
- 复杂任务：`prd.md` + `design.md` + `implement.md`。不拆父子任务（文档与接线同一验收面）。

## Risks / Deferred

- profile 页膨胀超 4 张时静默截断；不在本任务加 doctor/retro 告警（taxonomy 已有「tiny count / retro flag inflation」纪律，留给使用里程）。
- 并行 list 后最坏墙钟仍由项目卡串行 `get` 主导；不在本任务修 A4。
