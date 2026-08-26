# Design — skill 导航质量：~/.agents/skills 统一物化 + 全引用统一前缀

> 需求见 `prd.md`（方案 A 已拍板：用户只用 Claude/Grok/Pi/OpenCode 多 harness，
> `~/.agents/` 是用户级一致位置，不依赖任何 harness 特有变量）。

## 1. 方案 A 的本质

官方 skill 增加一处**用户级物化**：`~/.agents/skills/<name>/`（与 harness-config 的 global
物化同位置，统一成「JSpace 官方 skill 的用户级位置」）。SKILL.md 与 references 内**所有**
文件引用统一写 `` `~/.agents/skills/<skill>/...` ``。

```
skills/<name>/              仓库源（gen-assets 嵌入 ASSETS）
  ├─ .jspace/skills/<name>/  工作台物化（init/upgrade）
  ├─ .claude/skills/<name>/  Claude 投影（A 任务，SKILL_PROJECTIONS）
  └─ ~/.agents/skills/<name>/  用户级统一位置（本任务，新）
```

引用指向 `~/.agents/skills/<name>/` —— `~` 每机解析到各自 home，机器无关、所有 harness
（Claude/Grok/Pi/OpenCode）都能 Read 用户级绝对路径。不再区分同/跨 skill。

## 2. 物化命令 `jspace skills install`

参考 harness-config 的 `rsync --ignore-existing` 幂等自装，但用 JSpace 自己的 ASSETS
（嵌入式内容，不依赖仓库检出）。

### 2.1 物化源与目标

- 源：`ASSETS` 里 `skills/<name>/` 前缀的所有 key（与 `materializeTree` 同源，避免第三份映射）
- 目标：`~/.agents/skills/<name>/`（`expandTilde("~/.agents")` 展开）
- 排除：`__pycache__/`（asset-ingest 运行时产物；与 gen-assets `SKIP_DIRS` 一致）、点文件

### 2.2 幂等与刷新

- 目标文件已存在且字节 == ASSETS 内容 → `skip`（不覆盖，尊重本地改动？——**决策**：用户级
  物化是机器级统一副本，本地改动不该保留？看 harness-config 用 `--ignore-existing` 是
  **保留本地改动**。对齐：**补缺不覆盖**，本地改动保留，与 harness-config 语义一致）
- 缺失 → `create`；已有但内容不同 → 保留本地（`skip`），不静默覆盖
- 重复执行 → 全部 skip，报 `already installed`（幂等）

### 2.3 命令形态

```bash
jspace skills install [--dir <workbench>]   # 把官方 skill 物化到 ~/.agents/skills/
```

- 默认物化 skills-manifest 的 workbench 4 skill
- 不需要 --dir（用户级，非工作台操作）；保留 dir 以便验证时指向 fixture 工作台
- `--dry-run`：列出将 create/skip，不写

## 3. 引用重写

### 3.1 统一规则

| 现状形态 | 数量 | 新写法 |
|---|---|---|
| `` `references/x.md` ``（SKILL.md 内，同 skill） | ~55 | `` `~/.agents/skills/<self>/references/x.md` `` |
| `` `references/x.md` ``（references 内，同 skill） | ~12 | 同上 |
| `` `../<skill>/references/x.md` ``（跨 skill） | ~9 | `` `~/.agents/skills/<skill>/references/x.md` `` |
| `` `../<skill>/SKILL.md` ``（跨 skill） | ~3 | `` `~/.agents/skills/<skill>/SKILL.md` `` |
| `` `../SKILL.md` ``（references 内，回自己根） | ~2 | `` `~/.agents/skills/<self>/SKILL.md` `` |

**排除**：`../<workbench>-inbox/` 这类是**路径描述**（asset-ingest 的降级暂存区说明），
非文件引用，不改。

### 3.2 各 skill 的具体映射（含 harness-config）

- **jspace-use**：`references/example-first-use.md` 等 6 个 → `~/.agents/skills/jspace-use/references/...`；
  `../asset-ingest/references/gbrain-write.md` → `~/.agents/skills/asset-ingest/references/gbrain-write.md`
- **asset-ingest**：7 个 references → `~/.agents/skills/asset-ingest/references/...`（无跨 skill）
- **memory-recall**：3 个 references + `../asset-ingest/references/gbrain-write.md` +
  `../SKILL.md`（references 内指回自己）
- **memory-writeback**：2 个 references + `../jspace-use/references/gbrain.md`×4 +
  `../asset-ingest/SKILL.md`×3 + `../SKILL.md`
- **harness-config**（global，装 `~/.agents/skills/harness-config`）：2 个 references →
  `~/.agents/skills/harness-config/references/...`（天然一致）

## 4. check-skills C1 更新

现状正则匹配 `` `references/x.md` `` / `` `../<skill>/references/x.md` `` 并校验
repo `skills/<dir>/...` 存在。

新正则：匹配 `` `~/.agents/skills/<name>/<rest>` ``，校验 repo `skills/<name>/<rest>` 存在。
同时保留旧正则（防止漏改残留——**新正则 + 旧正则都查**，旧形态命中即 fail 提示改新）。

```ts
// 新：~/.agents/skills/<name>/references/x.md -> skills/<name>/references/x.md
const NEW_REF = /`~\/\.agents\/skills\/([\w-]+)\/([\w\/.-]+)`/;
// 旧：references/x.md | ../<skill>/references/x.md | ../<skill>/SKILL.md
const OLD_REF = /`(references\/[\w-]+\.md|\.\.\/[\w-]+\/(?:references\/)?[\w-]+\.md|\.\.\/SKILL\.md)`/;
```

- 新引用命中 → 解析 `skills/<name>/<rest>` 校验存在（对每个 skill 文件扫描，rest 相对该 skill 根）
- 旧引用命中 → **fail**（必须改新，残留 = AC2 违反）

## 5. 与既有投影的关系

| 位置 | 所有权 | 刷新 | 用途 |
|---|---|---|---|
| `.jspace/skills/` | seed（manifest） | upgrade | 工作台内 harness 无关源 |
| `.claude/skills/` | seed（manifest，SKILL_PROJECTIONS） | upgrade | Claude 专用发现 |
| `~/.agents/skills/` | machine（本任务命令） | `jspace skills install` | 多 harness 统一导航 |

`~/.agents/skills/` 不走 manifest（不随工作台 upgrade），由显式命令管理（同 harness-config）。
引用指向它是因为它是**用户级唯一稳定位置**——工作台可多处/可重建，`~/.agents` 每机固定。

## 6. 验证

- 单测：`install` 幂等（create/skip）、`__pycache__` 排除、引用重写后 C1 通过
- 端到端：`jspace skills install` → `~/.agents/skills/<name>/` 4 skill 齐 → grep 无旧引用
  → `check-skills` 过
- 真实会话：`workspace/<domain>/` 启动 claude → 问 skill 里 references 引用能否解析
- PUBLIC：`~` 是机器无关占位，测试用 tmp HOME 注入

## 7. 影响面与回滚

- 新增 `cli/commands/skills.ts`（`skills install`）+ `application/skills/install.ts` 纯逻辑
- 全仓库 ~80 处引用重写（seed 文件，随升级刷新）
- `check-skills.ts` C1 更新
- 回滚：引用改动 git checkout；物化命令删 `~/.agents/skills/<name>/` 即回退

## 8. 风险

- `~` 在 SKILL.md 里是字面量，agent 读到后需自行展开（Claude 的 Read/Glob 支持 `~`；
   GPD 等 harness 大多也支持）。相比 `${CLAUDE_SKILL_DIR}` 的自动替换，`~` 需 agent 理解——
  但它是 shell 通用约定，多 harness 下是「一致优于自动」的取舍（已拍板）。
- 物化与工作台解耦：工作台 upgrade 不刷新 `~/.agents/skills/`，需用户跑 `skills install`
  （对齐 harness-config 的显式自装语义）。
