---
name: jspace-bootstrap
description: "**首次配置** JSpace 工作台(需已装至少一个 harness):装 gbrain 统一记忆库(PGLite+知识图谱+本地 embedding)、校验注册表、接线所选 harness(MCP/CLI + 会话注入/写回)。Use when 初始化/配置 jspace、registry broken、gbrain missing、fresh environment。Do NOT use for 机器级多-harness 全局治理接线(→harness-config)或日常资料入库(→asset-ingest)。"
triggers:
  - "initialize jspace"
  - "setup jspace"
  - "configure jspace"
  - "first-use jspace"
  - "workbench broken"
  - "registry broken"
  - "gbrain missing"
  - "wire gbrain"
  - "fresh environment"
---

# jspace-bootstrap — 工作台首次配置

端到端 bootstrap 一个全新 JSpace 工作台。**按 Phase 顺序执行,不跳验证步**,末尾报 checklist。

## 何时用 / 何时不用
- ✅ 用:全新工作台首配 / registry 坏 / gbrain 缺失或未接线。
- ❌ 不用:配置**机器级**多-harness 全局治理文档(`~/.agents/agents.md` 单源接线)→ `harness-config`;日常把资料入库 → `asset-ingest`。
- **前提**:至少一个 harness(Pi/Claude Code/Codex/Cursor)已装且可用;本 skill 不装 harness。

## 决策表

| 判断 | 取值 | 动作 |
|---|---|---|
| 缺失工具(bun/git) | 缺 | 给官方安装命令+来源,**默认不执行**(治理红线:下载临时文件→展示核验→用户确认后跑) |
| embedding | 默认(零账号) / 提升 / 不可达 | 本地 Ollama bge-m3 / SiliconFlow bge-m3(需 key) / `embed_skip: true` 保底(bootstrap 不失败) |
| filehub 根 | Obsidian / 本地 / 网盘 / 暂不配 | `jspace filehub init <根> --register` / 同左 / 同左 / 降级暂存区(告知) |
| harness 接线 | 用户选一个 | 按 Phase 4 表 wire 那一个 |

## 命令速查

```bash
gbrain init                                   # 建 brain(PGLite,默认无 server)
gbrain init --embedding-model ollama:bge-m3 --embedding-dimensions 1024  # 本地 embedding
gbrain doctor --json                          # brain/resolver/embeddings 健康
gbrain models doctor --json                   # embedding_config + embedding_reachability
jspace doctor --dir .                         # 注册表校验(缺外部路径=warning)
jspace filehub init <根> --register           # 建 filehub 骨架 + 注册 type:filehub
# smoke(用后清理,不留探针页)
printf '---\ntype: smoke\nembed_skip: true\n---\nprobe\n' | gbrain put smoke/bootstrap
gbrain get smoke/bootstrap && gbrain delete smoke/bootstrap
```

## Phase 骨架(顺序执行)

0. **Prerequisites**:检测 bun/git;缺失按决策表(不默认远程管道安装)。
   - bun 缺失(装 gbrain 需要):官方脚本 `curl -fsSL https://bun.sh/install | bash`(macOS/Linux)或 `powershell -c "irm bun.sh/install.ps1 | iex"`(Windows)——**默认不执行**(`curl | bash` 一类,治理红线)。
   - 确需安装:① 下载临时文件、不直接管道执行(`curl -fsSL https://bun.sh/install -o /tmp/bun-install.sh`);② 展示来源(bun.sh 官方)+ 抽查脚本核验;③ **用户显式确认后**才 `bash /tmp/bun-install.sh`。
1. **装 gbrain**(first core):解析二进制 → `bun install -g gbrain` → `gbrain init` → `gbrain doctor --json` 修所报 → embedding(默认 Ollama bge-m3)→ smoke 后清理。细则 `references/gbrain.md`。
2. **Registry health**:`jspace doctor --dir .`;`hub.json` 合法 JSON;域文件夹/id 一致;每资源恰一 primary。细则 `references/registry.md`。
3. **File center**:问用户选 filehub 根(默认第一选择 Obsidian 文件夹)→ `jspace filehub init <根> --register`;暂不配则告知降级暂存区。**首配验收**:放一份示例文件进 `_inbox/` 跑一次「整理一下 inbox」,确认入库→gbrain 页→中文召回闭环。
4. **Harness wiring**:问用户用哪个 harness,wire 那一个(MCP/CLI + 会话注入/写回)。细则 `references/harnesses.md`。
5. **Final smoke + sign-off**:`jspace doctor` + `jq hub.json` + `gbrain doctor --fast`;报 configured/already-OK/missing-deferred。

## 按需深入(条件读指针)

- gbrain 安装/embedding 三方案/frontmatter schema/离线策略 → `references/gbrain.md`
- registry schema(hub v4 / local / marker)/drift 规则 → `references/registry.md`
- 逐 harness 接线(Pi/Claude/Codex/Cursor + 跨平台路径 + lifecycle 矩阵)→ `references/harnesses.md`
- 无头执行运维(账号/配额/失败可见性)→ `references/headless-ops.md`

## Golden run

首配端到端范例(gbrain → registry → filehub → wiring → 首配验收)见 `references/example-bootstrap.md`。

## 自检(做完跑这条)

```bash
jspace doctor --dir .        # 注册表通过
gbrain doctor --fast          # brain 健康
jq .jspace/hub.json           # 合法 JSON
```
(首配真正验收 = Phase 3 的「放一份文件跑 inbox 整理」闭环成立)

## 参考
- `references/gbrain.md` — gbrain 安装/embedding/schema/离线策略
- `references/registry.md` — 注册表 schema + drift
- `references/harnesses.md` — 逐 harness 接线 + lifecycle 矩阵
- `references/headless-ops.md` — 无头运维(账号/配额/失败可见性)
- `references/example-bootstrap.md` — golden run(S5 产出)

> **Note**:新工作台 skill 只随 `jspace init` 复制,既有工作台不自动回填;要拿到新 skill 需 `jspace init --force .` 或手动复制。
