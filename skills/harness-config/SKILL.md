---
name: harness-config
description: "机器级多-harness 全局治理:检测已装 harness,维护单一事实源 ~/.agents/AGENTS.md,把各 harness 全局入口接到它,并只读核对会话级配置。Use when 配置 harness/统一多-harness 入口/全局治理缺失。Do NOT use for 单个工作台首配(→jspace-use)或旧项目收编(→jspace-adopt)。"
triggers:
  - "configure harness"
  - "harness config"
  - "global governance"
  - "multi-harness"
  - "wire harness"
  - "agent memory setup"
---

# harness-config - 机器级全局治理接线

给本机所有已装 harness 建立同一个静态治理入口。目标是单一事实源,不是把每个客户端的 MCP、hooks 和私有配置复制成多份规则。

## 触发 / 非目标

- 用:新机器配置 harness、`~/.agents/AGENTS.md` 缺失或陈旧、多个 harness 进入口不一致、只读核对会话级配置。
- 不用:单个 JSpace 工作台的 gbrain/filehub/cron 首配 → `jspace-use`;旧项目目录收编 → `jspace-adopt`;日常资料入库或召回 → 对应工作台 skill。
- 本 skill 不安装 harness,不接管 harness 自有的 MCP、hooks 或账号配置。

## 输入与前置

- 本机 `$HOME`、至少一个已安装或 config-only 的 harness。
- 本 skill 源码目录 `$SKILL_DIR`。
- gbrain 可选:仅在核对会话级配置时使用;按 `$GBRAIN_BIN` → PATH 解析,找不到就报 missing,不猜安装路径。
- 现有 `AGENTS.md`、`CLAUDE.md`、Codex/Pi/Cursor/Grok/OpenCode 全局入口及其内容所有权必须可读。

## 权威引用

- 本 skill 内引用一律以 skill 根为基准(`$SKILL_DIR` 指本 skill 目录);跨 skill 用 `../<skill>/...`。
- 逐 harness 接线、路径和生命周期矩阵:`references/harnesses.md`
- 治理文档骨架、分层和回滚:`references/governance.md`
- Golden run:`references/example-harness-config.md`
- JSpace 工作台侧接线:在**当前工作台根**读 `.jspace/skills/jspace-use/references/harnesses.md`(以 cwd 为准)。本 skill 是机器级的,不假设工作台 skill 与自己同目录;无工作台时跳过工作台侧核对。

## 写集

- `~/.agents/AGENTS.md`:唯一静态治理事实源。
- `~/.agents/skills/harness-config/`:本 skill 的用户级安装副本。
- 各 harness 的全局入口文件/symlink/import:只写接线指针,不复制规则正文。
- 不写:harness 的 MCP、hooks、provider、凭据、账号和项目级会话配置。

## 输出

| 对象 | 状态 |
|---|---|
| harness | installed / config-only / not-found / skipped |
| governance | created / reviewed / already-ok / conflict |
| global entry | wired / preserved / manual / unverified |
| session config | wired / missing / n/a / unknown |
| verification | file proof 或明确缺什么 |

## 主流程

1. **检测**:运行 `bash "$SKILL_DIR/scripts/detect.sh"`。未安装的 harness 跳过;config-only 需用户确认是否接线。
2. **安装自身**:幂等复制到 `~/.agents/skills/harness-config/`,不覆盖用户修改;冲突保留并报告。
3. **治理文档**:不存在则用 `governance.md` 骨架创建;已存在则 review 分层、必需主题和决策顺序。非空内容不粗暴覆盖。
4. **接线入口**:只处理 installed harness;按 `harnesses.md` 使用 symlink、import 或明确指针。目标已是非空用户文件时保留并给出 manual 合并方案。
5. **只读核对**:检查 gbrain MCP/CLI、session-start 注入和 hooks 的 wired/missing/n/a;不回显令牌,不修改配置。
6. **验证**:检查治理文件、各入口解析结果和 harness 检测状态;能内容验证的 harness 检查其 `/context` 或等价入口。

## 完成证据

- `~/.agents/AGENTS.md` 可读,含安全与隐私红线、决策原则、维护约定;
- 每个已装 harness 的入口能解析到治理文档,或明确记录 preserved/manual;
- 非空用户文件没有被覆盖,冲突有原路径和恢复说明;
- 只读配置核对给出 wired/missing/n/a/unknown,没有密钥泄露;
- 检测脚本输出和最终报告一致。

## 失败与恢复

- 无 harness:报告 not-found 并停止,不尝试安装未知客户端。
- 现有非空入口:先备份/记录,再给 merge 方案;不强制 symlink。
- 无写权限或跨卷链接失败:保留原文件,报告手动步骤;不静默复制正文。
- 检测结果不一致:以 `harnesses.md` 的文件级证据为准,把未验证项标 unknown。
- 误接线:恢复入口备份,验证原内容后重新检测;治理文档本身不回滚用户后续编辑。

## 转交

- 工作台 gbrain/filehub/cron 配置 → `jspace-use`
- 旧项目 adoption → `jspace-adopt`
- 记忆事实与指针 → `memory-writeback` / `asset-ingest`
- 召回问题 → `memory-recall`

## 自检

```bash
ls -la "$HOME/.agents/AGENTS.md"
bash "$SKILL_DIR/scripts/detect.sh"
readlink "$HOME/.codex/AGENTS.md" 2>/dev/null || true
readlink "$HOME/.claude/CLAUDE.md" 2>/dev/null || true
rg -n '^#{1,3} .*(安全与隐私红线|决策原则|维护约定)' "$HOME/.agents/AGENTS.md"
```

没有文件级证明时只能报 unverified,不能宣称所有 harness 已统一。
