# 迁移映射与冲突策略

## 1. 动作词汇

| 动作 | 含义 | 默认权限 |
|---|---|---|
| `preserve` | 原样保留,不动 | 可默认 |
| `adopt` | 纳入 JSpace 管理或触发现有 CLI 写入 | 展示后批准 |
| `register` | 把已有资源加入 registry,不搬本体 | 展示后批准 |
| `link` | 建立投影/薄链接,源内容不覆盖 | 展示后批准 |
| `translate` | 旧 schema → 新 schema | 展示映射后批准 |
| `archive` | 移到明确备份位置,不删除 | 单独批准 |
| `manual` | 语义不确定,交给用户 | 必须停 |
| `blocked` | 存在冲突/危险,不能继续 | 必须停 |

## 2. 结构映射

| 旧事实 | JSpace 目标 | 动作 | 约束 |
|---|---|---|---|
| 无 `.jspace/marker.json` 的项目根 | 工作台根 | `adopt` | `jspace init --force`;先处理旧 registry 残留 |
| 根 `hub.json` / `.jspace.json` | `.jspace/hub.json` + `.jspace/local.json` | `archive` + `translate` | 旧文件先移到备份;绝对路径转 binding,不手工复制 |
| 用户根 `skills/` | 保持根 `skills/` | `preserve` | 根 `skills/` 归用户,不自动搬到 `.jspace/skills/` |
| 官方同名 skill | `.jspace/skills/<name>/` + 投影 | `link` / `manual` | 内容一致才 link;不同内容默认保留用户副本 |
| harness 项目投影 | 由 `jspace init` / upgrade 生成的投影 | `adopt` | init 已全量物化;不逐个手抄 |
| `AGENTS.md` 块外内容 | 原文件块外 | `preserve` | init/upgrade 只替换 JSPACE managed 块,块外保留 |
| `CLAUDE.md` 用户内容 | 原文件 + `@AGENTS.md` | `manual` / `preserve` | init 可能用 `@AGENTS.md` stub 覆盖,必须从 `.jspace-bak` 合并回原文件 |
| 其他 `*.jspace-bak` 碰撞 | 原路径 + 备份 | `manual` | 先逐项 review;禁止静默删备份或覆盖用户语义 |
| 已有 filehub 根 | 原地 filehub | `register` | `filehub init <已有根> --register`;README/index 不覆盖 |
| 旧 project 记录 | `.jspace/hub.json projects[]` | `translate` | 用 `jspace project add`;中文资产目录可保留,id 用 ASCII |
| 旧 resource 绝对路径 | path entrypoint + `local.bindings` | `translate` | `jspace resource add`;本机路径只进 local |
| 旧 gbrain slug | 原 slug | `preserve` | 不重命名;新 id 才用 ASCII |
| 旧 cron 内联 prompt | `.jspace/cron.json` 目标 | `manual` / `translate` | 只有语义完全等价才迁移;官方周期任务优先 `target.kind=skill` |
| harness gbrain MCP 项 | 对应 harness 用户配置 | `adopt` | 用 `jspace harness wire --harness <名>`;merge + backup,不覆盖非 gbrain 项 |
| 未知 scheduler 任务 | 系统调度 | `manual` | 不自动 remove/replace;先识别是否由旧 JSpace 管理 |

## 3. 冲突策略

- **同名同内容 skill**:报告后优先薄链/保留单一来源;仍不静默覆盖用户文件。
- **`.jspace-bak` 碰撞**:逐个归并回原文件或标 `manual`;备份在验证完成前保留。
- **同名不同内容 skill**:`blocked`,默认保留用户副本;由用户选择改名、弃用或手工合并。
- **已有 JSpace marker**:不是 adoption,改走 `jspace workspace upgrade`。
- **坏 symlink / 不可读 target**:`blocked`,只报告;不删除、不改指。
- **filehub 根歧义或嵌套**:`manual`;不猜 primary,不换根,不搬资料。
- **portable registry 含绝对路径**:`translate` 到 binding;绝不把绝对路径写进 `.jspace/hub.json`。
- **旧 schema 有未知字段**:保留原文件备份并列 `manual`;不要丢字段后声称迁移成功。
- **已有中文 gbrain slug**:`preserve`;迁移报告只说明“新 slug 用 ASCII”。

## 4. 用户内容所有权

按位置判断所有权:

- 根 `skills/`、AGENTS/CLAUDE 块外、harness 自有配置、filehub `index.md` = 用户内容,默认 `preserve`;
- `.jspace/skills/`、harness 投影、JSPACE managed 块 = JSpace 管理面;
- `.jspace/hub.json` / `cron.json` = user 数据,CLI 更新但升级不覆盖;
- `.jspace/marker.json` / `local.json` / `state/` = machine 状态。

**不要把用户 skill 自动搬进官方 skills 目录**,也不要把 filehub 的本体搬进工作台 git。

## 5. 最小迁移原则

第一性原理是“保留已有价值,只补齐控制面缺口”:

- 能原地注册就不搬迁;
- 能调用 CLI 就不手改 JSON;
- 能保留源文件就不覆盖;
- 不确定归类就 `manual`,不发明新层级;
- 迁移后的复杂度必须用可验证收益换取;否则保持现状。
