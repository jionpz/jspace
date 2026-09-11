---
name: jspace-adopt
description: "**非破坏收编旧项目**为 JSpace 工作台:只读盘点已有 skills、harness 投影、filehub、registry 与 gbrain 痕迹,生成映射并经用户批准后调用现有 jspace CLI 执行。Use when 老项目迁移成 JSpace、legacy adoption、已有 skill/filehub 迁移、把旧目录 init --force。Do NOT use for 单纯资料入库(→asset-ingest)、已是 JSpace 的工作台升级(→workspace upgrade)或机器级 harness 治理(→harness-config)。"
triggers:
  - "legacy adoption"
  - "adopt legacy project"
  - "migrate legacy skills"
  - "migrate filehub"
  - "老项目迁移"
  - "旧项目收编"
  - "已有 skill 迁移"
  - "filehub 迁移"
  - "init --force"
---

# jspace-adopt — 旧项目收编为 JSpace

把已经有 skills、harness 配置、filehub 目录或旧 registry 痕迹的项目收编为标准 JSpace 工作台。**先盘点、再映射、批准后执行、最后验证**;迁移是多个可回滚动作,不是“清空重建”。

## 何时用 / 何时不用

- ✅ 用:旧项目还没有 `.jspace/marker.json`,但已有用户 skills / 各 harness 投影 / filehub / 根 `hub.json` / gbrain 页面 / cron 痕迹,需要纳入 JSpace。
- ❌ 不用:只是把文件资料归位 → `asset-ingest`;工作台已经初始化,只需升级 → `jspace workspace upgrade`;配置机器级全局治理 → `harness-config`;日常工作台操作 → `jspace-use`。
- **边界**:本 skill 负责“结构 adoption”;资料本体迁移交给 `asset-ingest`,全局 harness 单源治理交给 `harness-config`。不要在这里重写 ingest、registry、scheduler 或 harness merge 逻辑。

## 硬门禁

1. **盘点/dry-run 只读**:Phase 1-2 不写文件、不移动、不删除、不改配置、不跑 scheduler。
2. **先批准后执行**:Phase 4 的每个 `adopt` / `translate` / `archive` 动作都要有用户明确批准;`preserve` / `register` 也先展示将写路径。没有批准就停在计划。
3. **默认不搬家且保留用户内容**:已有 filehub 原地注册;用户 root `skills/`、AGENTS/CLAUDE 块外内容、harness 自有配置与 gbrain slug 不改名不覆盖。`init --force` 产生的每个 `.jspace-bak` 都要在继续前归并或列入 `manual`,备份未核对前不得说迁移完成。
4. **只调现有 CLI**:优先 `jspace init --force` / `filehub init --register` / `domain|resource|project add` / `skills install` / `harness wire` / `workspace upgrade`。CLI 已实现的备份、合并、journal、rollback 不在 skill 里重做。
5. **失败可续**:任何失败都停在该阶段,报上一条成功命令、备份位置和下一步;不假装成功,不进入更危险动作。

## 五阶段

### 1. Guardrails + 只读盘点

先确认目标根、用户意图和 dry-run 边界,再按 `~/.agents/skills/jspace-adopt/references/inventory.md` 盘点:

- 项目根形态与既有 `AGENTS.md` / `CLAUDE.md` 指令;
- 用户 skills、官方同名 skills、各 harness 投影及 symlink 可达性;
- 旧 `hub.json` / `.jspace.json` / `.jspace/` marker / `local` / cron;
- filehub 候选根、嵌套关系、`README.md` / `index.md`;
- gbrain 已有 slug 与可召回入口;
- harness 项目级与用户级配置。

区分“文件存在”和“实际可用”;不跟随未知 symlink,不回显密钥。把盘点结果写成事实表,不要边看边改。

### 2. 映射与冲突清单

按 `~/.agents/skills/jspace-adopt/references/migration-map.md` 给每一项分类:

`preserve` / `adopt` / `register` / `link` / `translate` / `archive` / `manual` / `blocked`

输出至少包含:源路径、目标位置、动作、命令、冲突、批准级别、回滚。同名不同内容、filehub 根歧义、旧 slug 重命名、移动/删除/覆盖一律 `manual` 或 `blocked`,不要猜。

### 3. 用户批准

先展示只读盘点、迁移表和 dry-run 结果,再逐组请求批准。明确列出:

- 将创建/覆盖/备份/移动/删除的文件;
- 已有 filehub 是否原地注册;
- 哪些 skills 保持用户所有权,哪些由 JSpace 管理;
- 哪些旧 cron/harness 项需要手工处理;
- 失败时的恢复入口。

用户只说“批准”时,只执行清单中明确列出的动作;新增破坏性动作必须再次确认。

### 4. 批准后执行

按 `~/.agents/skills/jspace-adopt/references/apply-and-verify.md` 的顺序执行,每步先 dry-run、再执行、再核对:

1. 备份并翻译旧根 registry(如有);
2. `jspace init --force` 初始化工作台,并归并 `.jspace-bak` 碰撞内容;
3. `jspace skills install` 安装全局/官方 skills;
4. 原地 `jspace filehub init <root> --register`;
5. 用 registry CLI 迁移 domain/resource/project;
6. 只对接用户选定的 harness;
7. 处理 cron 仅限已有稳定映射;
8. `workspace upgrade --dry-run` 后再升级。

不要用 `mv` / `rm` 批量搬资产;不要手工拼 `hub.json` 绝对路径;不要覆盖用户文件。

### 5. 验证与交接

调用 `jspace doctor`,并验证 registry binding、filehub 内容、skill 投影、harness wire、gbrain 召回。完整矩阵与失败恢复见 `~/.agents/skills/jspace-adopt/references/apply-and-verify.md`。

验证完成后明确交接:

- 资料本体继续归位 → `asset-ingest`;
- 工作台日常操作/诊断 → `jspace-use`;
- 机器级多 harness 单源治理 → `harness-config`;
- 已是 JSpace 后的模板升级 → `jspace workspace upgrade`。

## Golden run

用 `/tmp` 下的去敏 fixture 演练“盘点 → 计划 → 批准 → 执行 → 验证”,不触碰真实 HOME、scheduler、gbrain store 或 filehub:见 `~/.agents/skills/jspace-adopt/references/example-legacy-adoption.md`。

## 参考

- `~/.agents/skills/jspace-adopt/references/inventory.md` — 只读盘点矩阵与证据格式
- `~/.agents/skills/jspace-adopt/references/migration-map.md` — 旧结构到 JSpace 的映射、冲突与所有权规则
- `~/.agents/skills/jspace-adopt/references/apply-and-verify.md` — 批准后执行顺序、验证矩阵与恢复
- `~/.agents/skills/jspace-adopt/references/example-legacy-adoption.md` — 临时 fixture golden run
