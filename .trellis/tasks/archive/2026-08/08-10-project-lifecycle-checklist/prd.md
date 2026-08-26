# 项目生命周期 checklist 收拢

## Goal

把散落在 GOAL.md、工作台 README、域模板注释里的项目生命周期纪律收拢成一处可执行 checklist。审查证据:纪律散落导致实际未执行——filehub 已有 2 个真实项目,但域 README 仍是占位表、hub `projects` 为空。轻量任务:PRD-only。

## Requirements

- R1 立项 checklist(三步,GOAL 已有原则):① filehub `projects/<项目>/index.md`(dashboard);② 域 README 项目表挂一行;③ gbrain 建实体(`project/<id>/state` 起始页,含指针)。补第 ④ 步:酌情 `jspace project add`(稳定 slug、消 warning)。
- R2 结项 checklist:① 移入 `filehub/archive/<年>/` 并更新域 README 挂接;② `index.md` 标记结项;③ `project/<id>/state` 写结项终态(保留不删,呼应 jspace-use §8.6 表)。
- R3 落点:优先并入 `skills/jspace-use/SKILL.md` §8 新增小节(推荐——避免 skill 数量膨胀,且 §8.6 退役表已在同章);若行数/结构失衡再考虑独立薄 skill,决策记 Key Decisions。
- R4 互指:与 doctor 既有体检项(`filehub.project_stale` / `domain.dormant`)文案互相引用;与 asset-ingest 的归属映射表互指不重复。

## 约束

- 文档改动走开发仓:改 `skills/` 源 → `gen-assets` → 各投影,不直接改已生成工作台。
- checklist 每步给具体命令/文件路径,风格对齐现有 §8(决策表 + 确认规则)。

## Acceptance Criteria

- [x] checklist 在 jspace-use §8(或独立 skill)落地,`check-skills` / `gen-assets` 无残留 diff。
  → 落 `skills/jspace-use/SKILL.md` **§8.7 项目生命周期(立项 / 结项)**:命名约定表 + 立项四步(带命令)+ 结项三步 + doctor 诊断对应表。未新建 skill(skill 数刚 5→7,避免继续膨胀;§8.6 退役表在同章,天然衔接)。门禁全绿:tsc 0 / 538 pass / check-skills PASS / manifest-integrity 44。
- [x] 用本机 2 个真实项目各走一遍立项 checklist 作为验收。
  → ① index.md 均已在;② 域 README 项目表(P0 已挂);③ gbrain state 页均已在;④ **本任务补齐 registry 注册**:`jspace project add tiyanying-52 --asset-rel-path projects/52期体验营`、`baobiao-module --asset-rel-path projects/报表模块`。`hub.json` projects 从 `[]` 变为 2 条,doctor 0/0/0。
- [x] doctor 体检项文案与 checklist 互指成立(grep 可验)。
  → `doctor.ts:209` 的 `filehub.project_stale` 文案改为 `see jspace-use 8.7 (project lifecycle) / 8.6`;§8.7 末尾「与 doctor 体检项的对应」表反向引用 `filehub.project_stale` / `filehub.inbox_unfiled` / `domain.dormant`。

## Key Decisions

- **落 §8.7 而非独立 skill**:PRD 推荐项;skill 数刚从 5 增到 7,再加会稀释路由;生命周期与 §8.6 退役规则同属治理章,放一起读者一次读完。
- **命名约定解决 P0 遗留的中文 id 冲突**:`jspace project add` 的 id 限 `[a-z0-9-]`,但 CLI 已支持 `--asset-rel-path` —— 于是约定「**project id = ascii slug(机器面);资产目录名 = 中文(人读面)**」,两者由 `--asset-rel-path` 绑定,不必为注册改目录名。P0 中标记为「暂缓」的注册因此得以完成。
- **存量中文 slug 不迁移**:既有 `project/<中文名>/state`、`assets/<中文名>/*` 页保留原样。理由:① 记忆层 append-only,重命名代价大于收益;② `memory-recall` 的可复跑验收基线(2026-08-03)正建立在这些 slug 上,迁移会使基线失效。新项目一律 ascii,新旧并存为可接受过渡态。此条已写入 §8.7。

## 实现记录

- 备份:`~/jspace-work/.jspace/hub.json.bak-20260810`。
- 域 README 中 P0 留下的「registry 注册暂缓」备注已可移除(本任务已完成注册)。
