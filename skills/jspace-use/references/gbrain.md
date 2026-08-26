# gbrain reference

## Binary resolution

`$GBRAIN_BIN` -> `which gbrain`(Windows `where gbrain`) -> `~/.bun/bin/gbrain`(Windows `%USERPROFILE%\.bun\bin\gbrain.exe`).

## Skill routing wiring (skillsDir)

gbrain 的 skill resolver(`autoDetectSkillsDir`)只认 `$GBRAIN_SKILLS_DIR` / 根 `skills/` 目录,**不读**工作台的 `.jspace/skills/`。未接线时,resolver 走根 `skills/`(若无则回退 gbrain 安装路径的内置 skill)——**官方 skill 路由会静默断**。接线:

```bash
jspace gbrain wire --dir <工作台>   # 把 GBRAIN_SKILLS_DIR=<工作台>/.jspace/skills 写进 ~/.claude.json 的 gbrain MCP env
```

- 接线后**重启 claude 会话**(MCP 重连)让 `gbrain serve` 以新 env 启动。
- 验证:`GBRAIN_SKILLS_DIR=<工作台>/.jspace/skills gbrain check-resolvable` 应报官方 5 skill reachable。
- `jspace doctor` 的 `gbrain.skillsdir_unwired`(info)会提示未接线。

## CLI surface

- `gbrain init` - create brain (PGLite default, no server)
- `gbrain put <slug> [< file.md]` / `gbrain get <slug>` / `gbrain delete <slug>` (soft delete, recoverable)
- `gbrain list [--type T] [--tag T] [-n N]`
- `gbrain search <query>` (keyword), `gbrain query <question>` / `gbrain ask` (hybrid)
- `gbrain serve` - MCP server over stdio for harnesses
- `gbrain doctor [--json] [--fast]` - health: resolver, pgvector, RLS, embeddings
- `gbrain upgrade` / `gbrain check-update`

## 版本兼容与升级前健康检查

- **支持范围**:本工作台按首次启用(first-use)验收通过的 gbrain 版本校准(2026-08 基线);声明「支持/已验证」= 该版本经 `gbrain doctor --json` 全绿 + 端到端验收通过。升级前用 `gbrain check-update` 查看目标版本,不跨未知大版本盲升。
- **升级前健康检查(必做)**:`gbrain doctor --json` → resolver / pgvector / embeddings 均 `ok` 才允许 `gbrain upgrade`;存在未解决项先修复再升级,不携带已知故障升级。
- **降级路径**:升级后 `gbrain doctor` 不绿 → 回退到上一已知好版本恢复,再处理根因。

## Page frontmatter

Minimal contract shared by all harnesses:

```yaml
---
type: note                                  # all pages are note; classification lives in the slug
source: codex | claude | hermes | pi | manual
project: <id>                               # owning project id (ascii); governance pages use a knowledge domain
tags: [t1, t2]                              # retrieval routing tags (see memory model below)
embed_skip: true                            # required when no embedding is reachable
---
```

**`type` is always `note`** — it carries no classification. Page role is encoded by the slug namespace (see memory model below) and routed by `tags`.

## Memory model (authoritative)

**Principle: 归属定根, 语义定叶, 写语义唯一.** Classification comes from the slug namespace — one page has exactly one home and one write semantics. `type` is uniform `note`; retrieval is routed by `tags`.

### Six namespaces

| Namespace | Write semantics | Content | Example |
|---|---|---|---|
| `project/<id>/state` | fixed slug **overwrite** | project status card: 是什么·到哪了·下一步·执行层指针·相关项目 | `project/jspace/state` |
| `project/<id>/decisions/<主题>` | **append-only, immutable** | project decision: 决定+理由+日期+关联 | `project/jspace/decisions/不封装gbrain` |
| `project/<id>/lessons/<主题>` | **append-only, immutable** | project-specific lesson / reusable point | `project/jspace/lessons/中文slug的教训` |
| `knowledge/<域>/<主题>` | **append-only, immutable** | cross-project reusable knowledge (域 = generic knowledge domain, no project name) | `knowledge/governance/记忆积累全局规则` |
| `assets/<项目id\|领域>/<语义名>` | overwrite / bump `-vN` | asset pointer page (file body stays in the asset layer) | `assets/tiyanying-52/回访登记` |
| `records/consolidate\|retro/<date>` | dated slug, same-week overwrite | periodic snapshot / retro — the **time projection** of the other layers | `records/retro/2026-08-10` |

### Three boundary judgments

1. **Belongs to a project** — names a project, changes it, or decides for it → `project/<id>/`. Code projects use the repo ascii slug (`project/wms/state`); business projects use the registered ascii id (`tiyanying-52`). Domain/technical topics never own a `project/` id.
2. **Promotes to global** — reusable across projects → `knowledge/<域>/<主题>` (域 organizes, never carries a project name). A principle-level red line is knowledge under a governance domain.
3. **Execution detail never enters gbrain** — task lists / iterations / bugs stay in the project's own framework (Trellis etc.); the state card carries only an **execution-layer pointer** field pointing at that framework, never copying its content.

### State card schema

```markdown
---
type: note
project: <ascii project id>
tags: [project]
source: <harness|skill>
---

# <项目> 现状

## 这个项目是什么·解决什么
…

## 现在到哪了
…

## 下一步
…

## 相关项目
- [[project/<其他id>/state]]   # intersection wikilink, list when present

## 执行层
- 框架: Trellis / 其他
- 入口: <repo path / board URL>
```

Update = `gbrain put project/<id>/state` overwrites the same slug, never a new page.

### Retrieval routing (type-normalized)

`gbrain list` filters by `--type` / `--tag` only (no slug-prefix filter). With `type` uniform, route by `tags`:

| tags | Pages | Retrieval use |
|---|---|---|
| `tags: [project]` | `project/<id>/state` | project injection / overview (`list --tag project`) |
| `tags: [knowledge]` | `project/<id>/lessons`, `project/<id>/decisions`, `knowledge/` | stable-knowledge Q&A |
| `tags: [asset]` | `assets/` pointer pages | asset lookup |
| `tags: [weekly]` | `records/consolidate\|retro/<date>` snapshots | weekly/retro; excluded from recent injection |

- Snapshot pages keep the existing `tags: [weekly]` mitigation (dated pages must not mix into recent injection); consolidate additionally keeps `consolidate`.
- Recent injection: `gbrain list --type note --tag project -n 50` (state cards), excluding `weekly`. Q&A: `--tag knowledge` / `--tag asset`.

### Provenance tag (which flywheel leg wrote it) — B4

Every write ALSO carries exactly one **provenance tag**, orthogonal to the routing tag above:

| tag | Written by | Meaning |
|---|---|---|
| `source:session` | any skill running **in a session** (memory-writeback, and asset-ingest / weekly-report / memory-consolidate / workbench-retro when a person triggered them) | 日常会话沉淀的写入 |
| `source:cron` | the same skills running **headless under cron** | 定时归纳产生的写入 |

- The tag is chosen by **run mode, not by skill**: the same skill writes `source:session` in a session and `source:cron` under cron. Each skill's decision table already carries a 会话 / 无头(cron) row — reuse it.
- Why a tag and not a frontmatter field: `gbrain list` filters by `--type` / `--tag` only, so a tag is the *only* thing `workbench-retro` can count. Frontmatter `source:` keeps its existing meaning (**harness** provenance: `claude` / `codex` / …) and answers a different question — do not overload it.
- Both live on the same page: `tags: [project, source:session]`, `source: claude`.
- Counting (retro 检查 1): `gbrain list --type note --tag source:session -n 50` vs `--tag source:cron -n 50`.
- **Pages written before this convention carry neither tag.** They are not "cron writes" — they are unknown-provenance, and retro must report them as a separate bucket instead of folding them into either leg.

## Write-back discipline

Two write patterns; never mix them:

1. **Stateful memory — fixed slug, overwrite.** Progress, todos, and current decisions write to the project state card (`project/<id>/state`). Updating = `gbrain put` the same slug again, not a new page. Keeps "current state" retrievable as one page instead of a noisy history.
2. **Durable knowledge — append-only.** New lessons, decisions, and knowledge pages are new pages. Never overwrite a durable page to reflect today; write a new page or a superseding decision.

- Every page carries `project` + `tags`; `source` marks provenance.
- Never invent a slug — derive it from project/topic + a stable identifier (ascii project id).
- Promotion: when a state fact becomes durable (a lesson, a settled decision), write a `project/<id>/lessons/<主题>` or `project/<id>/decisions/<主题>` page; don't overload the state card.

### Dated memory record (periodic snapshot) — M4 authorized exception

A `note` page with a **date slug** is a periodic snapshot of the memory layers (`records/consolidate/<YYYY-MM-DD>` / `records/retro/<YYYY-MM-DD>`). Each period writes a **new page** (dated slug), NOT an overwrite of a fixed slug:

- The **current state** is still owned by the fixed-slug `project/<id>/state` page (overwrite). The dated page is the historical record; never let the snapshot page substitute for `project/<id>/state`.
- Because dated `note` pages accumulate, recent-injection can mix in old snapshots — mitigate with `tags: [weekly]` (dedicated tag, as above) and rely on the state card for the "now" view.
- Same-topic snapshots are idempotent per period: re-running a period overwrites/upserts the same dated slug (never create duplicates).

## Offline / embedding policy

- Memory mixing across harnesses is a feature; `source`/`project` are provenance/trust metadata, never isolation.
- Embedding is a **default-required config** — Chinese recall depends on it (tsvector does not tokenize CJK). **默认:本地 Ollama bge-m3(零外部账号)**;可选提升:SiliconFlow bge-m3(在线,需 API key)。
- If embedding is unreachable: writes must still succeed with `embed_skip: true`; retrieval falls back to keyword search (`gbrain search`) or `gbrain query` (auto-degrades to keyword), with a clear notice — never silent, never a failed write.
- Never fail a write because embedding is unavailable.
- Ingest-side policy (reference page writing + degradation notice): see `~/.agents/skills/asset-ingest/references/gbrain-write.md`.

## Recommended AI configuration (ask the user first; never forced)

Ask the user first; skip entirely if they decline or lack the required key. Both options are recommendations, not hard requirements — first-use must still succeed without them, but embedding itself is default-required for Chinese recall (see Offline / embedding policy).

### Option A - 默认(零外部账号):local Ollama bge-m3

本地 Ollama 跑 BAAI/bge-m3(中文/多语言,1024 维),零外部账号。来源:gbrain `docs/integrations/embedding-providers.md` Ollama 小节。

```bash
ollama pull bge-m3                          # Ollama 库: BAAI/bge-m3 (1024 维)
gbrain init --embedding-model ollama:bge-m3 --embedding-dimensions 1024
gbrain providers test --model ollama:bge-m3 # 冒烟: 本地安装可用
```

- 本地提供方**不参与 env 自动探测**,必须显式 `--embedding-model ollama:<model>`。
- Ollama 默认 OpenAI 兼容端点 `http://localhost:11434/v1`(`OLLAMA_BASE_URL` 可覆盖)。
- bge-m3 = 1024 维,高于 ollama recipe 默认(nomic-embed-text 768 维),必须显式 `--embedding-dimensions 1024`(本地 recipe 信任你声明的维度)。
- Verify: `gbrain models doctor` → `embedding_config` 与 `embedding_reachability` 必须 `ok`。
- 若本机 brain 已用 SiliconFlow bge-m3(同为 bge-m3/1024 维),向量空间可互换;仍按 doctor 验证。

### Option B - 可选提升:SiliconFlow bge-m3 (online, free)

Requires a SiliconFlow API key (https://cloud.siliconflow.cn). gbrain has no SiliconFlow recipe; the `openrouter` recipe is used as an OpenAI-compatible carrier pointed at SiliconFlow.

```json
// ~/.gbrain/config.json
{
  "embedding_model": "openrouter:BAAI/bge-m3",
  "embedding_dimensions": 1024,
  "provider_base_urls": {
    "openrouter": "https://api.siliconflow.cn/v1"
  },
  "openrouter_api_key": "<SILICONFLOW_API_KEY>"
}
```

Verify: `gbrain models doctor` -> `embedding_config` and `embedding_reachability` must be `ok`.

### Option C - Chat model parity with the local harness (via a local proxy)

If the user's harness model is served by a local proxy, point gbrain's chat model at that proxy. Example below routes `deepseek-v4-flash` through a local proxy.

File layer first:

```json
// ~/.gbrain/config.json
{
  "chat_model": "litellm:deepseek-v4-flash",
  "expansion_model": "litellm:deepseek-v4-flash",
  "provider_base_urls": {
    "litellm": "http://127.0.0.1:<proxy-port>/v1"
  }
}
```

Then MUST also set the DB-plane keys - file-layer values alone get overridden at connect time:

```bash
gbrain config set models.chat litellm:deepseek-v4-flash
gbrain config set models.expansion litellm:deepseek-v4-flash
```

Why: engine connect runs `reconfigureGatewayWithEngine()` -> `resolveModel()` with precedence `models.chat/models.expansion (DB) -> models.default -> models.tier.<tier> -> tier default (Anthropic) -> file-layer fallback`. With no DB keys set, the Anthropic tier default wins and `gbrain models doctor` reports `auth` / `requires ANTHROPIC_API_KEY`.

Verify: `gbrain models doctor` -> `chat` and `expansion` must resolve to `litellm:deepseek-v4-flash` and be `ok`. Smoke test (then clean up): `printf 'test\n' | gbrain put _probe; gbrain query "test"; gbrain delete _probe`.

### Notes

- Internal ops (`models.dream.*`, `models.think`, `models.auto_think`, `models.subagent`, `facts.extraction_model`) still route to Anthropic tier defaults. To unify them too: `gbrain config set models.default litellm:deepseek-v4-flash` (subagent tier is Anthropic-only and falls back with a warning).
- 默认本地 Ollama bge-m3(Option A)已覆盖零外部账号场景;若本地无可用 embedding,写页以 `embed_skip: true` 保底 + 检索显式降级(见 Offline / embedding policy)。
- Never force these options; they are recommendations. First-use succeeds without them.
