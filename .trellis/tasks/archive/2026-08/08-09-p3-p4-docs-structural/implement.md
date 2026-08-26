# P3+P4 文档 / 脚本 / 结构 — 执行计划

## 执行顺序

### 1. P3-2 install 脚本跨平台一致性(脚本正确性,先做)
1. `install/install.ps1:46`:`-ne` → `-ine`(卸载 PATH 大小写一致);`:7` 注释删 `| iex` 示例或加说明。
2. `install/install.sh:235` fish 行加引号;`:50` `head -1` → `head -n 1`。
3. 两脚本开头加 `JSPACE_BASE_URL` https 校验(`JSPACE_ALLOW_INSECURE=1` 逃生门)。
4. 验证:shellcheck 若有则跑 `shellcheck install/install.sh`;`pwsh` 若有则语法检查(无则人工 review + `bash -n`)。

### 2. P3-3 office-extract.py basename
1. `skills/asset-ingest/scripts/office-extract.py:188–189` `path.split('/')[-1]` → `os.path.basename(path)`(xlsx + pptx 两处)。
2. `office-extract.test.py` 加 Windows 路径用例。
3. 验证:`python3 skills/asset-ingest/scripts/office-extract.test.py`。

### 3. P3-4 detect.sh 多平台 Cursor
1. `skills/harness-config/scripts/detect.sh:30–31` 加 Linux / Windows 路径探测。
2. `skills/harness-config/SKILL.md`「支持 harness」段落同步。
3. 验证:`bash skills/harness-config/scripts/detect.sh`(本机 mac 仍出 cursor)。

### 4. P3-1 注释漂移对齐 + lint step
1. 逐条 `grep -rn`:`docs/PLATFORMS.md:76–77/102/111`、`scripts/gen-assets.ts:35–37`、`templates/workbench/AGENTS.md:27/29` → 改文档或改代码对齐。
2. verify.yml 加低成本 grep lint step(检查 docs 引用的代码字面量在源码能找到),或记录不做的原因。
3. 改模板后重跑 `bun run scripts/gen-assets.ts`。

### 5. P4-2 skill description 精简
1. `skills/jspace-use/SKILL.md` description 精简到 1–2 行,愿景移正文;triggers 去掉过宽词(「帮我找」「怎么开始」)。
2. 其它 4 skill 视 description 长度情况同步精简。
3. 注意:改 frontmatter 后 `bun run scripts/check-skills.ts` 应仍绿;gbrain resolver 关键词(memory: jspace-skill-routing-triggers)确认不破坏 auto-detect。

### 6. P4-1 .trellis 决策(已记录)
- 决策:保留(archive 60+ 任务,非 dead weight)。本任务内不删目录,prd/design 已记录结论。

## 验证命令
- `bash -n install/install.sh` + `shellcheck`(可用时)
- `python3 skills/asset-ingest/scripts/extract.test.py skills/asset-ingest/scripts/office-extract.test.py`
- `bun test`(全仓)+ `bunx tsc --noEmit`
- `bun run scripts/check-skills.ts`(skill frontmatter 改动后)

## Review Gates
- skill frontmatter 改动先跑 check-skills + doctor,确认不破坏 skill 投影/检测。
- install 脚本改动无本地跨平台执行环境 → 提 PR 后由 CI(如有 shell 检查)或人工 review 兜底,commit message 注明已 `bash -n` 验证。
