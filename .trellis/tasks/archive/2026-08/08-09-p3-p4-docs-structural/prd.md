# P3 + P4: 文档 / 脚本质量 + 结构观察(P3-1 ~ P3-4 / P4-1 / P4-2)

## Goal

修 4 个文档 / 脚本质量问题 + 2 个结构性观察。P3 全部是可执行修复;P4 是需要决策的讨论项(不强制删除)。

## Requirements

### P3-1 注释漂移对齐

- **位置**: `docs/PLATFORMS.md:76–77, 102, 111`(过时内容:inbox-tidy enabled、cron daemon warning 文案、crontabBlock 测试位置)、`scripts/gen-assets.ts:35–37`(Skill Governance 注释已删)、`templates/workbench/AGENTS.md:27, 29`(rules below 已迁 jspace-use §8)。
- **修复**:逐条 `grep -rn` 找到真实位置改文档(或改代码让文档对)。verify.yml 加低成本 lint step:用 grep 检查 docs 中引用的代码字面量在源码里能找到。
- 0 warning 状态下跑 `bun test` 确认 doctor 文案代码字面量一致。

### P3-2 install.sh / install.ps1 跨平台一致性

- **位置**: `install/install.ps1:46`(卸载 PATH 用 `-ne` 大小写敏感,添加用 `-ieq`)→ 卸载可能留 PATH;`install/install.sh:235`(fish `set -gx PATH $BIN_DIR $PATH` 未加引号);`install.sh:50`(`head -1` 非 POSIX,应 `head -n 1`);`install.ps1:7`(注释示范 `irm ... | iex`);`JSPACE_BASE_URL` 未限制 https(本地 e2e 需要,但可被劫持;checksum 与二进制同 URL,同源劫持一起过)。
- **修复**:
  1. `install.ps1:46` 统一大小写(case-insensitive,推荐 `-ine` 或 `-cne` + 说明)。
  2. `install.sh:235` `set -gx PATH "$BIN_DIR" $PATH`(fish 引号注意)。
  3. `install.sh:50` `head -1` → `head -n 1`。
  4. `install.ps1` 注释删 `| iex` 示例或加「脚本本体不执行管道」说明。
  5. `install.sh` / `install.ps1` 开头加 `JSPACE_BASE_URL` https 校验,`JSPACE_ALLOW_INSECURE=1` 才放行非 https。

### P3-3 office-extract.py 文件名截错(Windows)

- **位置**: `skills/asset-ingest/scripts/office-extract.py:188–189` `_render_xlsx` 用 `path.split('/')[-1]`。
- **修复**:`_render_xlsx` / `_render_pptx` 用 `os.path.basename(path)`;`office-extract.test.py` 加 Windows 路径用例。

### P3-4 harness-config detect.sh 只查 macOS Cursor

- **位置**: `skills/harness-config/scripts/detect.sh:30–31`。
- **修复**:加 Linux(`~/.config/Cursor`, `~/.local/share/applications/cursor*.desktop`)和 Windows(`%LOCALAPPDATA%\Programs\Cursor`, `%ProgramFiles%\Cursor`)路径;`SKILL.md` 支持 harness 段落同步更新。

### P4-1 `.trellis/` dead weight(决策项,不强制删除)

- **位置**: `.trellis/` 全目录(40+ 文件,~200KB)。
- **观察**:从未创建过任务?—— **事实有误**:archive 下有 60+ 已归档任务,说明 `.trellis/` 在历史开发中被大量使用,只是当前 `tasks/` 目录仅含本次 issue 任务。
- **决策**:建议**保留**——当前正用 Trellis 管理本 issue;归档历史是审计资产。若仍想瘦身,改为「不进 git 或 submodule」是后续独立决策,不进本任务强制范围。

### P4-2 skill description / triggers 精简

- **位置**: 5 个 SKILL.md frontmatter(尤其 `jspace-use` / `memory-recall` description 过长;`triggers` 中「帮我找」「怎么开始」过宽)。
- **修复**:`jspace-use/SKILL.md` description 精简到 1–2 行(何时触发 + 输出是什么),产品愿景移正文;triggers 去掉过宽日常措辞。其余 skill 视情况。

## Acceptance Criteria

- [ ] `docs/PLATFORMS.md` / `scripts/gen-assets.ts` / `templates/workbench/AGENTS.md` 注释与代码一致;verify.yml 有代码字面量 lint step(或记录不做的原因)。
- [ ] `install.ps1` PATH 卸载大小写一致;`install.sh` fish 行引号 + `head -n 1`;`JSPACE_BASE_URL` https 校验(含 `JSPACE_ALLOW_INSECURE` 逃生门);`install.ps1` 注释无 `| iex` 误导。
- [ ] `office-extract.py` 用 `os.path.basename`;Windows 路径用例绿。
- [ ] `detect.sh` 支持 Linux / Windows Cursor 路径;SKILL.md 支持段落更新。
- [ ] P4-1 决策已记录(保留/删除),本任务内不强制删除 `.trellis/`。
- [ ] `jspace-use/SKILL.md` description ≤2 行,triggers 去掉过宽词。
- [ ] 全仓 `bun test` 全绿;`bunx tsc --noEmit` 通过(install 脚本 / python 不受 tsc 影响,各自跑对应回归)。

## Notes

- P4-1 与「本任务正用 Trellis」冲突,倾向保留;决策写入本文件,不删目录。
- 修改 `templates/` / skills 后检查 gen-assets 同步;skill frontmatter 改动会被 gbrain resolver 当关键词来源(memory: jspace-skill-routing-triggers),改 triggers 前确认不破坏 auto-detect。
