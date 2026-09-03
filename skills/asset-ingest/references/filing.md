# asset-ingest — 归位规则(filing)

## 文件中心定位

- 文件中心 = `.jspace/hub.json` 中 `type: filehub` 的 resource;取 `primary: true` 的 path entrypoint 作为根(`filehub/`)。
- 未注册该约定 type/id → 走降级暂存区(见下)。
- 该约定直接服务 M2(M2 按此注册文件中心)。

## 命名

`YYYY-MM-DD-语义名-vN.ext`(GOAL.md 规范)

- `YYYY-MM-DD`:入库日期(机器可排序)
- `语义名`:可扫读短名(中文或 kebab-case)
- `-vN`:版本号,同语义资料二版起递增(重名去重的机制)

## 类型策略

| 类型 | 归位目标 | 说明 |
|---|---|---|
| pdf/txt/md 书籍、资料 | `areas/<领域>/` | 先摘要+指针,按需加深 |
| excel / ppt | `projects/<项目>/` 或 `areas/<领域>/` | 常规:摘要+指针;用户要求时深度抽取(逐表/逐页 → 伴生 `.extract.md` + 页内 Key Facts 含关键数字),见 `~/.agents/skills/asset-ingest/references/deep-extract.md` |
| 项目产出(报告/文档/资料) | `projects/<项目>/` 或其子目录 | AI 根据上下文自主决定放置位置(见下),`-vN` 管理版本 |
| 视频/音频/截图 | — | 路由到 gbrain `media-ingest` 深入路径;MVP 范围外 |

## 目录结构(GOAL.md 资产协议)

```
filehub/
  _inbox/           # 新资料先落这里(M2 后)
  projects/<项目>/  # index.md + AI 自主组织的目录结构
  areas/<领域>/     # 长期领域资料
  archive/<年>/     # 结项/冷资料
```

### 项目目录:AI 自主组织,不预设分类

**不预设固定子目录**(如 docs/decks/data/notes)——实际长期使用中资料常跨类别,预设分类会"放哪都不对"。也**不强制全部扁平**——文件多了一样找不到东西。

AI 在归位时**自主决定**目录结构,依据(按优先级)：

1. **归位偏好**(`profile/filing-prefs`,见下节)——用户积累的显式规则,最高优先
2. **已有目录结构**——`ls` 项目目录,观察现有的组织方式,延续而非打破
3. **文件内容与上下文**——读文件内容,结合项目 state(gbrain)和会话上下文判断这份资料在项目中的角色
4. **项目 index.md**——看已登记的文件是怎么组织的

**硬约束(只有这些)**:
- 命名必须 `YYYY-MM-DD-语义名-vN.ext`(机器可排序、人可扫读)
- 每份归位文件必须在 `index.md` 登记一行
- 项目根下只有 `index.md`,其余文件应在子目录中(哪怕只有一个子目录)
- 子目录命名应能让人一眼理解内容(中文或英文均可,如 `周报/`、`合同/`、`客户沟通/`)

**示例:同一项目,不同组织方式都是合理的**

```
# 方式 A:按资料用途(每周汇报多的项目自然涌现)
projects/acme/
  index.md
  周报/
    2026-08-07-周报-v1.pptx
    2026-08-14-周报-v1.pptx
  合同/
    2026-08-01-服务合同-v1.pdf
  交付物/
    2026-08-10-需求文档-v2.pdf

# 方式 B:按时间段(长跑项目自然涌现)
projects/acme/
  index.md
  2026-Q3/
    2026-08-01-kickoff-v1.pptx
    2026-08-03-报价单-v1.xlsx
  2026-Q4/
    2026-10-01-中期汇报-v1.pptx

# 方式 C:文件少,保持扁平
projects/acme/
  index.md
  2026-08-01-kickoff-v1.pptx
  2026-08-03-报价单-v1.xlsx
```

关键是:**AI 看到已有结构后延续它,而不是每次发明新分类**。`profile/filing-prefs` 让用户可以固化"这个项目我想这样组织"。

### 归位偏好学习(消除反复猜错)

AI 归位文件被用户纠正时，**必须**把纠正写成 gbrain `profile/filing-prefs` 页（覆盖），下次归位前先读这一页：

```bash
gbrain get profile/filing-prefs   # 归位前先读(如存在)
```

写页内容示例：
```markdown
---
type: note
tags: [profile]
---
# 归位偏好

## 全局规则
- 客户来的资料一律归 projects/<对应项目>/,不放 areas/
- 书籍类资料归 areas/books/,用中文语义名
- 多个项目共用的行业报告放 areas/<行业>/

## 项目专属规则
- acme 项目:周报放 周报/ 子目录;合同放 合同/;其余放项目根
- wms 项目:按季度分目录(2026-Q3/ 等)
```

这样 AI 的归位准确度随使用提升，而不是每次从零猜。每个项目可以有自己的组织方式，用户纠正一次，以后同类文件都会遵循。

## 降级暂存区(文件中心未注册时)

- **位置**:工作台同级、不进 git 的 `../<workbench>-inbox/`,或用户指定目录。
- **不得**在工作台 git 目录内建 `_inbox/`(工作台是 git 同步的控制平面,重资产不入 git)。
- 首次使用自动创建,并提示"待文件中心注册为 type=filehub 后正式归位"。
- `filehub/_inbox/`(M2 后)与降级暂存区是同一职责的两处实现。
- **迁移(M2 起)**:注册 filehub(`jspace filehub init <根> --register` 或 `resource add --type filehub`)后,把暂存区文件并入正式 `_inbox/`:
  1. 人工把暂存区文件移动到 `<filehub>/_inbox/`(或用户指定目录);
  2. 再走 asset-ingest 归位(会话内「整理一下 inbox」)。
  - 不自动批量迁移(存量收编增量策略);M2 之后新资料一律先落 `filehub/_inbox/`。

## 查重

- 入库前检查:目标目录同名/同语义文件、`gbrain get assets/<项目|领域>/<语义名>` 是否已存在。
- 已存在 → 询问用户:跳过 / **修复**(同名同内容重入,允许覆盖错页)/ 升版本(`-vN`,写新页、旧页保留并注 supersedes)。

## 项目 index.md

- `projects/<项目>/index.md` 登记一行:文件名 + 日期 + gbrain slug(人机共用的 dashboard)。
- `areas/` 是否维护 index 由真实使用涌现,不预先设计。
