# 批准后执行与验证

只有 Phase 1-3 完成、用户明确批准具体动作后才进入本文件。每条命令先 `--dry-run`(若支持),核对输出后再执行。

## 0. 批准账本

先把计划逐行写成:

`source | target | action | exact command | overwrite? | backup | rollback | approved?`

任何 `overwrite` / `archive` / `remove` / `harness config merge` 都单独一行。用户批准后出现的新动作,重新询问。

## 1. 预检

1. 确认 `jspace --version` 可执行;调用方没有则停止,先走 `jspace-use` 的安装/首配指引。
2. 确认目标不是既有 JSpace;若是,转到 `jspace workspace upgrade`。
3. 再次记录目标树和 hash 快照;确认没有未授权的外部路径。
4. 确认旧 registry、filehub、skills、harness 配置的备份位置可写且不在待迁移工作台内。

## 2. 旧 registry 的备份与翻译

若根 `hub.json` / `.jspace.json` 存在:

1. 先把原文件复制/移动到明确的外部备份目录(例如 `<target>.jspace-adopt-backup-<timestamp>/`),**不删除**;
2. 展示旧字段到新 hub/local 的逐项映射;
3. 获得批准后移除目标根的旧残留,让 init 不再被 legacy guard 拒绝;
4. init 后再用 CLI 逐项重建 domain/resource/project。

不要直接把旧 `hub.json` 当新 `.jspace/hub.json` 使用;schema 不同。不要保留双 registry。

## 3. 初始化与安装

```bash
# 在目标项目根执行; --force 只负责非空目录,不代替备份
jspace init --dir <target> --force

# 官方 + machine-global skills;默认填缺不覆盖本地编辑
jspace skills install --dry-run
jspace skills install
```

`init --force` 只为碰撞的模板文件写 `.jspace-bak`,不会替你备份任意用户文件;旧 registry、filehub 内容、用户 skills 仍按批准账本单独保护。

**碰撞归并是本阶段门禁**,不是收尾项:

```bash
find <target> -name '*.jspace-bak' -print
```

- `AGENTS.md`:确认 JSPACE 块已嵌入且块外原文仍在;若内容语义被改变,停下 `manual`。
- `CLAUDE.md`:若 init 用 `@AGENTS.md` stub 覆盖了用户原文,保留 `@AGENTS.md`,再把 `.jspace-bak` 原文按用户批准的方式合回 `CLAUDE.md`;这是手动合并,不能直接盲拼。
- harness settings / hooks / README / `.gitignore`:逐项按用户内容保留策略 merge 或 restore;未知语义保持 `manual`。
- 所有备份保留到验证通过;不要因为文件已生成就删除 `.jspace-bak`。

只有全部碰撞项已 `preserve` / 已合并 / 明确 `manual`,才能继续。

## 4. Filehub

已有 filehub **原地注册**,不换根:

```bash
jspace filehub init <existing-filehub-root> --register --domain <domain> --dir <target> --dry-run
jspace filehub init <existing-filehub-root> --register --domain <domain> --dir <target>
```

`filehub init` 只补骨架目录,已有 `README.md` 不覆盖;注册后核对 hub 的 `resource(type=filehub)` 与 `local.bindings`。若旧 `README.md` 与新结构冲突,列 `manual`,不要覆盖。

资料本体的整理、改名、写入 asset pointer 页交给 `asset-ingest`;本 skill 不搬运重资产。

## 5. Domains / resources / projects

按映射逐个登记,先 dry-run:

```bash
jspace domain list --dir <target>
jspace domain add <domain-id> --dir <target> --dry-run
jspace resource add <resource-id> --domain <domain-id> --type <type> --path <absolute-path> --dir <target> --dry-run
jspace project add <ascii-project-id> --domain <domain-id> --asset-rel-path projects/<human-name> --dir <target> --dry-run
```

执行后删除 `--dry-run`。路径必须经 `local.bindings` 绑定;portable `hub.json` 里不得出现绝对路径。已有项目中文资产目录保留,project id 使用 ASCII;已有 gbrain slug 不改名。

## 6. Harness

只处理用户实际使用的 harness,一次一个:

```bash
jspace harness wire --harness <claude|grok|opencode|cursor|pi> --dir <target> --dry-run
jspace harness wire --harness <claude|grok|opencode|cursor|pi> --dir <target>
```

该命令负责 merge + backup 与 `GBRAIN_SKILLS_DIR` 注入;不丢弃非 gbrain 项,不手改用户 MCP 配置。Codex 的 cron 兼容项不传给 `harness wire`。机器级统一治理/全 harness 接线交给 `harness-config`。

## 7. Cron

先列出旧任务、schedule、harness、prompt/target 和启用状态。只有以下条件全部满足才迁移:

- 语义与现有 JSpace cron 契约逐项等价;
- 旧调度器项能确认由该任务管理,不会与系统任务重复;
- 用户单独批准 enable / install。

官方周期任务优先把契约放 skill,target 结构使用 `{"kind":"skill",...}`;内联 prompt 不确定时保持 `manual`,不要猜。系统 scheduler 的替换/停用属于独立破坏性动作,不与文件迁移打包批准。

## 8. 升级核对

```bash
jspace workspace upgrade --dir <target> --dry-run
jspace workspace upgrade --dir <target>
```

dry-run 必须显示所有冲突;不要为省事直接 `--accept-conflicts`。若用户必须覆盖本地修改,逐项确认后再用该参数,并记录 rollback id。

## 9. 验证矩阵

| 面 | 命令/证据 | 通过标准 |
|---|---|---|
| 全局健康 | `jspace doctor --dir <target>` | 无 error;warning 已解释 |
| registry | `jspace domain list` / `resource list` / `project list` | 每个旧项有对应或明确 `manual` |
| binding | 检查 `.jspace/local.json` 与 hub binding | 路径仅在本机 state;恰好一个 primary |
| filehub | 原 root 与 `index.md`/README 仍在 | 内容未丢;`type=filehub` 可解析 |
| skills | `jspace skills install --dry-run`;检查 `.jspace/skills` 与投影 | 官方 skill 可达;用户 skill 保留 |
| harness | `jspace harness init --harness <名> --dir <target>`;dry-run wire | 投影存在;配置 merge/backup 正确 |
| gbrain | `gbrain get <old-slug>` 或 `gbrain query <关键词>` | 旧 slug 仍命中;未重命名 |
| 只读阶段 | 迁移前/盘点后 hash 对比 | Phase 1-2 无副作用 |
| 用户内容 | 逐项对比批准账本 | 自定义 skill、AGENTS/CLAUDE 块外、filehub 文件均在 |

## 10. 失败恢复

- `init` 前失败:停止,保留旧文件和备份,不继续。
- `init` 后失败:报告已完成步骤;优先重跑幂等 CLI,不要手工拼状态。
- upgrade 失败:使用输出的 rollback id 或 `.jspace-bak` 恢复;恢复后再 doctor。
- harness wire 失败:保留已有配置与备份;不手删未知字段。
- 无法验证旧 gbrain slug:标 `blocked`,不宣称迁移完成。

**完成标准**:用户能在一个新会话中从工作台入口路由、召回旧记忆、找到原 filehub;未完成项有明确 owner 与下一步。
