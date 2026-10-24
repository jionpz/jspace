# asset-ingest — 归位规则(filing)

## 文件中心定位

- 文件中心 = `.jspace/hub.json` 中 `type: filehub` 的 resource;取 `primary: true` 的 path entrypoint 作为根(`filehub/`)。
- 未注册该约定 type/id → 走降级暂存区(见下)。
- 该约定直接服务 M2(M2 按此注册文件中心)。

## 命名

建议 `YYYY-MM-DD-语义名-vN.ext`(机器可排序、人可扫读):

- `YYYY-MM-DD`:入库日期(机器可排序)
- `语义名`:可扫读短名(中文或 kebab-case)
- `-vN`:版本号,同语义资料二版起递增(重名去重的机制)

原生制品、上游版本号、工程包内部路径保持原名,不强制改写。

## 归档两步:先定归属,再定处理方式

**归属与格式是两件独立的事。先回答"属谁",再回答"怎么处理"。格式永远不进目录名。**

### 第一步:归属(唯一决定目录的一步)

按**工作关系**判定,不看文件格式:

| 这份资料…… | 归到 | 目录细节 |
|---|---|---|
| 明确服务某个项目(进行中或已交付) | `projects/<项目>/` | 读该项目 `index.md` 的收录范围与现有目录,决定放项目根还是语义子目录 |
| 多个项目共用、或长期不随项目结项(书籍 / 行业资料 / 领域参考) | `areas/<领域>/<稳定主题>/` | 按稳定主题组织;不用格式词做主题名 |
| 已结项 / 不再活跃的冷资料 | `archive/<年>/` | |
| 拿不准 | — | 先补查 owner index、项目规范与相关资产；仍无唯一归属则留原件，报告缺什么，不猜 |

同一份资料只有一个规范位置;跨项目引用用链接,不复制。

### 第二步:处理方式(只影响摘要深度,不影响目录)

| 格式 | 处理方式 |
|---|---|
| pdf / txt / md | 先摘要 + 指针,按需加深 |
| excel / ppt | 常规:摘要 + 指针;用户要求时深度抽取(逐表/逐页 → 伴生 `.extract.md` + 页内 Key Facts 含关键数字),见 `~/.agents/skills/asset-ingest/references/deep-extract.md` |
| 视频 / 音频 / 截图 | 路由到 gbrain `media-ingest` 深入路径;MVP 范围外 |

### 目录名不参与判定

目录按归属和用途起名,不按文件形态起名;但历史目录名(docs、decks、data、notes 一类)
不再被 `jspace doctor` / `filehub check` 判为违规,也不会自动移动。
判断标准是:归属清楚、入口可达、工程套件内部结构保真、登记覆盖完整。
需要整理旧目录时按 `migration.md` 显式处理,可回滚。

> 例:项目合同若是 pdf —— **归属**判定为"服务 acme 项目" → `projects/acme/合同/`;**格式**只决定它要不要深度抽取。格式不参与选目录。

## 目录结构(GOAL.md 资产协议)

```
filehub/
  _inbox/           # 新资料先落这里(M2 后)
  projects/<项目>/  # index.md + 资产,按真实浏览需要局部组织
  areas/<领域>/     # 长期领域资料;必须有 index.md 才能接收入库
  archive/<年>/     # 结项/冷资料
```

### 投放口常驻文件与豁免标记

`_inbox/`(及降级暂存区,同一职责的两处实现)顶层的以下条目是**结构、不是待归位载荷**:不计入 unfiled 计数(`inbox status` / `doctor` / context hook 同口径),批量整理一律跳过:

- 常驻契约文件:`README.md`(投放口说明)与 `AGENTS.md`;
- 带 `.skip-inbox-tidy` 标记的目录:目录及其内容整体豁免(例如自带 `_catalog.json` / `_manifest.jsonl` 的长期学习资料夹)。按目录打标记,可移植,CLI 不做目录白名单。

豁免目录里的文件不会被自动归位;要整理它,先删掉标记再走正常流程。

### 项目目录:先归属,再按真实浏览需要局部组织

项目 `index.md` 必须存在并登记资产;目录形状不再由枚举约束:

1. 文件少时直接放项目根;某一类资料形成稳定集合、或直接子项过多影响浏览时,再建语义子目录。
2. 同一层级只用一种组织轴(工作流/阶段、年份/周期),不要同层混用。
3. 不为单个文件机械建目录。
4. 一个文件只有一个规范位置;跨项目引用用链接,不复制。
5. 完整的工程套件保留内部结构,由 `index.md` 指向其入口;不为了整齐而整包拆散。
6. 旧 `layout: flat | workstream | period` 字段仍可读,作为布局说明,不再是必填声明。

**示例(每层选用一种组织轴;不是强制形状)**

```
# 方式 A:workstream(稳定工作流/阶段)
projects/acme/
  index.md              # 可选:layout: workstream
  kickoff/
    2026-08-01-kickoff-v1.pptx
  合同/
    2026-08-01-服务合同-v1.pdf
  delivery/
    2026-08-10-需求文档-v2.pdf

# 方式 B:period(长跑项目按周期)
projects/acme/
  index.md              # 可选:layout: period
  2026-Q3/
    2026-08-01-kickoff-v1.pptx
    2026-08-03-报价单-v1.xlsx
  2026-Q4/
    2026-10-01-中期汇报-v1.pptx

# 方式 C:flat(文件少)
projects/acme/
  index.md              # 可选:layout: flat
  2026-08-01-kickoff-v1.pptx
  2026-08-03-报价单-v1.xlsx
```

`profile/filing-prefs` 帮助选择具体稳定主题或局部组织方式,不能用来恢复"按文件格式建目录"。

### 归位偏好学习(消除反复猜错)

AI 归位文件被用户纠正时,**必须**把纠正写成 gbrain `profile/filing-prefs` 页(覆盖),下次归位前先读这一页:

```bash
gbrain call get_page '{"slug":"profile/filing-prefs","include_content":true}'
```

写页内容示例:
```markdown
---
type: filing-preferences
tags: [profile]
source: claude
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

- 入库前检查目标目录同名/同语义文件，并用 `gbrain call get_page '{"slug":"assets/<owner>/<语义名>","include_content":true}'` 查页。
- 同内容已存在 → 报告已有位置并跳过，不创建第二份物理副本；`jspace filehub check --json` 的 `filehub.asset.duplicate_content` 可提示跨路径同内容，但它不自动移动或删除文件。
- 同名/同语义但内容不同 → 默认 conflict，不覆盖。只有明确“修订/新版/替代”证据时才写 `-vN` 新 slug / 新页，新页正文声明 `Supersedes: [[old]]`，旧页另做完整页 + revision 的 CAS 生命周期更新。
- 旧页被标记 `status:superseded|deprecated|archived` 后是历史指针，不再参与当前 owner、`rel_path`、index 或重复指针校验；owner index 必须改指现行页，继续指向旧页会被 `filehub check` 报 `filehub.index.page_inactive`。
- 没有覆盖错页这种修复路径；错误页需要新页取代并保留历史。

## 项目 index.md

- `projects/<项目>/index.md` 必须存在并登记资产;旧 `layout` 字段可读,但不再必填。
- 每份归位文件必须登记一行:文件 + 类型 + 日期 + gbrain slug(人机共用的 dashboard)。
- 随项目保存的 Agent 治理、构建配置、运行骨架和模板不是独立资产;在该 index 的
  `support_paths` 中按 owner 相对路径显式声明(文件或稳定目录),例如:
  ```yaml
  support_paths:
    - project-context.md
    - mcp-server/
  ```
  路径必须位于 owner 根内且真实存在;不能把普通资料登记为 support 来绕过 asset 指针,
  也不能用 support 路径隐藏 cross-owner 文件。
- `areas/<id>/index.md` 是入库前置:必须存在、可读、非 symlink 常规文件,`type: area-index`,`owner` 与目录名一致;index 要写清收录与排除范围。
