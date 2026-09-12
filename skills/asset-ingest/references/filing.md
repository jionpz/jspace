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

## 归档两步:先定归属,再定处理方式

**归属与格式是两件独立的事。先回答"属谁",再回答"怎么处理"。格式永远不进目录名。**

### 第一步:归属(唯一决定目录的一步)

按**工作关系**判定,不看文件格式:

| 这份资料…… | 归到 | 目录细节 |
|---|---|---|
| 明确服务某个项目(进行中或已交付) | `projects/<项目>/` | 读该项目 `index.md` 的 `layout`,决定放项目根还是稳定工作流/周期子目录 |
| 多个项目共用、或长期不随项目结项(书籍 / 行业资料 / 领域参考) | `areas/<领域>/<稳定主题>/` | 按稳定主题组织;不用格式词做主题名 |
| 已结项 / 不再活跃的冷资料 | `archive/<年>/` | |
| 拿不准 | — | **问用户,不猜** |

同一份资料只有一个规范位置;跨项目引用用链接,不复制。

### 第二步:处理方式(只影响摘要深度,不影响目录)

| 格式 | 处理方式 |
|---|---|
| pdf / txt / md | 先摘要 + 指针,按需加深 |
| excel / ppt | 常规:摘要 + 指针;用户要求时深度抽取(逐表/逐页 → 伴生 `.extract.md` + 页内 Key Facts 含关键数字),见 `~/.agents/skills/asset-ingest/references/deep-extract.md` |
| 视频 / 音频 / 截图 | 路由到 gbrain `media-ingest` 深入路径;MVP 范围外 |

### 保留目录名

`docs`、`decks`、`data`、`notes` 四个裸名字在 filehub 内**一律不得作为目录名**——它们描述文件形态,不描述归属或稳定阶段,正是"同一份资料说不清该放哪"的来源。类型写进项目 `index.md` 的类型列与 gbrain,不写进路径。`jspace doctor` 的 `filehub.legacy_taxonomy` 检测它们,迁移流程见 `migration.md`。

> 例:项目合同若是 pdf —— **归属**判定为"服务 acme 项目" → `projects/acme/合同/`;**格式**只决定它要不要深度抽取。格式不参与选目录。

## 目录结构(GOAL.md 资产协议)

```
filehub/
  _inbox/           # 新资料先落这里(M2 后)
  projects/<项目>/  # index.md + flat 文件,或单一稳定组织轴下的子目录
  areas/<领域>/     # 长期领域资料,按稳定主题组织
  archive/<年>/     # 结项/冷资料
```

### 投放口常驻文件与豁免标记

`_inbox/`(及降级暂存区,同一职责的两处实现)顶层的以下条目是**结构、不是待归位载荷**:不计入 unfiled 计数(`inbox status` / `doctor` / context hook 同口径),批量整理一律跳过:

- 常驻契约文件:`README.md`(投放口说明)与 `AGENTS.md`;
- 带 `.skip-inbox-tidy` 标记的目录:目录及其内容整体豁免(例如自带 `_catalog.json` / `_manifest.jsonl` 的长期学习资料夹)。按目录打标记,可移植,CLI 不做目录白名单。

豁免目录里的文件不会被自动归位;要整理它,先删掉标记再走正常流程。

### 项目目录:归属/阶段唯一轴,不按文件格式

项目 `index.md` 的 frontmatter 必须声明一种 `layout`:

- `flat`:文件较少,直接放项目根。
- `workstream`:按稳定工作流/阶段分组,如 `kickoff/`、`delivery/`、`合同/`。
- `period`:按稳定周期分组,如 `2026-Q3/`。

规则:

1. **先读项目 `index.md` 的 `layout`**,不得每轮另发明分类轴。
2. 同一层级只能使用一种组织轴,不得混用工作流、周期或文件格式。
3. 不为单个文件机械建目录;只有稳定同类集合形成、或直接子项过多影响浏览时才建目录。
4. **禁止** `docs`、`decks`、`data`、`notes` 等文件形态目录。类型写入 index,不写进路径。
5. 一个文件只有一个规范位置;跨项目引用用链接,不复制。
6. 已有旧式格式目录不自然获得合法性:只按原位置增量接收会持续制造漂移;先按 migration.md 的显式迁移流程处理,或明确保留为待迁移区,不再新增格式目录。

**示例(同一项目只能选用一种组织方式)**

```
# 方式 A:workstream(稳定工作流/阶段)
projects/acme/
  index.md              # layout: workstream
  kickoff/
    2026-08-01-kickoff-v1.pptx
  合同/
    2026-08-01-服务合同-v1.pdf
  delivery/
    2026-08-10-需求文档-v2.pdf

# 方式 B:period(长跑项目按周期)
projects/acme/
  index.md              # layout: period
  2026-Q3/
    2026-08-01-kickoff-v1.pptx
    2026-08-03-报价单-v1.xlsx
  2026-Q4/
    2026-10-01-中期汇报-v1.pptx

# 方式 C:flat(文件少)
projects/acme/
  index.md              # layout: flat
  2026-08-01-kickoff-v1.pptx
  2026-08-03-报价单-v1.xlsx
```

`profile/filing-prefs` 只能帮助选择 `flat` / `workstream` / `period` 或具体稳定主题,不能恢复格式目录。

### 归位偏好学习(消除反复猜错)

AI 归位文件被用户纠正时,**必须**把纠正写成 gbrain `profile/filing-prefs` 页(覆盖),下次归位前先读这一页:

```bash
gbrain get profile/filing-prefs   # 归位前先读(如存在)
```

写页内容示例:
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
- acme 项目:layout: workstream;周报放 周报/,合同放 合同/,交付物放 delivery/
- wms 项目:layout: period;按季度分目录(2026-Q3/ 等)
```

偏好只覆盖单一组织轴内的选择;若与"禁止格式目录"冲突,以 filehub 根 README 的归档契约为准。

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

- `projects/<项目>/index.md` 必须在 frontmatter 声明 `layout: flat | workstream | period`。
- 每份归位文件必须登记一行:文件 + 类型 + 日期 + gbrain slug(人机共用的 dashboard)。
- `areas/` 是否维护 index 由真实使用涌现,但同样禁止按文件格式分目录。
