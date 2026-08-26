# M2 资产层最小协议 — 技术设计

## 架构与边界

资产层三块,沿用 GOAL.md「控制平面 / 记忆层 / 资产层」分层,本任务只动**资产层协议**与**控制平面的接线**:

- **资产层本体**:独立目录(filehub 根,内容不进工作台 git)。`filehub init` 生成骨架,注册为 `type: filehub` resource 后由 asset-ingest 读取。
- **控制平面接线**:CLI(`filehub init` / `doctor` 扩展 / `inbox status` 辅助)、registry(hub.json `type: filehub`)、模板(domain README 项目挂接段落)、bootstrap(文件中心引导步骤)。
- **记忆层**:不变(asset-ingest 写 gbrain reference,已交付)。R8 的 wikilink/frontmatter 与 gbrain 页 frontmatter 风格一致,但不新增 gbrain 字段。

不封装 gbrain、不自研文件同步、不做事件驱动(GOAL 非目标)。Obsidian 只作视图:纯 md + wikilink + 轻量 YAML frontmatter,不依赖插件。

## 关键契约

### registry 契约(`type: filehub`)
- `hub.json` 中 `resource.type === "filehub"`,取 `primary: true` 的 path entrypoint 作为文件中心根(asset-ingest 现行读取逻辑,不改)。
- 全机可多个 filehub?**否,MVP 约定单根**:bootstrap/init 若已有 filehub resource 则提示复用或确认更换。多根留待使用涌现。
- `jspace resource add` 已支持 `--type`;filehub 注册复用该命令(bootstrap 内部调用 / 文档给出等价 CLI)。不新增重复注册命令。

### filehub 骨架(Obsidian 优先)
```
<根>/                          # 可直接被 Obsidian 作为 vault 打开
  README.md                    # 协议首页(landing):链接 projects/ areas/ archive/_inbox
  _inbox/                      # 新文件先落这里(Obsidian 文件面板可见)
  projects/<项目>/index.md     # 项目 dashboard(frontmatter + 现状 + 关键文件 wikilink 表 + 下一步)
  areas/<领域>/                # 长期领域资料(是否建 index 由使用涌现)
  archive/<年>/                # 结项/冷资料
```
- **vault 识别**:init 检测根目录是否已有 `.obsidian/`(已是 vault → 仅兼容,不写配置);没有 → 骨架即为可打开 vault,Obsidian 首次打开自动生成 `.obsidian/`(不预写).
- **frontmatter 纪律**(与 gbrain reference 页同风格):
  ```yaml
  ---
  type: project-index | filehub-home
  project: <id>
  tags: [t1, t2]
  created: YYYY-MM-DD
  ---
  ```
- **wikilink 约定**:`index.md` 关键文件表用 `[[项目文件路径|显示名]]` 或相对链接;根 README 用 wikilink 链到各项目/领域/archive。asset-ingest 归位时在 index.md 登记行含 gbrain slug + wikilink(可选)。
- **命名**:`YYYY-MM-DD-语义名-vN.ext`(沿用,不进 frontmatter 规则)。

### 降级暂存区迁移(R6)
- 降级暂存区 = 工作台外 `../<workbench>-inbox/`(不进 git),asset-ingest 未注册时使用。
- 迁移路径:注册 filehub 后,`filehub init` 提供 `--migrate-from <暂存区>` 可选参数;或文档指引人工移动 + 重新入库。M2 只定义路径,不做自动批量迁移(存量收编增量策略)。
- `_inbox/`(正式)与降级暂存区是同一职责两处实现,filing.md 相应更新。

### 批量整理管线(R4/R9/R10【核心】)
- **定位**:这是项目最高价值交付——把「文件自动整理」做成可定时、可人工介入的流水线。逻辑在 skill 层(asset-ingest 扩展 batch 模式),CLI 只做只读辅助 `jspace inbox status`(列文件/计数/预检,**不做**语义判断)。
- **两遍式**(服务人工审核):
  - **第一遍(确定性,零提问,可无头)**:识别置信高(类型/归属/命名明确)的文件直接走单文件逻辑,单文件原子性(该份失败即停、不留半成品);`_inbox/` 打 `.processing` 标记,可中断续跑,已完成项不重复。
  - **第二遍(模糊项,人工过目)**:拿不准的(归属/命名/查重冲突)列一张短清单,用户一次过目——每个可「跳过 / 改归属 / 改命名 / 升版本」。
- **人工调整闭环(R10)**:处理前可排除(「这个别动」→ 加入 skip 清单);处理后对错归/错命名可「撤销本次 / 重跑该份」,修复 gbrain 页 + index 登记(复用 asset-ingest「修复」语义)。
- **定时批量源(R9)**:定时任务处理的就是 filehub `_inbox/`(未注册时降级暂存区)里的资料——pdf/ppt/学习文件都先进 `_inbox/`,定时任务扫它。批量管线把「输入目录 → 处理 → 汇总」与源解耦,入口统一为 `_inbox/`。
- **cron 可驱动**:无头模式下只跑第一遍(确定性),模糊项留在清单里等用户在场时第二遍;输出执行日志(路径/计数/成功/跳过/失败)到固定路径,供下次会话检查(对接 M3 失败可见性契约)。M3 cron 只负责「定时调起」,管线本身在本任务交付。

### bootstrap 引导(R7)
- `jspace-bootstrap` 增加「文件中心」步骤(Phase):选项 **Obsidian(默认)** / 本地目录 / 网盘目录 / **暂不配置**。
  - Obsidian:输入根路径 → 校验/提示 vault → 可选「启用 Obsidian Sync」写进根 README 同步说明 → 调 `resource add --type filehub` 注册。
  - 暂不配置:跳过,asset-ingest 维持降级暂存区(提示)。
- 与现有 gbrain / harness 接线步骤并行不冲突;注册前置 = filehub-scaffold 的注册机制。

### 域↔项目挂接(R5)
- 模板 `workspace/<domain>/README.md` 增加「本域进行中的项目」段落:列出项目名 + 资产目录相对路径 + 状态。
- 「跟踪新项目三步」约定:① 资产层 `filehub/projects/<项目>/` 建目录+index.md;② 域 README 挂一行;③ 记忆层建实体(gbrain)。写成模板文档/工作台 README 段落,不新建 skill(MVP)。

## 数据流

```
学习资料(pdf/ppt) → 落进 filehub/_inbox/(未注册时降级暂存区)
  → 批量管线(asset-ingest batch,【核心】)
      第一遍(确定性,零提问,可无头):识别→查重→归位(projects|areas)
        → index.md 登记 → gbrain reference 页(指针=绝对路径)→ 中文召回自检
        → 单文件原子性 + .processing 幂等 + 执行日志
      第二遍(模糊项,人工过目):短清单一次确认(跳过/改归属/改命名/升版本)
  → 处理后纠错路径(撤销本次 / 重跑该份,修 gbrain 页 + index)
  → M3 cron 定时调起:扫 _inbox/ 无头只跑第一遍 + 日志落固定路径
```

## 子任务映射

| 子任务 | 需求 | 交付物 | 顺序 |
|---|---|---|---|
| filehub-scaffold | R1/R2/R3/R6 + R8 结构部分 | filehub init 命令、vault 兼容、注册机制、doctor 校验、迁移路径、filing.md 更新 | 1(批量管线的前置:正式根路径) |
| inbox-batch【核心】 | R4/R9/R10 | asset-ingest batch 模式(两遍式+人工调整+cron 可驱动)+ `jspace inbox status` + 输入目录约定 | 2(核心价值,依赖 1) |
| bootstrap-filehub | R7 + Sync 选项 | bootstrap 文件中心步骤、注册流程、未配置降级提示 | 3(依赖 1) |
| domain-project-link | R5 | 模板 domain README 段落 + 三步约定文档 | 4(可并行,无依赖) |

依赖非硬阻塞:子任务 2/4 可与 1 部分并行;但**核心验收路径**(父任务)要求 1→2 端到端跑通(正式根 + 批量两遍式 + 人工调整)。

## 兼容与迁移

- 首次开发、未上线:**无兼容负担**(AGENTS.md 第 6 条)——schema/CLI/模板直接演进。
- 对既有工作台:filehub 为新增 resource,不破坏已有 registry;asset-ingest 现有行为不变(注册前仍走降级路径)。
- 不新增 gbrain frontmatter 字段;不修改 gbrain 本体。
- 模板 `hub.json` 不预置 filehub resource(位置是每机 bootstrap 决策,模板保持通用)。

## 重要取舍

- **Obsidian 只作视图不写插件/私有格式**:换来「换工具资料不坏」的长期保证,代价是错过部分 Obsidian 高级功能(图谱标注、dataview 等)。
- **批量整理放 skill 不放 CLI**:语义判断必须 AI;CLI 只读辅助。换取单文件/批量/无头三种形态复用同一纪律。
- **filehub 单根约定**:简化注册与 doctor;多文件中心按需涌现,不预先设计。
- **不预写 `.obsidian/` 配置**:Obsidian 首次打开自动生成,避免写死路径/主题配置到 git 同步内容。

## 操作与回滚

- 全部操作为本地文件系统 + registry,可逆:`resource remove --id filehub` 即退回降级路径;`filehub init` 幂等(重复 init 检测已注册/已存在骨架,不覆盖用户文件)。
- 失败纪律沿用 asset-ingest:任一步失败即停、报告原因、不留半成品。
