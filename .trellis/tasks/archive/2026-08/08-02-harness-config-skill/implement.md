# harness-config-skill 执行计划

## 有序清单

1. **加载开发规范**：读 `.agents/skills/trellis-before-dev/SKILL.md`，按 .trellis/spec 注入本层规范（本项目为单仓库、skills 文档层）。
2. **写 `scripts/detect.sh` 并本机跑通**：POSIX bash，逐 harness（pi/claude/codex/cursor）输出 `harness\tbinary\tconfig_dir\tstate`（state ∈ installed / config_only / not_found）；用 `command -v` + `$HOME` 检测，自包含；本机验证输出与 `command -v` 现状一致。
3. **逐 harness 查官方文档 → `research/`**（研究先行，不靠既有知识/陈旧底稿）：每 harness 一节，覆盖全局文件位置与加载、symlink / @import 支持、MCP 配置方式、session 注入、rules 格式；记录来源 URL + 核查日期。四源：Claude Code（官方 docs）、Codex（OpenAI Codex docs）、Pi（官方 docs）、Cursor（docs.cursor.com）。回填 `implement.jsonl` 研究清单条目。
4. **写 `skills/harness-config/references/harnesses.md`**（基于步骤 3 研究结果，自包含，不引用仓库路径）：
   - 每 harness 一节：① 全局文件路径与接线（symlink / @import / .mdc 指针，结论以官方文档为准并标注来源）② gbrain MCP/CLI wiring（与 jspace-bootstrap 底稿交叉核对）③ session-start 注入 ④ 推荐配置备注。
   - 接线命令示例用 `<user-home>` 占位或 `$HOME`，不硬编码 jionpz 路径。
5. **写 `skills/harness-config/references/governance.md`**：
   - `~/.agents/agents.md` 骨架模板（可直接复制）：定位声明、安全/隐私红线、通用规范（默认中文）、工作台入口路由指引（如何找到/进入工作台）、与 gbrain 的分工（记忆在 gbrain，规则在此文档）、维护约定（单源、改此文件即可，symlink 入口只读/写回）。
   - 内容分层表：放（harness 无关规则）/ 不放（MCP、hooks、注入、域路由细节）。
6. **写 `skills/harness-config/SKILL.md`**：
   - frontmatter：`name: harness-config`；description 覆盖触发场景（用户要求配置 harness / 全局治理 / 多 harness 统一入口）。
   - 阶段流程：Phase 0 检测本机 harness（跑 `scripts/detect.sh`，无 installed 则提示）→ Phase 1 安装/升级自身（仓库源 → `~/.agents/skills/harness-config/`，幂等，不覆盖用户已改文件）→ Phase 2 创建/维护 `~/.agents/agents.md`（引用 governance.md 模板）→ Phase 3 接线已检测 harness 全局文件（引用 harnesses.md；跳过未安装项）→ Phase 4 推荐配置核对（gbrain MCP/注入，引用 harnesses.md，只核对不写入）→ Phase 5 验证与报告（ls -la 确认 symlink、逐 harness 报告 wired/skipped）。
   - 明确"用户根目录 `~/.agents`"措辞，避免与项目级 `.agents` 混淆。
7. **可选小改**：`skills/jspace-bootstrap/references/harnesses.md` 顶部加一行指向 harness-config（bootstrap wiring 视角保留）。
8. **实机验证（用户机器 = jionpz）**：按 SKILL.md 实跑——跑 detect.sh → 创建 `~/.agents/agents.md`（用骨架模板）→ 装 skill 到 `~/.agents/skills/harness-config/` → 接线已安装 harness 的**治理文档 symlink**（cursor 未装→跳过；`~/.codex/AGENTS.md` 空 stub 先删除再接线）→ 验证 symlink 目标（Claude Code **内容层**验证 + 其余**文件层**）→ 报告跳过项。gbrain MCP / session 注入**只核对报告**（本机 Codex config.toml 无 gbrain 条目→如实报 missing），不写既有配置。
9. **质量检查**：全文 grep 无 `myhub`/`hub-dev`/`hub doctor`；无硬编码本机路径 `grep -rn "jionpz\|/Users/" skills/harness-config/`；SKILL.md/references 均为合法 Markdown（章节顺序、frontmatter 闭合）；harnesses.md 每节有来源标注；`~/.agents` 路径措辞统一（注明"用户根目录"）。
10. **收尾**：spec 更新判断（是否把"全局治理层"约定写入 .trellis/spec，若无合适分层则记入 journal 即可）、提交。

## 验证命令

```bash
# skill 文件层
bash skills/harness-config/scripts/detect.sh                    # 检测输出与 command -v + 配置目录现状一致
grep -rn "myhub\|hub-dev\|hub doctor" skills/harness-config/ || echo clean
grep -rn "jionpz\|/Users/" skills/harness-config/ || echo clean   # 自包含：无硬编码本机路径
# 实机接线验证（预期结果写入任务报告）
ls -la ~/.agents/agents.md
ls -la ~/.pi/agent/AGENTS.md ~/.codex/AGENTS.md ~/.claude/CLAUDE.md   # symlink -> ~/.agents/agents.md
ls -la ~/.cursor/rules/agents.mdc                                     # 未装则跳过
# Claude Code 内容层验证：新会话 /context 或 @import 确认治理文档实际可见（非仅文件层）
# 回滚（如接线出错；MCP 配置未被触碰，无需回滚）
rm ~/.pi/agent/AGENTS.md ~/.codex/AGENTS.md ~/.claude/CLAUDE.md ~/.cursor/rules/agents.mdc
rm -rf ~/.agents
```

## 风险与回滚点

- 改动均在新文件（skills/harness-config/ 全新增）+ 用户根目录新增文件（`~/.agents/`、symlink、.mdc 指针），不动模板/CLI 现有逻辑；唯一既有文件改动是 R4 的一行引用（可随时还原）。
- **MCP 配置类既有文件（`~/.codex/config.toml`、`~/.claude.json`、Pi settings.json）本任务不触碰**——只核对报告，无 MCP 回滚需求；若用户要求补写 gbrain MCP，另行走 bootstrap。
- 若某 harness 已有用户自定义全局文件（如已有 `~/.claude/CLAUDE.md` 内容）：实跑时**不覆盖**——原内容并入治理文档 或 保留原文件 + 追加 import 行，二选一并向用户说明。本机 `~/.codex/AGENTS.md` 为 0 字节空 stub（判定无用户数据）：删除后建 symlink，处置写入报告。
- 实机验证失败项（如 Cursor rules 未生效、Claude Code symlink 内容层不生效）作为跳过项/备注报告，不阻塞任务完成（验收标准允许"报告跳过项"；Claude Code symlink 不生效则改用 `@import` 并验证）。
- **研究结论与既有假设冲突**：步骤 3 官方文档若与 prd/底稿假设不一致（如某 harness 全局文件路径、symlink 支持性不同），以官方文档为准修正 harnesses.md，并在 research/ 与 harnesses.md 中注明差异；若差异影响 prd 决策（如单源接线方式不可行），回 Plan 修订 prd 后再继续。

## task.py start 前复查

- [ ] prd.md 已收敛（无 open questions，R/AC/决策完备）
- [ ] 用户已批准最终规划总结
