---
name: jspace-adopt
description: "把已有 skills、harness 投影、filehub 或 registry 痕迹的旧项目非破坏收编为 JSpace 工作台:只读盘点、映射、批准后调用现有 CLI、验证与恢复。Use when 老项目迁移/legacy adoption/旧目录 init --force。Do NOT use for 单份资料入库(→asset-ingest)、已是工作台的升级(→workspace upgrade)或机器级 harness 治理(→harness-config)。"
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

# jspace-adopt - 旧项目收编

把已有项目接入 JSpace,同时保留用户内容、原 filehub 和已有记忆。先盘点,再映射,批准后执行,最后用证据验收。

## 触发 / 非目标

- 用:项目没有 `.jspace/marker.json`,但已有用户 skills、各 harness 投影、filehub、旧 `hub.json`、gbrain 页或 cron 痕迹。
- 不用:已是 JSpace 的普通升级 → `jspace workspace upgrade`;单份资料归位 → `asset-ingest`;机器级全局治理 → `harness-config`。
- 本 skill 不重写 ingest、registry、scheduler 或 harness merge;只编排现有 CLI。

## 输入与前置

- 明确项目根、目标工作台根和用户希望保留的配置。
- 旧项目 `AGENTS.md` / `CLAUDE.md`、skills、harness 投影、hub/registry、filehub 和 gbrain 痕迹可只读访问。
- 每个破坏性动作都有用户批准;未提供批准时停在计划。

## 权威引用

- 本 skill 内引用一律以 skill 根为基准(`$SKILL_DIR` 指本 skill 目录);跨 skill 用 `../<skill>/...`。
- 只读盘点矩阵:`references/inventory.md`
- 映射、冲突与所有权:`references/migration-map.md`
- 执行、验证与恢复:`references/apply-and-verify.md`
- 临时 fixture golden run:`references/example-legacy-adoption.md`

## 写集

- 目标工作台 `.jspace/`、根入口、备份和 adoption journal。
- `jspace init --force` 产生或合并的受管文件与 `.jspace-bak`。
- 用户批准后的 registry、filehub 注册、harness 项目级接线和 cron 迁移。
- 不写:用户根治理文档、旧 filehub 本体、未批准的用户 skill、旧 gbrain slug 重命名。

## 输出

| 项 | 内容 |
|---|---|
| 盘点 | 源路径、类型、可用性、所有权、证据 |
| 映射 | preserve / adopt / register / link / translate / archive / manual / blocked |
| 批准 | 每个动作的写路径、备份、回滚、确认 |
| 执行 | 命令、退出码、实际变化、冲突 |
| 验收 | doctor、registry、filehub、skills、harness、gbrain 召回 |

## 主流程

1. **只读盘点**:记录项目根、指令文件、skills、harness 投影、hub/marker/local/cron、filehub 候选和 gbrain 入口。区分“存在”和“可用”。
2. **生成映射**:每项给出动作、命令、冲突、批准级别和回滚。同名不同内容、根歧义、重命名、覆盖和删除一律 manual/blocked。
3. **展示并批准**:列出将创建、覆盖、备份、移动和删除的对象;用户只批准清单中的动作。
4. **执行**:先 dry-run,再调用现有 CLI:
   - 备份/翻译旧 registry;
   - `jspace init --force` 并归并碰撞;
   - `jspace skills install`;
   - 原地 `jspace filehub init <root> --register`;
   - domain/resource/project 迁移;
   - 用户选定 harness 接线;
   - 已验证的 cron 映射;
   - `jspace workspace upgrade --dry-run` → 应用。
5. **验证**:`jspace doctor`、registry binding、filehub/index/指针、skill 投影、harness 接线和一次真实召回。
6. **交接**:资料归位、日常操作、全局治理和后续升级分别转交,不在 adoption 内继续扩张。

## 完成证据

- 盘点项逐项有去向,没有未解释的覆盖/删除;
- 所有用户批准动作与执行日志一一对应;未批准项保持原样;
- `jspace doctor` 通过,registry/filehub 路径可解析;
- 官方 skill 投影指向工作台 SSOT,用户自建 skill 未被改名或删除;
- 至少一次真实 gbrain 召回仍命中原 slug 或明确记录未迁移原因;
- 备份、冲突、manual/blocked 项和恢复命令完整。

## 失败与恢复

- 盘点阶段失败:停止,不写任何文件。
- `init --force` 产生碰撞:先核对每个 `.jspace-bak`,逐项归并或标 manual;未核对前不得继续。
- filehub 根歧义:保留原目录,禁止自动移动;让用户确定 owner 和根。
- skill 同名冲突:官方 managed 名可收敛到 SSOT;非官方同名目录保留并报告 conflict。
- cron/harness 配置不兼容:保留原配置,标 manual,不用模板覆盖。
- gbrain slug 旧命名:默认不改名;只补 rel_path/owner 证据。

## 转交

- 文件本体归位 → `asset-ingest`
- 工作台日常配置与诊断 → `jspace-use`
- 机器级 harness 单源治理 → `harness-config`
- 已是 JSpace 后的升级 → `jspace workspace upgrade`

## 自检

```bash
jspace doctor --dir <workbench>
jspace workspace diff --dir <workbench>
jspace filehub check --dir <workbench> --json
```

没有逐项去向、批准记录和真实召回证据时,只能报 `partial-adoption`,不能宣称迁移完成。
