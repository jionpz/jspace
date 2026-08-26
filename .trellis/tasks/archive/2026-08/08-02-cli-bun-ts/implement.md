# CLI bin/jspace 迁移到 bun+TS — 执行计划

**子任务**:08-02-cli-bun-ts | **父**:08-02-cross-platform-migration

## 顺序依赖
- 先行于 gbrain-harness-wiring / bootstrap-skill / github-ci-release。
- 平台事实以父任务 research 定稿为准(已完成)。

## 执行清单

### 1. 脚手架 ✅
- [x] 建 `cli/`、`scripts/`、`tsconfig.json`、dev-only `package.json`。
- [x] 从 `bin/jspace`(Python)提取行为契约,整理对拍用例清单。

### 2. 资产内嵌 ✅
- [x] `scripts/gen-assets.ts`:遍历 `templates/workbench` + `skills/jspace-bootstrap` + `skills/asset-ingest`,生成 `cli/assets.generated.ts`。
- [x] `cli/embed.ts`:isCompiled 检测(`/$bunfs/`)+ installDir(`dirname(process.execPath)`)+ materializeTree。

### 3. CLI 命令实现 ✅
- [x] `args.ts` 手写解析 + `--help`/`--version` 文本逐字对齐(argparse 换行/错误前缀 `jspace <cmd>: error:`/unrecognized 冒泡)。
- [x] `registry.ts`:`loadRegistry`/`saveRegistry`/`validateHub`/`isWithin` 逐项搬迁,错误文案一致。
- [x] `init.ts`:materializeTree + 占位符替换 + `.jspace.json` 写入。
- [x] `cmds.ts`:doctor/domain/resource 全部子命令(含 add 骨架/回滚、remove 引用检查/purge、list 文本/JSON)。
- [x] `main.ts` 组装 + 退出码(0/1/2)。

### 4. build 与本地验证 ✅
- [x] `bun build --compile cli/main.ts --minify` 成功(本机 macOS arm64,产物 ~62MB)。
- [x] 编译二进制 `--version`/`--help`/错误路径正常;编译模式 init 的 `Validate: jspace` 行、`__DEV_ROOT__`→二进制目录 验证通过。
- [x] `bunx tsc --noEmit` 类型检查通过(devDeps: typescript + bun-types)。

### 5. 新旧对拍 ✅
- [x] 参数面/help/错误路径:26+ 用例 PASS(argparse 错误格式逐字一致,含 missing-required 顺序、mutually-exclusive 报错方顺序、unrecognized 冒泡)。
- [x] 完整 CRUD 序列(init→doctor→domain add/list/json/remove/purge→resource add/list/json/remove→domain remove 引用检查→doctor):stdout/stderr 逐流一致,最终 hub.json 字节一致。
- [x] doctor 校验失败路径 18 例:PASS(version/id/path/README/domain.json/entrypoint/primary 等)。
- [x] domain/resource 错误路径 11 例 PASS。
- [x] D4 模板引用改写(`__DEV_ROOT__/bin/jspace` → `jspace` 命令):py/ts init 树仍一致。
- [~] **已知例外**:JSON 解析错误文案不同(Python json 模块 vs JS JSON.parse 底层解析器差异,前缀/退出码一致)——记录于 design 风险,不作为验收阻断。

### 6. 交付(待评审)
- [ ] 决定旧 Python `bin/jspace` 处置(建议:git 保留历史,`git rm --cached bin/jspace` + `.gitignore` 已配;源码迁到 `cli/`)。
- [ ] 子任务 `check` 全绿 → 记录到 implement.jsonl → 父任务集成。

## 验证命令
```bash
bunx tsc --noEmit
bun run scripts/gen-assets.ts
bun build --compile cli/main.ts --minify --outfile bin/jspace   # 本机产物
bun run cli/main.ts doctor --dir <workbench>
```

## 评审门 / 回滚
- **门1**:✅ 已确认(2026-08-02,D4 改为 `jspace` 命令;方案批准)。
- **回滚**:Python `bin/jspace` 在 git 保留至验收;TS 产物失败则切回。

## 参考
- 父 design D1-D6;`research/empirical-bun-probe.md`、`research/cli-bun-ts.md`。
