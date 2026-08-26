# .jspace 目录收纳配置 — 执行计划

## 实施清单(顺序)

1. **模板源文件搬迁 + 新增**:
   - `git mv templates/workbench/hub.json templates/workbench/.jspace/hub.json`(源文件跟着走,防 materializeTree 写根);
   - 新增 `templates/workbench/.gitignore`(内容 `.jspace/logs/`);
   - `templates/workbench/README.md` 结构清单更新(hub.json → .jspace/hub.json;.jspace.json → .jspace/marker.json;新增 .jspace/logs/);
   - `templates/workbench/AGENTS.md`:操作型 hub.json 引用(路径/命令)统一 `.jspace/hub.json`,Registry Access 加锚点声明,纯概念指代保留;
   - `templates/filehub/README.md` 一处路径更新。
2. **CLI**:
   - `cli/registry.ts`:`REGISTRY_FILE = ".jspace/hub.json"`;
   - `cli/init.ts`:`MARKER_FILE = ".jspace/marker.json"`;cmdInit 显式 `mkdirSync(".jspace/logs")`;旧残留守卫(根 hub.json/.jspace.json 存在且 .jspace/marker.json 缺 → fail 提示清除);
   - `cli/cmds.ts`:doctor 文案更新(marker/hub 路径);registerFilehub 检查与文案更新;
   - `cli/args.ts`:filehub help 文案 `.jspace/hub.json`。
3. **skills / 文档**:
   - `asset-ingest`:`SKILL.md`/`filing.md`/`batch.md` hub.json → .jspace/hub.json;无头日志 `logs/inbox-batch.md` → `.jspace/logs/inbox-batch.md`(batch.md L54、SKILL.md L84);
   - `jspace-bootstrap`:`SKILL.md` Phase 2 + **Phase 5**(L100-101/L57)+ `registry.md` 命令更新;
   - dev 侧:`AGENTS.md` L10/L50、`README.md` L8 同步;GOAL.md 概念引用保留;AGENTS.md 加「升级约定 = 清空重 init」。
4. **`gen-assets` 重新生成** + 全回归。
5. **本地工作台重建**:`rm -rf ~/jspace-work`(清空旧布局)+ `init ~/jspace-work` + doctor 验证。

## 校验命令(每步)

- `bunx tsc --noEmit`
- `bun run scripts/gen-assets.ts`
- 新布局:`rm -rf /tmp/smoke && bun run cli/main.ts init /tmp/smoke` → 检查 `.jspace/{hub.json,marker.json}` + `.jspace/logs/` 存在、根无 hub.json/.jspace.json;`doctor --dir /tmp/smoke` 通过。
- 旧残留守卫:往 /tmp/smoke 放根 `hub.json`(删 .jspace/ 后)再 init → fail 提示清除。
- 全命令面:domain/resource/filehub/inbox 各演练一次(读 .jspace/hub.json)。
- 回归:`bun run build` → 编译产物 init/doctor/inbox 可用。
- `~/jspace-work` 重建后 doctor 通过。

## 关键风险 / 回滚点

- **模板源文件漏搬**(hub.json 仍在 templates/workbench/ 根)→ materializeTree 写工作台根,方案失效。搬迁是步骤 1 头等动作。
- `assets.generated.ts` 手改会被覆盖:改模板必须 `gen-assets`。
- AGENTS.md 大段 hub.json 引用:只改**操作/路径**处,概念名保留 + 锚点,避免 churn 与漏改。
- 回滚:还原 registry.ts/init.ts/cmds.ts 常量 + 模板 diff + `gen-assets`。
