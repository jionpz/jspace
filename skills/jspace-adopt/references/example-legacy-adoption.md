# Golden run — 临时 fixture

以下是去敏演练模板。只在 `/tmp` 下创建 fixture;不读取真实 HOME 配置、不触碰真实 filehub、scheduler 或 gbrain store。

## Fixture

```text
/tmp/legacy-demo/
├── AGENTS.md                    # 用户内容 + 非 JSpace 指令
├── CLAUDE.md                    # 用户内容
├── hub.json                     # 旧 registry: domain + resource + 绝对路径
├── skills/
│   └── team-notes/SKILL.md      # 用户自建 skill
├── .claude/skills/
│   └── team-notes -> ../skills/team-notes
└── assets/
    ├── README.md                # 人类可读说明
    ├── _inbox/
    └── projects/demo/index.md

/tmp/jspace-adopt-rehearsal/     # 仅放迁移计划、备份与验证证据
```

另用文字记录一个既有 slug(如 `project/旧项目/state`)和一个新项目候选 id(如 `demo-2026`)。fixture 不连接真实 gbrain;本阶段只验证报告是否要求保留旧 slug。

## Phase 1 — 盘点

```bash
find /tmp/legacy-demo -maxdepth 4 -type f -o -type l
```

期望事实表:

| 类别 | 事实 | 初判 |
|---|---|---|
| 入口 | `AGENTS.md` / `CLAUDE.md` 非空 | `preserve`;CLAUDE 可能需从 `.jspace-bak` 归并 |
| marker | 无 `.jspace/marker.json` | adoption 可继续 |
| 旧 registry | 根 `hub.json`,含绝对路径 | `archive` + `translate` |
| 用户 skill | `<legacy-root>/skills/team-notes`,投影指向它 | `preserve` / `link` |
| filehub | `assets/` 有 README + projects/index | `register` 原地 |
| gbrain | 旧中文 slug | `preserve` |
| cron | 无 | 无动作 |

盘点前后执行文件树/ hash 对比;两者必须相同。

## Phase 2 — 计划

| source | target | action | command | conflict |
|---|---|---|---|---|
| `hub.json` | 外部备份;新 `.jspace/hub.json` | archive + translate | CLI domain/resource/project add | schema 不同 |
| `<legacy-root>/skills/team-notes` | 原位 | preserve | 无 | 无 |
| `.claude/skills/team-notes` | 由投影规则管理 | manual/link | init 后复核 | 可能是用户 link |
| `CLAUDE.md` 用户原文 | 与新 `@AGENTS.md` stub 合并 | manual/preserve | init 后从 `.jspace-bak` 归并 | 禁止覆盖原文 |
| `assets/` | 原地 filehub | register | `filehub init assets --register ...` | 已有 README,不覆盖 |
| 旧 slug | 原 slug | preserve | 不 rename | 无 |

把计划给用户批准;没有批准不得进入 Phase 4。

## Phase 3-4 — 在第二份副本执行

先复制 fixture(保留 symlink),**经批准**把旧 `hub.json` 移到演练备份目录,再用隔离 HOME 演练:

```bash
cp -R /tmp/legacy-demo /tmp/legacy-demo-applied
mkdir -p /tmp/jspace-adopt-rehearsal/backup /tmp/jspace-adopt-home
mv /tmp/legacy-demo-applied/hub.json /tmp/jspace-adopt-rehearsal/backup/hub.json

jspace init --dir /tmp/legacy-demo-applied --force
find /tmp/legacy-demo-applied -name '*.jspace-bak' -print
# CLAUDE.md: 保留新 @AGENTS.md,再把 CLAUDE.md.jspace-bak 的用户原文合回
HOME=/tmp/jspace-adopt-home jspace skills install --dry-run
jspace filehub init /tmp/legacy-demo-applied/assets --register --domain files --dir /tmp/legacy-demo-applied --dry-run
jspace filehub init /tmp/legacy-demo-applied/assets --register --domain files --dir /tmp/legacy-demo-applied
jspace doctor --dir /tmp/legacy-demo-applied
```

实际执行前先建立临时备份;按批准账本逐项执行。`mv` 和 CLAUDE 合并只发生在获准的临时副本;不要对真实 `~/.agents`、`~/.claude`、scheduler 或 gbrain 执行演练。

## Phase 5 — 验收

- `jspace doctor` 无 error,且资源 warning 都是 fixture 预声明;
- `<legacy-root>/skills/team-notes` 与 AGENTS/CLAUDE 内容原样存在;
- `assets/README.md` 与 `projects/demo/index.md` 原样存在;
- hub 中 filehub 为 `type=filehub`,路径只在 local binding;
- 报告明确列出旧中文 slug 保持不改;
- 盘点与 dry-run 后文件 hash 未变。

## 交接

资料本体整理 → `asset-ingest`;工作台日常诊断 → `jspace-use`;真实机器全局接线 → `harness-config`。
