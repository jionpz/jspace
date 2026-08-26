# 资料转知识资产学习 skill — Technical Design

## 1. 边界与职责切分

```
                    ┌──────────────────────────────┐
                    │   JSpace 学习 skill (薄衔接层) │
                    │  归位 + 命名 + 入脑纪律 + 编排  │
                    └───────┬──────────┬───────────┘
                            │          │
                 文件系统操作 │          │ gbrain CLI/MCP
                            ▼          ▼
       ┌──────────────────────┐   ┌─────────────────────┐
       │ 文件中心(本体/人类可读) │   │ gbrain(检索层/知识页) │
       │ _inbox/ areas/        │   │ reference 页 + 指针   │
       │ projects/ index.md    │   │ + 现成 skill 生态      │
       └──────────────────────┘   └─────────────────────┘
```

- **文件中心** = 本体层:资料文件、项目索引,人类可浏览。注册为 hub.json `type=filehub` resource,skill 读其 primary path 作为根。
- **gbrain** = 检索层:reference 页(是什么+关键事实+指针)、语义/关键词召回、图谱;复用其现成摄入能力(仅编排入口,不重造)。
- **skill** = 编排层:归位(文件系统)、入脑(gbrain put 写 reference 页)、纪律(type 映射、命名、embedding 检查/降级、查重)。

## 2. Skill 落地位置与结构

- **位置**:工作台侧 `skills/asset-ingest/`,由 `jspace init` 复制进生成的工作台。
- **init 复制机制**(对齐现有 `bin/jspace` 单一 `SKILL_SOURCE` 模式,最小改法三件套):
  1. 新增 `ASSET_INGEST_SOURCE = DEV_ROOT / "skills" / "asset-ingest"`(L16 旁)
  2. 新增同源 `is_dir` fail 检查(对齐 L164-165)
  3. 新增 `shutil.copytree(ASSET_INGEST_SOURCE, target / "skills" / "asset-ingest", dirs_exist_ok=True)`(对齐 L168-172)
  - `_materialize_placeholders` 遍历 target 递归,自动覆盖新 skill 的 `__DEV_ROOT__`,无需改动。
  - **依赖**:S1(建目录)必须先于 S5,否则新增 is_dir 检查会让 init fail。
- **结构**:
  ```
  skills/asset-ingest/
    SKILL.md                     # frontmatter(name/description/triggers) + 执行步骤
    references/
      filing.md                  # 归位/命名/类型策略/文件中心定位/降级路径
      gbrain-write.md            # reference 页模板 + slug 派生 + type 纪律 + embedding 降级
  ```
- **resolver 注册**:在 `templates/workbench/AGENTS.md` 的 Brain operations 段加一行 `- **asset-ingest**: 资料入库 | 整理 inbox | 归位资料`(与 SKILL.md triggers 对应,该段注释要求 keep format intact)。**顺带**给 `skills/jspace-bootstrap/SKILL.md` 补 `triggers:` frontmatter(现已被 `gbrain doctor` 报 mece_gap,一并修正,保持两 skill 契约一致)。

## 3. 数据流(一份资料全链路)

```
资料到达("把这份资料入库" / 提供路径)
  → ① 识别:类型(pdf/ppt/txt/md/book/excel)+ 主题 → 判断项目归属 or 领域归属;查重(同语义已存在?)
  → ② 归位:命名 YYYY-MM-DD-语义名-vN.ext
       项目产出 → filehub/projects/<项目>/<子目录>/
       书籍/领域 → filehub/areas/<领域>/
  → ③ 入脑:gbrain put 写 reference 页(slug 派生自项目/领域+语义名,与文件绑定)
       frontmatter: type: reference / source / project / tags
       正文: Summary + Key Facts + Pointer(原文件绝对路径)
  → ④ 登记:项目/领域 index.md 挂一行(文件名+日期+gbrain slug)
  → ⑤ (可选,用户要求时) 深入:strategic-reading(会话内)/ book-mirror(标注运行约束)
  → 召回:gbrain query/search 命中 reference 页 → 指针 → 打开本体
```

- **顺序依赖**:③ 产生 gbrain slug,④ 登记 index 含 slug → **③ 先于 ④**。
- **去重/版本/删除生命周期**:
  - 入库前查重:`gbrain get <slug>` / 检查目标目录同名文件;已存在 → 提示用户(跳过/覆盖/升 `-vN`)。
  - 版本升级:新文件 `-vN` → 新 reference 页或更新指针,旧页保留(append-only)并在新页注明 supersedes。
  - 归档/删除:文件移入 `archive/<年>/` 或删除 → reference 页指针陈旧,SKILL.md 提供可选"失效提示"步,不强做自动清理(留给使用涌现)。

## 4. 关键机制设计

### 4.1 中文召回与 embedding(实证硬约束)
- **配置**:bootstrap 默认配置 SiliconFlow bge-m3(openrouter recipe 载体),为默认必需项。
- **校验命令**:bootstrap(未 serve)阶段用 `gbrain models doctor --json` 验证 `embedding_config` + `embedding_reachability`(doctor --json 无此字段)。
- **serve 会话内降级序列**(doctor 降级为文件系统检查,查不到 embedding):
  1. 写页不带 `embed_skip`;若**写失败并报 embedding 错** = 探针(embedding 不可达)
  2. 以 `embed_skip: true` 重写(写入必须成功)
  3. 检索降级 `gbrain query`(无 embedding 自动退化为关键词)/ `search`
  4. 输出**固定提示**:`embedding 不可用,当前为关键词检索,中文命中率可能偏低`(AC4 判据)
- bootstrap 不因 embedding 缺失而失败(离线可移植);"默认必需"≠"缺失即失败"。

### 4.2 本体不复制与指针(实证 + 源码确认)
- 小文件 `files upload-raw` 是 **no-op**(仅回显路径,无 DB 记录)→ **不依赖它**。
- 持久指针 = reference 页 Source 字段(**原文件绝对路径**)。可选附 wikilink(文件中心可被 Obsidian 打开)。
- media/大文件(≥100MB 或视频/音频/图片)才走 `upload-raw`(云上传 + `.redirect.yaml`);MVP 不覆盖此路径,注明即可。
- frontmatter `source` 字段语义 = harness 出处(不占用资产真实来源);资产来源(客户/网盘)放正文 Source 或 tags。

### 4.3 复用 gbrain 生态(分层,不重造)
- **基础路径**:skill 自实现"归位 + reference 页"(薄两层),对齐 `_brain-filing-rules.md` 契约(按主要内容物归档),不 invoke media-ingest 全流程(其契约重:实体抽取 + backlink 传播,MVP 不承担)。
- **深度路径**(可选,用户要求时):
  - `strategic-reading`:纯 markdown skill,serve 会话内可执行 → 可放心作可选步。
  - `book-mirror`:CLI 命令,serve 持锁时被阻塞、需 Anthropic-only 子代理 + 成本确认 → **MVP 明确不含**,仅标注存在与约束。
  - media-ingest:serve 会话内需用 MCP `file_upload`(其 Phase 2 CLI upload-raw/sync 被锁阻塞);MVP 不 invoke。
- 图谱/backlink 依赖 gbrain 自动实体抽取,skill 不强加。

### 4.4 兼容 live brain 单进程锁
- skill 经 gbrain CLI/MCP 操作,不尝试绕过 PGLite 锁;brain 被占用时按 gbrain 提示语告知用户(实测确认:serve 持锁 → `LiveServeLockError`)。

### 4.5 降级暂存区(文件中心未注册时)
- **不在工作台 git 目录内建 `_inbox/`**(工作台是 git 同步的控制平面,重资产不得引入)。
- 降级目标:工作台同级、不进 git 的目录(约定 `../<workbench>-inbox/`),或用户指定目录;SKILL.md 首次使用自动创建并说明。
- 提示"待文件中心(M2)注册为 `type=filehub` resource 后正式归位"。
- `references/filing.md` 写清暂存区与 `filehub/_inbox/` 的关系,避免同名混淆。

### 4.6 文件中心定位约定
- 文件中心 = hub.json `type=filehub` 的 resource;skill 读其 `primary: true` 的 path entrypoint 作为根。
- 未找到该约定 type/id → 走 4.5 降级路径。
- 该约定直接服务 M2(M2 按此注册)。

### 4.7 类型策略表
| 类型 | 归位 | gbrain 写入 | 备注 |
|---|---|---|---|
| pdf/ppt/txt/md 书籍、资料 | `areas/<领域>/` | reference + 摘要要点 | 先摘要+指针,按需加深 |
| excel | `projects/<项目>/` 或领域 | reference + 关键事实 | 摘要+指针,不做逐表抽取(GOAL 开放问题 4) |
| 项目产出 | `projects/<项目>/` | reference | 命名 -vN |
| 视频/音频/截图 | — | — | 路由到 media-ingest 深入路径;MVP 范围外 |

## 5. 文档同步(本任务附带的小改)

- **`GOAL.md`**:为主,补充 gbrain 定位澄清——"gbrain 是检索层 + 知识页索引,自带资料摄入/文件登记能力;本体仍存文件中心"。更新"最后更新"日期。
- **`AGENTS.md`(开发仓库)**:Product Vision 同步补一句摘要(AGENTS.md 是 GOAL.md 操作摘要,冲突以 GOAL 为准并同步修订;改 L20"gbrain 负责记忆(事实+资产指针)"为含"检索层 + 现成摄入"的表述)。
- **`skills/jspace-bootstrap/references/gbrain.md` + SKILL.md**:embedding 定位从"可选"改"默认必需、不可用降级";补"资料入库走 asset-ingest"衔接;SKILL.md Phase 1 文案同步。现有 live 工作台不回填,等下次重建(`init --force`)或 bootstrap 更新。

## 6. 取舍与边界

- **MVP 范围**:归位 + 入脑 + 登记 + 召回 + embedding 检查/降级 + 查重 + 失败纪律;不含 book-mirror/media-ingest 深度集成(标为可选步/范围外)。
- **不重造**:gbrain 已有能力(摄入、图谱、存储)skill 只编排不实现。
- **不改 gbrain**:schema/CLI/存储语义不动;不新增 frontmatter 字段。
- **范围外**:文件中心本体实现 + _inbox 自动化(M2)、cron 定时入库(M3)、批量自动化(M2)。

## 7. 验收环境

- 隔离 brain 方案:`HOME=<tmp> gbrain init --pglite`(**配 SiliconFlow embedding**,用于 AC2b 语义命中;若仅验证降级路径则 `--no-embedding`)。
- 真实资料验收:一份用户中文资料走通 ①-④ 并召回;二次入库验证查重(AC8)。
- 回归:`python3 -m py_compile bin/jspace` + `jspace init /tmp/smoke --force` + `jspace doctor --dir /tmp/smoke`(开发工作流强制项)。
- bootstrap 冒烟:init 新目录后按新口径跑 bootstrap Phase 1,确认 embedding 缺失不阻塞。
