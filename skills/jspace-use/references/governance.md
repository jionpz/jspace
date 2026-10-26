# 治理细节（域 / 资源 / skill / cron / 项目生命周期）

> 常驻路由与红线在 `AGENTS.md` JSPACE 块；本文只承接**按需读**的细节。工作台 `AGENTS.md` 里「jspace-use 第 8 章」一类引用均指向本文件。
> 页面写入契约（slug / envelope / 来源 tag / pending）以 `gbrain.md` 为唯一权威，本文不复述。

## 1. 域

- **创建信号**（满足 ≥2 条）：跨天/项目/会话复现；有值得跟踪的外部资源；有独立入口/流程/安全规则；需要 AI 专属边界；作为无关资源标签会变吵；用户显式要求从本工作台管理。
- **禁止创建**：一次性操作、单一代码仓库、模糊主题、无管理面的重内容。
- **确定度分级**：高置信 → 直接建并简要说明；中置信 → 问一句；低置信 → 保持一次性或挂已有域。
- **最小形态**：`workspace/<domain>/{README.md, domain.json}`。
- **何时加 `workspace/<domain>/AGENTS.md` 或 `runbook.md`**：重复流程或安全边界需要时。
- **建域同步**：在 `.jspace/hub.json` 加索引；细节进 `workspace/<domain>/domain.json` 与 markdown 文件，不塞进 hub.json。

## 2. 资源

- 资源是域内可发现的入口（项目/仓库/URL/provider/容器/笔记等值得再次找到的对象）。
- schema（entrypoints/binding/primary）与 drift 规则 → `registry.md`，不在此复制。
- 主路径一律经 `local.bindings` 绑定，每项恰好一个 `primary: true`；绝对路径是本机 `local.json` 的真理，`hub.json` 只存引用。

## 3. skill

- **提议信号**（满足 ≥2 条）：代理反复需要同一非显然流程；流程跨多文件/工具/域；需要清晰自动触发规则；没有可复用检查清单代价高；太过程式化不适合根 `AGENTS.md`、又太横切不适合单一域 README；用户显式要可复用 AI 能力。
- **禁区**：一次性笔记、简单域元数据、应进 `AGENTS.md` 的编码约定、大段内容 dump、能清楚放进 `AGENTS.md` 或域 README 的规则。
- **用户确认前置**：根 `skills/` 只放用户自建 skill，创建前必须用户确认。
- **官方 skill 分两种作用域，不可互换**：
  - **workbench**（7 个：`jspace-use` / `asset-ingest` / `memory-recall` / `memory-writeback` / `workbench-retro` / `weekly-report` / `memory-consolidate`）：唯一物理副本在 `.jspace/skills/<name>/`；`.claude/skills/`、`.grok/skills/`、`.opencode/skills/`、`.agents/skills/` 是指向它的**目录软链**。**不进用户级** `~/.agents/skills/`——用户级只有一个名字名额，多工作台必然冲突。
  - **global**（2 个：`harness-config` / `jspace-adopt`）：装到 `~/.agents/skills/<name>`，由 `jspace skills install` 从二进制嵌入资产物化；**不物化进工作台**。
- **同名真实目录 = 过期机器状态**：投影目录里的同名真实目录不算「本地改动要保留」，`jspace workspace upgrade` / `jspace skills install --refresh` 会把它收敛成链接并如实报告（本地改动不被保留）。
- **官方 skill 被改名或删除**时，旧名字由 `application/skills/retired.ts` 的退役名单接管，在 SSOT、投影目录、用户级三处直接删除（含非空目录与悬挂链接）：被删的 skill 不能靠「用户可能改过」活下来，那正是旧契约升级后继续被注入的路径。
- **`jspace update` 只换二进制，不动 skill 层**。升级后每个工作台还要跑一次 `jspace workspace upgrade`（它才会刷新/收敛/清理 skill）。doctor 的 `skills.retired_present`（warning）就是「只 update 过、还没 upgrade」的信号；旧版留在用户级的 workbench 副本由 doctor `skills.user_level_workbench` 提示。
- **skill 文档互相引用以 skill 根为基准**：同 skill 内直写相对文件名，跨 skill 用上一级目录加 skill 名（`../<skill>/...`），与安装位置无关。

## 4. cron

- **session start 契约**：跑 `jspace cron failures`，把未 ack incident、actionable pending 暂存写（`.jspace/state/pending/<id>.APPLY.json`）与各 cron 状态上报用户。旧 `<filehub>/.jspace-logs/*.APPLY.json` 只是 `workspace upgrade` 的显式迁移输入，不是现行路径。
- **定义即代码**：定义在 `.jspace/cron.json`（声明式：schedule + harness + prompt/model），git 同步、应用前 review。
- **契约归 skill，不写内联 prompt**：官方周期任务用 `target: {kind: "skill", skill: <名>, entrypoint: <入口>}`，`input` 只留一句薄引导——契约正文在 SKILL.md（随 `workspace upgrade` 刷新）。**内联长 prompt 会被永久冻结**：`cron.json` 是 user 数据，升级永不覆盖。
- **存量迁移**：老工作台的 `weekly-report` / `memory-consolidate` 若仍是内联 prompt，`jspace doctor` 会报 `cron.inline_prompt_legacy`（info）。改法：把该 cron 的 `prompt` 字段换成上面的 `target` 结构（自定义 cron 不受影响，内联 prompt 是它们的正常形态）。
- **出厂全禁用，开启是显式动作**：模板四个任务都是 `enabled: false`（未接线机器上不该有东西被拉起）。开启序列 = `jspace cron enable <id>` → `jspace cron run --id <id>`（rehearsal）→ `jspace cron install` → `jspace cron status`。**全禁用时 `jspace doctor --verbose` 报 `cron.all_disabled`（info，不是错误）**——它就是「定时层从没启用过」的提示。
- **周任务的窗口边界**：`jspace memory period` 的周期窗口是 `[周一 00:00, 下周一 00:00)`。周日在窗口内运行只能写「截至 observed_through」，会永久漏掉周日深夜。**推荐把三个周任务排在周一凌晨，并让它们取刚结束的那一周**：
  ```bash
  jspace memory period --json --last-complete   # 上一次完整结束的周；周中手动运行仍用默认（当前周）
  ```
  模板默认已按此排布（周一 00:20 / 00:40 / 01:00）。改过 `cron.json` 的老工作台需自行把 schedule 与 input 里的 `--last-complete` 对齐；`cron.json` 是 user 数据，升级不会覆盖。
- **rehearsal gate**：机器侧 `jspace cron install` 前，先 `jspace cron run --id <id>` 各任务一次验证契约。
- **模型是 cron 自己的属性**：`cron add --model <provider/model>` 钉死无头模型，不继承交互会话的默认模型；上游限流时 `claude -p` 是挂起而不是快速失败，别靠加大 `timeoutSec` 解决。
- **运维细节** → `headless-ops.md`（无头代理/账号/配额/失败可见性）。

## 5. 知识路由纪律

只写**有助于未来会话**的持久记录。根 `AGENTS.md` 应含**长期运行规则**，而非临时偏好或一次性任务笔记。分类、slug 与写语义见 `gbrain.md` §5 与 `memory-writeback`。

## 6. 退役与回收

用久了会变脏：僵尸域、失效指针、结项项目、陈旧 state。**所有处置动作必须先问用户**——删域/移文件是破坏性操作，未经确认不执行。

| 对象 | 退役信号 | 处置 | 确认 |
|---|---|---|---|
| 域 | `workspace/<d>/` 长期未更新（≥90 天）且 hub 无活跃资源 | 归档或合并进邻近域；同步从 `.jspace/hub.json` 移除索引 | **必须问** |
| 资源 | primary 路径不存在，且非「任务本就关于缺失路径」 | 修正指针，或从 hub 移除 | **必须问** |
| 项目（filehub） | `projects/<x>/` 长期未动（≥120 天）、`index.md` 标记结项 | 移入 `filehub/archive/<年>/`，更新域 README 挂接 | **必须问** |
| gbrain state 页 | 项目结项后 `project/<x>/state` 不再更新 | 保留（历史记录）；不自动删 | — |

**`jspace doctor` 的体检诊断**：`domain.dormant` / `filehub.project_stale` 按上表阈值报 `info` 级（非 error——它只是提示「看一眼」，mtime 会被 git clone / 网盘同步重写，阈值取保守值防误报）。

大 filehub（项目/文件很多）时 doctor 会**限流保可读**：每类问题只列前 5 个具体项，再多就折成一行带总数的汇总；mtime 新鲜度扫描有总预算，预算用尽时报一条 `filehub.scan_truncated` 说明实际覆盖了 N/M 个项目。看到它就把 `filehub.project_stale` 的计数读作**下界**。

## 7. 项目生命周期（立项 / 结项）

项目横跨三层（资产层本体 / 控制平面挂接 / 记忆层实体），漏一层就会漂移——**最常见的坏味是「filehub 里有项目，域 README 和 registry 都不知道」**，后果是 `weekly-report` 的项目发现源失效。

### 命名约定（先定这个，否则第 ④ 步会卡）

| 面 | 取值 | 例 |
|---|---|---|
| **project id**（机器标识） | ascii slug，`[a-z0-9-]`；用于 gbrain slug、`ingest --owner-id`、registry | `acme-52` |
| **资产目录名**（人读） | 自由，可中文；经 `--asset-rel-path` 绑到 id | `projects/52期体验营/` |

两者由 `jspace project add <id> --asset-rel-path projects/<中文名>` 绑定 —— **不必为了注册把目录改成英文**。

> **存量项目的中文 slug 不迁移**：在本约定确立前建的 gbrain 页保留原样，不要重命名。记忆层是 append-only 的历史，重命名代价大于收益；`memory-recall` 的可复跑验收基线也建立在这些 slug 上。**新项目一律用 ascii id**。

### 立项（三步，第 ④ 步可延后但不该忘）

```bash
# ① 资产层：建项目目录与 dashboard
mkdir -p <filehub>/projects/<项目名> && $EDITOR <filehub>/projects/<项目名>/index.md   # 现状 / 关键文件表 / 下一步
# ② 控制平面：域 README 项目表挂一行（| <项目名> | filehub/projects/<项目名>/ | 进行中 |）
# ③ 记忆层：按 gbrain.md 页 envelope 建起始 state 页（project/<id>/state），写后读回
# ④ registry 注册（稳定 slug、消除 ingest warning）
jspace project add <id> --asset-rel-path projects/<项目名>
```

- ④ 不注册时 `jspace ingest begin --owner-id <x>` 会报 project 未注册的警告（不阻塞，slug 稳定性略降）。
- ③ 的正文起手只需三行：这个项目是什么 / 现在到哪了 / 下一步。别等「想清楚」再写。

### 结项（三步）

```bash
# ① 资产层：移入年度归档
mv <filehub>/projects/<项目名> <filehub>/archive/<年>/
# ② 控制平面：域 README 项目表改状态或删行（指向新路径）
# ③ 记忆层：state 页写结项终态（保留不删——历史记录），CAS 覆盖并读回
```

**移动/删除是破坏性操作，执行前必须问用户**（§6 确认列同款）。

### 与 doctor 体检项的对应

| doctor 诊断 | 含义 | 处置 |
|---|---|---|
| `filehub.project_stale`（info） | `projects/<x>/` ≥120 天未动 | 若已结项 → 走上面「结项」三步 |
| `filehub.inbox_unfiled`（warning） | `_inbox/` 有未归位文件 | → `asset-ingest`（「整理一下 inbox」） |
| `domain.dormant`（info） | 域 ≥90 天未更新且无活跃资源 | → §6 退役表 |
| `registry.project_unlinked`（warning） | registry 有项目但三层未挂接 | 补齐域 README / state / 资产目录 |
