# 只读盘点

目标:在写任何文件前得到可复核的事实表。只读命令失败也记录为 `unreadable` / `blocked`,不要用写入修复。

## 0. 边界声明

先记录:

- 目标项目根绝对路径;
- 当前是否为 JSpace(检查 `.jspace/marker.json`);是则停止 adoption,改走 `jspace workspace upgrade`;
- 用户要求是“评估”“dry-run”还是“批准后执行”;
- 允许看的目录范围;HOME 下配置只记录路径/状态,不读取或回显密钥值。

## 1. 项目与控制平面

逐项记录“存在 / 可读 / 可用 / 冲突”:

| 事实 | 查看内容 | 结论要求 |
|---|---|---|
| 入口指令 | `AGENTS.md`、`CLAUDE.md`、`.cursor/rules` | JSpace managed 块是否存在;块外内容必须保留 |
| JSpace 状态 | `.jspace/marker.json`、`.jspace/hub.json`、`.jspace/local.json` | 已初始化则走 upgrade;旧布局另记 |
| 旧 registry | 根 `hub.json`、`.jspace.json` | 字段、domains/resources/projects、路径来源 |
| cron | `.jspace/cron.json`、系统任务中带项目路径的项 | 仅盘点;不在本阶段 install/remove |
| git | `git status`、忽略规则 | 是否有未提交用户改动;不重写历史 |

旧 registry 里要特别区分:相对路径、绝对路径、url、绑定键、project status。绝对路径只作为本机事实,迁移时转 `local.bindings`,不要复制回 portable hub。

## 2. Skills 与投影

盘点这些目录(不存在也记录):

- 用户自建:根 `skills/`、`~/.agents/skills/`;
- JSpace 候选:`.jspace/skills/`;
- harness 投影:`.claude/skills/`、`.grok/skills/`、`.opencode/skills/`、`.cursor/skills/`、Pi 对应的 skills 路径;
- 全局入口:`~/.agents/skills/`、harness 用户级 skills。

对每个 skill 记录:name、来源目录、是否 symlink、link target、是否可达、内容 hash、与官方同名 skill 是否一致。不要跟随未知 symlink 到项目外写文件。

分类候选:

- 用户自定义 → `preserve`;
- 官方同名且内容一致 → 可 `link`,但仍先报告;
- 官方同名但内容不同 → `blocked/manual`,默认保留用户副本;
- 坏 symlink / 不可读目标 → `blocked`,不改。

## 3. Filehub 候选

候选信号:同时含 `_inbox` / `projects` / `areas` / `archive` 中两个以上目录,或含 `README.md`、`.obsidian/`、大量资料本体。

记录:

- 绝对根、是否在目标项目内、是否存在嵌套候选;
- 已有 `_inbox`、`projects`、`areas`、`archive` 哪些;
- `README.md` / 各项目 `index.md` 是否存在;
- 文件数量级与总量级,不读取文件正文;
- 是否被旧 registry 引用、旧路径是否仍存在;
- 可能的多个根及歧义点。

有多个合理解或嵌套根时直接列为 `manual`,询问用户;不要猜测后 register。

## 4. Harness 配置

只记录项目级与用户级配置的**位置和状态**:

- Claude Code:`.claude/settings.json`、用户 MCP 配置;
- Grok:`.grok/hooks/`、用户 MCP 配置;
- OpenCode:`.opencode/plugins/`、用户 MCP 配置;
- Cursor:`.cursor/hooks.json`、用户 MCP 配置;
- Pi:项目投影与用户 MCP 配置;
- Codex:cron 兼容状态(仅记录,不纳入 `harness wire` 的直接目标)。

记录已有 `gbrain` 项、非 gbrain 项、冲突项和备份需求;配置中的 token/secret 只写“存在/缺失”,不复述值。

## 5. Gbrain 与历史

只读确认:

- `gbrain` 二进制是否可用(按环境解析,不安装);
- 旧 slug 列表或用户记录的 slug(重点 `project/*/state`、`assets/*/*`);
- 至少一个旧 slug 的 `get`/`query` 结果;
- 哪些是中文/id 混用、哪些已是 ASCII。

**已有 slug 是历史身份**:保留原名,只记录;新项目才用 ASCII id。不要为了统一命名批量重命名。

## 6. 证据格式

把盘点写成一张表,每行至少:

`类别 | 源 | 存在/可用 | 证据命令或 hash | 目标候选 | 冲突 | 初判动作`

同时保存 dry-run 前快照:文件树 + 内容 hash(排除 `.git`、缓存和运行时日志),用于事后证明只读阶段没有副作用。证据只含去敏路径,不记录密钥值。
