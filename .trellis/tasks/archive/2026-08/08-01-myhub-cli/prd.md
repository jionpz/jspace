# PRD: JSpace CLI 产品化转型（原 myhub CLI）

## Goal

把 JSpace（原 myhub）从"纯静态注册表 + 文档"演进为**可安装的 CLI 产品**：在任意机器上安装 CLI，即可初始化并维护一个完整的工作台（注册表 + 域上下文 + 规则 + gbrain 接线 + cron 任务），让该机器的 AI 会话获得同样的"路由 + 记忆"底座。

- 本仓库 `/Users/jionpz/mycode/jspace` 是**开发/发行目录**，不是具体工作目录。
- 其他机器安装 CLI 后，在目标机上生成真实工作目录。
- 用户价值：**可移植的本地 AI 工作底座（路由 + 记忆 + 资产 + 定时，见根 `GOAL.md`）**——在记忆延续、上下文路由、定时任务上覆盖 hermes/OpenClaw 常驻方案的主要能力（静态规则层 + 独立记忆层(gbrain) + 惯用 harness + 系统 cron），并以独立的文件管理中心承载重资产（记忆存指针、资产存本体）；不引入常驻运行时；多机采用分层同步（规则与域内容走 git，registry 绝对路径按机器维护，见 Q6）。
- **长期愿景与本任务的关系**：最高对齐物是根 `GOAL.md`（四支柱与里程碑 M0-M5；根 AGENTS.md「Product Vision」为其摘要；hermes/OpenClaw 仅为对比基线）。本次任务（R3 registry 管理 + R8 模板修正）= 里程碑 M1：让工作台从"能生、能查"到"能维护"，同时是 M2 资产层的地基（文件管理中心将用 `jspace resource add` 注册）。后续依次：M2 资产层协议（R9）→ M3 cron（R4）→ M4 记忆精度 → M5 分发（R7）。

## Confirmed Facts (repository evidence, after rename commit 7258749)

- **改名**：myhub → JSpace（CLI 名 `jspace`，bootstrap skill `jspace-bootstrap`，域 `jspace-dev`）。本仓库路径 `/Users/jionpz/mycode/jspace`，根目录**不维护** hub.json / workspace 日常注册表。
- **已实现并提交**：`bin/jspace`（Python 标准库，约 319 行，零第三方依赖）提供：
  - `init <target>`：复制 `templates/workbench/` + `skills/jspace-bootstrap/` 到目标目录，替换 `__DEV_ROOT__` 占位符，写 `.jspace.json` marker。
  - `doctor --dir`：校验 hub.json（version=3、domains、resources、entrypoints、primary path 恰好一个、id 唯一、resource.domain 引用有效、域文件 README.md/domain.json 匹配）+ 外部路径缺失按 warning。
  - 核心校验逻辑集中在 `validate_hub()`，可被 registry 写命令复用（写前校验）。
- **模板** `templates/workbench/`：AGENTS.md + hub.json（version 3，2 domains：jspace-dev / agent-infra；3 resources：jspace / cc-switch / gbrain）+ `workspace/<domain>/`（README.md + domain.json）+ `skills/` + README.md。模板内不含 `.trellis`，不含 harness 接线配置。
- **模板含机器/用户特定绝对路径**：hub.json 写死 `/Users/jionpz/.cc-switch`、`/Users/jionpz/.gbrain`、`/Users/jionpz/.bun/...`；`__DEV_ROOT__` 在 init 时物化为本机路径。按 Q6 分层同步决策：registry 绝对路径属"本机真理"，模板去个人化 + 占位符机制拆为 R7 分发的前置任务，本次不动。
- **模板 AGENTS.md 存在悬空引用**：已将 `.trellis/tasks/<task>/` 列为任务规划落点（line 116）、Confirmation Rules 含 "outside the active Trellis task scope"（line 151）、质量检查含 "Do not add task-management concepts that duplicate Trellis"（line 183），但 `init` 不生成 `.trellis/`。line 35 / line 140 的 Trellis 引用指向开发仓库（`__DEV_ROOT__`），属正确引用保留；hub.json / domain.json 的 tags/notes 中 "trellis"（描述开发仓库工作流）同样保留。
- **bootstrap 首次配置由 skill 承担**：`skills/jspace-bootstrap/`（SKILL.md + references: gbrain.md / harnesses.md / registry.md + agents/openai.yaml），生成时复制进工作台。
- **gbrain 是第一核心**（hub.json 资源 gbrain，garrytan/gbrain，PGLite + 知识图谱 + 本地 embedding），接口为 gbrain 自身 CLI/MCP，jspace 不封装。
- **用户已确认架构方向**：cron 也在工作台目录下配置，用系统级调度（crontab/launchd）+ 惯用 harness 无头执行（`claude -p` / `codex exec` / `pi -p`），不依赖 hermes。
- **技术栈演进**：brainstorm 早期决策 Q2 = Node/TS + bun 单二进制（git 历史有 `src/hub.ts` 先例）；实际实现（7258749）采用 **Python 标准库**（与 bootstrap skill 的 python3 依赖契合，零依赖）。**无打包/分发/安装机制**。
- **AGENTS.md 已更新**为 JSpace 定位，无过时 "no hub CLI" 表述。

## Requirements

| # | 需求 | 状态 |
|---|---|---|
| R1 | `init`：在目标目录初始化工作台（hub.json + workspace/<domain>/ + AGENTS.md + skills + marker） | ✅ 已实现 |
| R2 | `doctor`：校验注册表全部规则 + 外部路径 warning | ✅ 已实现 |
| R3 | registry 管理：domain / resource 的**列出、新增、删除**（CLI 写 hub.json + 域骨架文件，写前校验，保持 schema 与 doctor 规则一致） | ✅ 已实现 |
| R4 | cron 管理 | ⛔ 拆独立任务（Out of Scope） |
| R5 | bootstrap 流程 CLI 化 | ⛔ 保持 skill 方案（Out of Scope） |
| R6 | 多机可同步：工作台是纯文本可 diff | ✅ 文件层已满足（语义层走 Q6 分层同步：registry 绝对路径按机器维护） |
| R7 | 分发：可安装/升级/文档/健壮性 | ⏳ 暂缓（Out of Scope for this task） |
| R8 | 模板 AGENTS.md 修正：清除 `.trellis` 悬空引用，改为"工作台无任务管理；如需可自行 `trellis init`" | ✅ 已实现 |
| R9 | 资产层：文件管理中心协议 + inbox 整理 skill（GOAL.md M2，Obsidian 可读、记忆存指针） | ⛔ 拆独立任务（Out of Scope） |

### R3 命令集（本次 MVP）

- `jspace domain list [--json]`：列出 domains。
- `jspace domain add <id> [--path <dir>] [--tag TAG ...] [--purpose TEXT]`：默认 `path=workspace/<id>`，生成 `README.md` + `domain.json` 骨架（结构与现有域一致），写 hub.json 记录。
- `jspace domain remove <id> [--purge]`：仅当该域下无资源引用时允许；有引用时报错并列出引用，须先删资源。默认只移除 hub.json 记录并提示域目录保留；`--purge` 才删除域目录（破坏性，依赖 git 回滚）。
- `jspace resource list [--json]`：列出 resources。
- `jspace resource add <id> --domain <id> (--path <abs> | --url <url>) [--type <type>] [--tag TAG ...] [--notes TEXT]`：校验绝对路径、domain 引用有效。`--type` 默认 `project`，可注册模板中已有的 `service` 等类型；`--notes` 缺省时省略该键，不写入空字符串。**`--path` 自动置 `primary: true`**（单 entrypoint MVP 下 primary 无信息量，见 Q8）；CLI 不提供 `--primary` flag（Q9 未上线无兼容负担，显式选择留给多 entrypoint 增强）。MVP 每个资源只支持单个 entrypoint；生成的 entrypoint id 默认与 kind 同名（`path` / `url`），语义化 id 留给后续增强。
- `jspace resource remove <id>`：删除资源记录。
- id 规则：domain/resource id 须匹配 `^[a-z0-9][a-z0-9-]*$`；remove 不存在 id 报错。id 格式校验**统一实现于 `validate_hub()`**（error 级）：doctor 与写命令规则同源，无 CLI 层单独正则（Q9 未上线，无历史 id 要容忍）。
- `--json` 输出 schema、hub.json 字段顺序稳定、错误/退出码约定见 design.md Contracts 节。
- `domain add` 边界语义：id 重复拒绝；`--path` 仅允许相对路径，且 resolve 后必须落在工作台根目录内（拒绝 `../` 逃逸；绝对路径拒绝）；默认 `path=workspace/<id>`；目标目录已存在时不覆盖已有 README.md/domain.json，仅追加 hub.json 记录。路径包含性在生成骨架文件**之前**检查（工作台外绝不落文件），同时也是 `validate_hub()` 的 error 规则（doctor 拦截手工编辑的逃逸 path）。
- `domain remove --purge` 删除目录前同样校验域目录 resolve 后位于工作台根内，杜绝删除工作台外目录。
- 所有写操作：先在内存中变更 → 复用 `validate_hub()` 校验 → **errors 非空则失败不落盘；warnings 不阻塞写**（仅 doctor 展示，允许注册尚不存在的路径）；hub.json 保持 `indent=2, ensure_ascii=False` 格式稳定可 diff。写回只按模板字段顺序构造**新建**记录；已有记录保持载入时的字段与顺序（未知字段不丢弃）。
- resource 的 update（改 notes/tags/entrypoints）不在 MVP；真实需求涌现后再加。

## Acceptance Criteria

- [x] `jspace init` 在干净目录初始化完整工作台并通过 `jspace doctor`。
- [x] `jspace doctor` 输出全部校验项结果（error/warning 分级）。
- [x] `jspace domain add/remove`、`jspace resource add/remove` 后 `hub.json` 仍合法且 `doctor` 通过；新增域目录含 README.md + domain.json 且 id 匹配。
- [x] `jspace domain add` 拒绝重复 id；目标目录已存在时不覆盖已有 README.md/domain.json。
- [x] `jspace domain remove` 在资源引用存在时拒绝删除并给出引用信息；不带 `--purge` 保留域目录，带 `--purge` 删除目录。
- [x] `jspace resource add` 拒绝非法输入（相对路径、未注册 domain 引用、非法 id），给出明确错误。
- [x] `jspace resource add --path` 写回的 entrypoint 自动 `primary: true` 并通过 doctor 校验（CLI 不提供 `--primary` flag）。
- [x] doctor 与写命令共用 `validate_hub()` 规则：对手工编辑的非法 id / 逃逸 domain path 同样报 error。
- [x] `jspace domain add --path` 与 `jspace domain remove --purge` 拒绝 resolve 后落在工作台根目录外的路径（`../` 逃逸防护），且失败时不留任何骨架文件。
- [x] 写回只重构**新建**记录；已有记录字段与顺序原样保留（含未知字段）。
- [x] `jspace domain/resource remove` 对不存在的 id 报错并 exit 1。
- [x] `domain/resource list --json` 输出为可解析 JSON，且含预期字段（domains: id/path/tags；resources: id/type/domain/tags/entrypoints）。
- [x] hub.json 写回后字段顺序与模板一致（git diff 无重排噪音）。
- [x] 写前校验通过但存在缺失路径时（warning 场景）写操作仍成功；doctor 后续以 warning 呈现。
- [x] hub.json 写回格式与手工编辑共存（indent 2、中文不转义、可 diff、未知字段保留）。
- [x] 工作台可整体 git 提交/克隆后在另一机器复用。
- [x] AGENTS.md 已反映 CLI 产品化方向，无过时表述。
- [x] 模板 AGENTS.md 无 `.trellis` 悬空引用（line 116 / 151 / 183 已修正；line 35 / 140 指向开发仓库的引用保留）；质量检查不再要求"不重复 Trellis"，改为不引入工作台任务管理概念。
- [x] 模板 README.md 或 AGENTS.md 含退出通道说明："如需任务管理可在工作台自行 `trellis init`"。

## Out of Scope

- 不封装/不包装 gbrain 命令（保持直连）。
- 不实现 hermes 的自主代理/多端网关能力。
- 不安装 harness 本身（假设目标机已有至少一个）。
- **R4 cron 管理**：拆独立任务（涉及系统调度 + harness 无头执行，从真实使用中涌现后再做）。
- **R5 bootstrap CLI 化**：保持 `skills/jspace-bootstrap/` skill 方案，避免重复实现。
- **R7 分发打包**：可安装/升级/打包暂缓，等真实分发需求（Q1 的"也可能给别人用"）出现再做；命令层保持无机器级硬编码路径。
- **模板去个人化 + 路径占位符机制**（`/Users/jionpz/...` → 占位符/由 bootstrap 填充）：R7 分发的前置任务，本次不动（见 Q6）。
- **R9 资产层**：文件管理中心（重资产归档协议、Obsidian 可读、inbox 整理 skill、域↔项目挂接）拆独立任务；方向与协议草案已定于 `GOAL.md`。
- **resource update**（改 notes/tags/entrypoints）：不在 MVP。

## Key Decisions

- **Q1 CLI 目标用户**：自用多机为主，也可能给别人使用 → 命令层保持可分发边界（无机器级硬编码路径），打包/文档按需后置。
- **Q2 技术栈**：brainstorm 决策 Node/TS + bun 单二进制；实际实现（7258749）改为 **Python 标准库**（`bin/jspace`），零依赖、与 bootstrap 的 python3 依赖一致。
- **Q3 工作目录形态**：`jspace init <target>` 显式指定任意目录（默认当前目录），无隐式家目录位置；CLI 无全局状态目录。
- **Q4 MVP 范围**：本次只做 **R3 registry 管理 + R8 模板修正**；R4 cron 拆独立任务；R5 bootstrap 保持 skill 方案；R7 分发暂缓。
- **Q5 工作台与 Trellis**：工作台**默认不带** Trellis 任务管理；Trellis 与本项目无关，模板 AGENTS.md 悬空引用改为准确表述（line 116 / 151 / 183）。
- **工作流管理定位**：指**会话级工作流**（harness 启动带域上下文 + 记忆注入、结束写回），由 bootstrap skill 指导的 harness 接线提供，不属本任务实现范围；不是任务级/开发仓库内容。
- **模式边界**：根 AGENTS.md（开发侧：Product Vision、开发模式、Trellis）与模板 AGENTS.md（工作台工作模式）内容隔离；init 生成的工作台不继承开发仓库 AGENTS.md 内容。
- **Bootstrap 形态**：首次配置由 `skills/jspace-bootstrap/` skill 承担，CLI 不重复实现。
- **Q6 多机路径策略（2026-08-01）**：分层同步——git 同步规则、域内容与骨架；registry 资源绝对路径属"本机真理"，按机器各自维护。模板去个人化 + 占位符机制拆为 R7 前置任务。
- **Q7 愿景表述（2026-08-01）**：自立定位"可移植的本地 AI 工作底座：路由 + 记忆 + 定时"；hermes/OpenClaw 降为对比基线；非目标显式化（常驻运行时、事件驱动/入站多端网关、自主代理）。
- **Q8 --primary 语义（2026-08-01，按 Q9 修订）**：单 entrypoint MVP 下 `resource add --path` 自动 `primary: true`；CLI 不提供 `--primary` flag；显式 primary 选择留给多 entrypoint 增强。
- **Q9 兼容性基线（2026-08-01）**：首次开发、从未上线，**无兼容性负担**——schema、CLI 接口、模板可自由演进，不做迁移/弃用通道；已生成的个人工作台以重新 init 或手工对齐跟进；版本化/升级承诺推迟到 R7 分发。
- **Q10 终局目标文件（2026-08-01）**：建立根目录 `GOAL.md` 为最高对齐物。愿景由三支柱扩展为**四支柱（路由/记忆/资产/定时）**：新增资产层——独立的文件管理中心承载 pdf/ppt/excel/md 重资产（Obsidian 作为视图而非系统），粘合原则"记忆存事实与指针、资产存文件本体"，inbox 流水线实现自动整理；里程碑定序 M2 资产协议先于 M3 cron（cron 首批任务作用于资产层）。
