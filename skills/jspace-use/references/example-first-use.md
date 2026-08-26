# Golden run — jspace-use 全新工作台首次启用(first-use,第 2 章端到端)

> 端到端范例:一个刚 `jspace init` 出来的空工作台,配到「gbrain 可召回 + filehub 闭环 + Claude Code 已接线」。**每 Phase = 关键命令 + 预期输出示意 + 验证断言**,中等模型照此改参即可。
> 命令输出为**示意**(gbrain 二进制当前不在本机 PATH;jspace 命令输出按契约构造并标注示意);具体值随环境。

## 场景

全新工作台根目录 `~/jworkspace`(已 `jspace init`,`.jspace/hub.json` 已生成)。用户选择:harness = **Claude Code**、filehub 根 = 本地目录 **`~/filehub`**、embedding = **默认本地 Ollama bge-m3**(零外部账号)。

## Phase 0 — Prerequisites(检测,不默认远程安装)

```bash
command -v git   # → /usr/bin/git
command -v bun   # → (无输出,退出码 1)
```
`bun` 缺失。**治理红线:不默认跑 `curl -fsSL https://bun.sh/install | bash`**。做法:
1. 给官方来源 `https://bun.sh/docs/installation`,把安装脚本**下载到临时文件**:`curl -fsSL https://bun.sh/install -o /tmp/bun-install.sh`。
2. 展示核验:`less /tmp/bun-install.sh`(或对照官方 checksum),向用户说明将执行什么。
3. **用户确认后**再 `bash /tmp/bun-install.sh`;拒绝则停在此 Phase,报「缺 bun,已给来源待确认」,不擅自执行。

断言:`command -v git && command -v bun` 均返回路径(用户确认装完后)。

## Phase 1 — 装 gbrain(first core)

```bash
# 二进制解析:$GBRAIN_BIN → command -v gbrain → ~/.bun/bin/gbrain
bun install -g gbrain
ollama pull bge-m3    # Ollama 库:BAAI/bge-m3(1024 维)
gbrain init --embedding-model ollama:bge-m3 --embedding-dimensions 1024
gbrain doctor --json          # 示意
gbrain models doctor --json   # embedding_config / embedding_reachability
```
预期(示意):
```json
{ "resolver": "ok", "pgvector": "ok", "embeddings": "ok" }
{ "embedding_config": "ok", "embedding_reachability": "ok" }
```
- **若 `embedding_reachability` != ok**(Ollama 未起 / 模型没拉):**不失败**。写页一律带 `embed_skip: true` 保底,检索显式降级为关键词(`gbrain search`),给「embedding 不可用,当前关键词检索,中文命中率可能偏低」提示——首次启用继续,不因 embedding 中断写入。

smoke 后清理(不留探针页):
```bash
printf '---\ntype: note\ntags: [smoke]\nembed_skip: true\n---\nprobe\n' | gbrain put smoke/first-use
gbrain get smoke/first-use && gbrain delete smoke/first-use
```
断言:`gbrain doctor --json` resolver/pgvector 全 `ok`;smoke 页 put→get→delete 三步通过。细则 `~/.agents/skills/jspace-use/references/gbrain.md`。

## Phase 2 — Registry health

```bash
jspace doctor --dir .            # 编译二进制在 PATH;源码检出则 bun run cli/main.ts
jq .jspace/hub.json >/dev/null   # 合法 JSON
```
预期(示意):
```
✓ hub.json schema_version 1   ✓ domains ↔ workspace/ 一致   ✓ 每资源恰一 primary
⚠ resource <x> 外部路径未绑定(warning,不阻塞)
```
断言:`jspace doctor` 退出 0;缺外部路径只报 warning,不视为失败。细则 `~/.agents/skills/jspace-use/references/registry.md`。

## Phase 3 — File center(含首启验收闭环)

问用户选 filehub 根(此处本地 `~/filehub`):
```bash
jspace filehub init ~/filehub --register   # 建骨架 + 注册 type:filehub(hub+local 一并维护)
```
**首启验收(首次启用真正的"能用"证明)**:放一份示例文件进 `_inbox/`,跑一次「整理一下 inbox」,确认 **入库 → gbrain 页 → 中文召回** 闭环:
```bash
cp ~/Downloads/某份示例资料.md ~/filehub/_inbox/
# 触发 asset-ingest:ingest begin → advance --gbrain → --index → --complete(见 asset-ingest skill)
gbrain query "<该资料的中文关键措辞>"
```
断言:`~/filehub` 骨架 + `_inbox/` 存在;hub.json 出现 `type:filehub` 资源;上面 `gbrain query` top-1 == 刚入库页(embedding 不可达则关键词降级命中)。**暂不配 filehub → 告知降级暂存区,不阻塞后续 Phase**。

## Phase 4 — Harness wiring(用户选 Claude Code)

Claude Code 走 MCP,写 `~/.claude.json` 的 `mcpServers.gbrain`(`command` = gbrain 二进制**绝对路径**):
```json
{ "mcpServers": { "gbrain": { "command": "/Users/<you>/.bun/bin/gbrain", "args": ["serve"], "type": "stdio" } } }
```
断言:`~/.claude.json` 有 `mcpServers.gbrain`;重启 Claude Code 后 `/mcp` 见 gbrain 已连。只接线用户选的这一个,不代装其余 harness。细则 `~/.agents/skills/jspace-use/references/harnesses.md`。

接线后补一步 gbrain skill 路由:
```bash
jspace gbrain wire --dir .   # GBRAIN_SKILLS_DIR=<工作台>/.jspace/skills 注入 gbrain MCP env
```
重启 Claude Code 让 `gbrain serve` 以新 env 启动(否则 resolver 只认根 `skills/` 或回退内置 skill)。细则 `~/.agents/skills/jspace-use/references/gbrain.md`「Skill routing wiring」。

## Phase 4.5 — Scheduled tasks(必须问一次,默认推荐开)

出厂 `.jspace/cron.json` 四个任务全 `enabled: false`。**先念代价再问**:不开 = inbox 只在想起来时才整理、没有周报/周记忆巩固页、纪律腐化没人取证(三个飞轮各停一条腿)。用户答"开":

```bash
for id in inbox-tidy weekly-report memory-consolidate workbench-retro; do jspace cron enable "$id" --dir .; done
jspace cron run inbox-tidy --dir .    # rehearsal:先手跑验证契约(逐个跑一遍最稳)
jspace cron install --dir .           # 装进系统调度(此处 macOS launchd)
jspace cron status --dir .
```
预期(示意):
```
jspace: ok: enabled cron inbox-tidy
jspace: ok: installed 4 task(s) into launchd (tag JSpaceCron_<tag>)
inbox-tidy        last: ok 2026-08-26 21:00   next: 2026-08-27 21:00
```
断言:`jspace cron status` 四条都显示已安装;`jspace doctor --dir . --verbose` 不再报 `cron.all_disabled`,且无 `cron.not_installed`。

用户答"先不开":标 `deferred`,告知 `jspace doctor --verbose` 会持续报 `cron.all_disabled`(info,不失败;info 默认只计数不打印),想开时回到本 Phase——**不许默默跳过不问**。

## Phase 5 — Final smoke + sign-off

```bash
jspace doctor --dir .     # 注册表通过
jq .jspace/hub.json       # 合法 JSON
gbrain doctor --fast      # brain 健康
```
按三态报告:
- **configured**:gbrain(Ollama bge-m3)、filehub `~/filehub`、Claude Code MCP。
- **already-OK**:git 本已装。
- **missing-deferred**:其余 harness(用户未选,未接线)。

## 断言清单(照此判"做完没",对齐 SKILL.md 自检)
- [ ] `jspace doctor --dir .` 退出 0(注册表通过;缺外部路径仅 warning)
- [ ] `gbrain doctor --fast` brain 健康
- [ ] `jq .jspace/hub.json` 合法 JSON,含 `type:filehub` 资源
- [ ] Phase 3 「放一份文件跑 inbox 整理」闭环成立(`gbrain query` 命中入库页)
- [ ] Phase 0 缺失工具走「下载临时文件 → 核验 → 用户确认」,未默认远程管道执行
- [ ] embedding 不可达时写页 `embed_skip: true` 保底,首次启用未因此失败
- [ ] Claude Code `mcpServers.gbrain` 已写入 `~/.claude.json`
- [ ] Phase 4.5 cron 问过用户:开了则 `jspace cron status` 显示已安装且 `doctor --verbose` 无 `cron.all_disabled`;跳过则明确标 `deferred`(未默默略过)
