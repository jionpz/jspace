# Golden run — harness-config 多-harness 接线(detect → 建治理文档 → 接线 → 只读核对)

> 端到端范例:一台新机把已装 harness 接到单源治理文档 `~/.agents/agents.md`。**命令 + 预期输出示意 + 断言**,中等模型照此改参即可。
> 符号(同 SKILL.md):`$SKILL_DIR` = 本 skill 目录;`<gbrain>` = 解析后的 gbrain 二进制。`~/.agents` = **用户根目录**(`$HOME/.agents`),非项目级 `.agents/`。输出为**示意**(格式真实,具体值随机器)。

## 场景

本机装了 **Claude Code + Codex**(installed),**Pi + Cursor** 未装(not_found)。`~/.agents/agents.md` 尚不存在 → 首次建治理文档,接线 claude + codex 两个。Codex 已有一份**非空** `~/.codex/AGENTS.md`(触发守卫,演示纪律①)。

## 逐 Phase

### Phase 0 — Detect(前提:至少一个 installed)
```bash
bash "$SKILL_DIR/scripts/detect.sh"
```
预期(4 列 TSV = harness / binary / config_dir / state):
```
pi                            ~/.pi                     not_found
claude    ~/.bun/bin/claude    ~/.claude                 installed
codex     ~/.bun/bin/codex     ~/.codex                  installed
cursor                         ~/.cursor                 not_found
```
→ 接线目标 = claude + codex;pi + cursor 跳过(列入报告)。断言:≥1 个 installed(前提满足)。

### Phase 1 — Install self(幂等)
```bash
rsync -a --ignore-existing "$SKILL_DIR"/. "$HOME/.agents/skills/harness-config/"
```
预期:首跑复制全套;重跑 no-op(`--ignore-existing` 不覆盖本地已改文件)。断言:`test -d "$HOME/.agents/skills/harness-config"` 成立。

### Phase 2 — 治理文档(不存在则建)
```bash
test -f "$HOME/.agents/agents.md" && echo exists || echo "absent → 用 governance.md 骨架建"
```
预期:`absent → 用 governance.md 骨架建`
→ 复制 `references/governance.md` §3 骨架为 `~/.agents/agents.md`,确认「安全与隐私红线」在最高优先级(第 2 节)。断言:治理文档在,含红线小节。
(若已存在 → **不覆盖**,review 内容分层:harness 无关规则进,MCP/hooks/注入不进。)

### Phase 3 — Wire installed(幂等带守卫,不覆盖非空)
**Claude Code**(无既有 CLAUDE.md → 干净 symlink;此块即幂等守卫范式):
```bash
target="$HOME/.agents/agents.md"; dest="$HOME/.claude/CLAUDE.md"
mkdir -p "$(dirname "$dest")"
if [ -L "$dest" ] && [ "$(readlink "$dest")" = "$target" ]; then echo "already wired"
elif [ -e "$dest" ]; then
  [ -s "$dest" ] && { echo "non-empty $dest: merge or import, do not overwrite"; exit 1; }
  rm -f "$dest"; ln -s "$target" "$dest"
else ln -s "$target" "$dest"; fi
```
预期:首跑无输出(ln 成功)→ **wired**;重跑 → `already wired`(纪律②:幂等)。

**Codex**(同款守卫块,含 override 检查,见 `harnesses.md` Codex 节;`dest=$HOME/.codex/AGENTS.md`)。该文件**非空** → 守卫拦截:
```
non-empty ~/.codex/AGENTS.md: merge or import, do not overwrite
```
→ 纪律①:**不覆盖**。二选一并向用户说明——(a) 把原文件 harness 无关规则**并入** `~/.agents/agents.md`,确认无遗漏后再 `rm` 原文件并 symlink;(b) 保留原文件不接线,报告标 `skipped(non-empty)`。此处选 (b) 待用户定。

逐 harness 接线状态:`claude=wired(already-OK)`、`codex=skipped(non-empty)`、`pi=skipped(not_found)`、`cursor=skipped(not_found)`。

### Phase 4 — Config check(只读,不改既有配置)
```bash
<gbrain> --version                                            # CLI 可用性(只探测,不写)
grep -q gbrain "$HOME/.claude.json"      && echo "claude MCP: wired"  || echo "claude MCP: missing"
grep -q '\[mcp_servers.gbrain\]' "$HOME/.codex/config.toml" && echo "codex MCP: wired"  || echo "codex MCP: missing"
```
预期(示意):
```
gbrain 0.x.y
claude MCP: wired
codex MCP: missing
```
- **密钥卫生**(纪律③):只报「键在/不在」,不 `cat` 配置全文、不回显 token/auth 值。
- **不写入**:`missing` 由 bootstrap 或其他流程补,本 skill 只核对报告。
- 配置核对状态三态:`claude MCP=wired`、`codex MCP=missing`、`pi/cursor=n/a`(未装)。

### Phase 5 — Verify + report
```bash
ls -la "$HOME/.agents/agents.md"
readlink "$HOME/.claude/CLAUDE.md"        # 期望 → ~/.agents/agents.md
bash "$SKILL_DIR/scripts/detect.sh"        # 与 Phase 0 一致
```
Claude Code 内容层:新会话 `/context` 确认治理文档出现在 Memory files。
**报告两维词汇分清**(纪律④):
- **接线状态**(文件入口):claude=wired、codex=skipped(non-empty)、pi/cursor=skipped(not_found)
- **配置核对状态**(会话级 MCP/hooks):claude MCP=wired、codex MCP=missing、pi/cursor=n/a
- 两维不可混:接线看 symlink,配置核对看 MCP/注入,状态词各不同。

## 断言清单(照此判"做完没")
- [ ] `ls -la "$HOME/.agents/agents.md"` 治理文档在,含「安全红线(最高优先级)」小节
- [ ] `readlink "$HOME/.claude/CLAUDE.md"` == `~/.agents/agents.md`(symlink 指向对)
- [ ] `detect.sh` 与 Phase 0 / 报告一致(claude+codex installed,pi+cursor not_found)
- [ ] 非空 `~/.codex/AGENTS.md` **未被覆盖**(守卫拦截 → skipped,纪律①)
- [ ] Phase 4 只核对未写入;无 token/auth 值被回显(纪律③)
- [ ] 报告两维分清:接线状态(wired/skipped/already-OK) vs 配置核对状态(wired/missing/n/a)(纪律④)
