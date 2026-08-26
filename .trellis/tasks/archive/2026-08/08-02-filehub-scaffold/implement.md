# filehub 骨架 + 注册 + doctor 校验 — 执行计划

## 实施清单(顺序)

1. **模板**:`templates/workbench/` 下新增 filehub 骨架模板(或独立 `templates/filehub/`):
   - `_inbox/`、`projects/`、`areas/`、`archive/` 空目录(保留 `.gitkeep` 或目录内占位 README)
   - 根 `README.md`:landing 链接 + 命名规范 + 分层同步说明(Obsidian Sync 选项一段)
   - 样本 `index.md` 模板:frontmatter + 现状/关键文件表/下一步 + wikilink 说明
2. **CLI**:`cli/cmds.ts`(或新 `cli/filehub.ts`)新增 `filehub init <root>`:
   - 骨架生成(幂等:已存在骨架 → 提示不覆盖;已注册 → 提示复用)
   - Obsidian 检测(`.obsidian/`),不预写配置
   - `--register` 选项:复用 registry 的 resource add 逻辑注册 `type: filehub` / primary path
   - 根 README 生成时替换占位符(同步/命名)
3. **registry**:确认 `resource add --type filehub` 可用;filehub 单根约定(已注册则提示)。
4. **doctor**:`cli/cmds.ts` doctor 增加 filehub 校验段(根存在、`_inbox/` 存在、inbox 文件计数告警;未注册 → 提示降级暂存区)。
5. **filing.md**:更新「降级暂存区」节(与 `_inbox/` 同职责、迁移指引)。
6. **主命令注册**:`cli/main.ts` / `cmds.ts` 命令表挂上 `filehub`。

## 校验命令(每步)

- `bunx tsc --noEmit`
- `bun run scripts/gen-assets.ts`(模板/技能变更后重新生成内嵌资产)
- `bun run cli/main.ts filehub init /tmp/fh` → 生成骨架;重复运行确认幂等
- `bun run cli/main.ts resource add --type filehub ... --primary <root>`(或 `filehub init --register` 演练)
- `bun run cli/main.ts doctor --dir /tmp/fh` → 含 filehub 状态、inbox 计数
- 全流程回归:`bun run cli/main.ts init /tmp/jspace-smoke && doctor --dir /tmp/jspace-smoke`

## 关键风险 / 回滚点

- `gen-assets.ts` 与 `assets.generated.ts`:改模板必须重新生成,否则二进制/源码运行不一致;生成文件手改会被覆盖。
- `resource add` 单根约定:二次注册 `type: filehub` 的行为要定义清楚(报错 or 提示复用)。
- doctor 告警不阻塞:filehub 缺失/inbox 非空是 warning 不是 error,保持与「外部资源路径缺失按 warning」一致。
- 回滚:撤销 `cmds.ts`/`registry.ts` 相关 diff + 重新 `gen-assets`;`resource remove --id filehub` 即回降级路径。
