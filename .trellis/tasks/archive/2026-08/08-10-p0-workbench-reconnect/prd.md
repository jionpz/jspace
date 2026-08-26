# P0 本机工作台接通与清理

## Goal

把 2026-08-10 审查发现的四处「机制在、接线断」全部接通:分发链刷新、AGENTS.md 块外遗产清理、项目挂接、cron 首次自然触发观察。本任务是运维性质(操作对象为本机 `~/jspace-work` / `~/.agents` / `~/.claude.json`),不改开发仓代码;过程中发现 CLI bug 只记录、另立任务。

## Requirements

### R1 分发链刷新(仓库 → 二进制 → 工作台 → 用户级)

1. 开发仓 HEAD 构建并安装本机二进制(`bun run build` → 安装到 `~/.local/bin/jspace`;如已发版可用 `jspace update`)。
2. `jspace workspace upgrade`(先 `--dry-run` 预览)刷新 `~/jspace-work` 的 seed/skill(本地改动保留为 skip 属预期,逐条过目)。
3. `jspace skills install` 刷新用户级 `~/.agents/skills/`(修复缺失的 5 个 per-harness reference 与过时文件)。
4. `jspace gbrain wire --dir ~/jspace-work` 补 `GBRAIN_SKILLS_DIR` env 进 `~/.claude.json`;接线后重启 claude 会话使 MCP 重连。

### R2 AGENTS.md 块外遗产清理

- 删除 `~/jspace-work/AGENTS.md` 受管块(`<!-- JSPACE:END -->`)之后的旧模板全文(2026-08-10 基线约 L103-307:旧 `jspace-bootstrap` 规则、死链 references、旧 Brain-ops 块)。
- 块外属用户区:**执行前向用户展示将删内容概要并获确认**(破坏性操作红线);用户想保留的个人规则先摘出再删。

### R3 项目挂接(让 weekly-report 的发现源成立)

- `workspace/files/README.md` 项目表挂接 filehub 现有 2 个真实项目(52期体验营、报表模块),替换占位行与占位文案。
- 酌情 `jspace project add` 注册(消除 ingest warning、稳定 slug)。

### R4 cron 首次自然触发观察

- 不做人工代跑;等待 launchd 自然触发(inbox-tidy 每日 21:00 为最近窗口)。
- 观察 `~/jspace-work/.jspace/logs/cron/launchd-*.log` 首次出现;次日会话 `jspace cron check` 核对聚合;记录结果(成功/失败与原因)供父任务关闭 GOAL 开放问题 #3。
- 顺带核对上周日 weekly-report 未跑的原因(装载时间晚于触发点或其它),记录即可。

## 约束

- 全程只读优先;所有删除/覆盖先确认;不 `--force`、不重 init。
- 不在本任务修 CLI/模板;发现问题记入本任务 notes 并回父任务分派。

## Acceptance Criteria

- [x] `jspace --version` 显示 HEAD 构建;`jspace doctor --dir ~/jspace-work` 无 error,且不再报 `gbrain.skillsdir_unwired`。
  → `1.0.11-42-g6f2262e`;doctor `0 error(s), 0 warning(s), 0 info`。
- [x] `diff -rq ~/jspace-work/.jspace/skills /path/to/repo/skills`(除 harness-config、`__pycache__`)无差异;`~/.agents/skills/jspace-use/references/` 含全部 5 个 harness-*.md。
  → 仅余两项,均已确认为设计内:`extract.test.py` / `office-extract.test.py` 不在 `cli/manifest.json` 下发清单(开发仓自测脚本);`RESOLVER.md` 是 `jspace gbrain wire` 写入的空占位,用于通过 gbrain `hasResolverFile` 门(`cli/commands/gbrain.ts:40-50`)。用户级 5 个 harness-*.md 齐备。
- [x] `~/jspace-work/AGENTS.md` 中 `JSPACE:END` 之后无旧模板内容;全文无 `jspace-bootstrap` 字样;经用户确认后删除。
  → 102 行(仅受管块),块外 0 行非空,`jspace-bootstrap` 0 处。删除前取证:块外 205 行与 `templates/workbench/AGENTS.md@f64555a3`(2026-08-05)逐字节一致,且用 32 个历史模板版本做语料交叉比对,0 行为用户手写。备份 `AGENTS.md.bak-20260810`。用户 2026-08-10 确认「全部删除」。
- [x] `workspace/files/README.md` 项目表含 2 个真实项目且无占位行。
  → 52期体验营 / 报表模块已挂接;areas 说明补齐;`domain.json` purpose/summary/tags 去占位。
  → 注:`jspace project add` 的 id 限 `[a-z0-9-]`,与中文项目名不兼容,registry 注册暂缓(已在域 README 留备注,移交 08-10-project-lifecycle-checklist 定「中文名↔ascii id」映射)。
- [x] 观察到 ≥1 次真实 launchd 触发(日志文件存在 + `jspace cron check` 汇总一致),结果已记录。
  → **早已在跑,非首次**:08-07 21:14 inbox-tidy failed(API Error 520,已 ack,incident `4ee594c6` status=resolved)→ 08-08 21:01 ok → 08-09 21:06 weekly-report、22:11 memory-consolidate → 08-10 21:02 inbox-tidy ok(今晚,自然触发)。`jspace cron check` = `needs_attention: 0`,与 journal 一致。三次 inbox-tidy 均「无事可做」(`_inbox/` 为空),说明 cron 腿在转但无输入。

## 执行记录与发现(2026-08-10)

- **审查误判更正**:原报告「cron 零次自然触发、logs 目录不存在」错误。根因:本机 `ls` 为 eza,`-t` 需带参数,`ls -lat <dir>` 把目录当成 `-t` 的值,配合 `2>/dev/null` 静默吞错 → 目录看似为空。教训:探测目录用 `find` 或不带 `-t` 的 `ls -la`,且不要盲目 `2>/dev/null`。
- **CLI 可用性问题(移交父任务分派)**:`jspace workspace upgrade` 在工作台目录内不带 `--dir` 执行时报 `not an initialized JSpace workbench (missing .jspace/marker.json)`,但同目录 `--dir .` 也失败,只有绝对路径 `--dir /Users/jionpz/jspace-work` 成功——疑似 cwd 解析缺陷,值得单独立任务复现。
- **已有机制线索(移交 08-10-doctor-drift-checks)**:cron 运行路径已有 skill 过时检测(launchd 日志出现 `jspace: error: run jspace workspace upgrade (skill asset-ingest is out of date; a local edit is preserved as conflict)`),而 doctor 路径没有——R2「skill 副本过时」可复用该机制而非新造。
- 备份清单(可回滚):`~/.local/bin/jspace.bak-20260810`、`~/.claude.json.bak-20260810`、`~/jspace-work/AGENTS.md.bak-20260810`、upgrade journal `cbb2f68f-4ef5-4fd9-95ba-022eaee049a4`。
- **待生效**:`GBRAIN_SKILLS_DIR` 接线需重启 claude 会话(MCP 重连)后才生效。
