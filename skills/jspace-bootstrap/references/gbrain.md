# gbrain reference

## Binary resolution

`$GBRAIN_BIN` -> `which gbrain` -> `~/.bun/bin/gbrain`.

## CLI surface

- `gbrain init` - create brain (PGLite default, no server)
- `gbrain put <slug> [< file.md]` / `gbrain get <slug>` / `gbrain delete <slug>` (soft delete, recoverable)
- `gbrain list [--type T] [--tag T] [-n N]`
- `gbrain search <query>` (keyword), `gbrain query <question>` / `gbrain ask` (hybrid)
- `gbrain serve` - MCP server over stdio for harnesses
- `gbrain doctor [--json] [--fast]` - health: resolver, pgvector, RLS, embeddings
- `gbrain upgrade` / `gbrain check-update`

## Page frontmatter

Minimal contract shared by all harnesses:

```yaml
---
type: lesson | note | decision | reference | smoke   # pick one
source: codex | claude | hermes | pi | manual
project: <id>
tags: [t1, t2]
embed_skip: true   # required when no embedding is reachable
---
```

## Page type semantics (memory vs knowledge)

`type` splits pages into two roles. Keep them distinct — they feed different retrieval paths:

| type        | role                         | retrieval use           | write pattern |
|-------------|------------------------------|-------------------------|---------------|
| reference   | knowledge (asset pointer)    | stable-knowledge Q&A    | append-only   |
| lesson      | knowledge (reusable)         | stable-knowledge Q&A    | append-only   |
| decision    | memory + knowledge           | recent injection + Q&A  | fixed slug, overwrite |
| note        | memory (state/todo/progress) | recent injection        | fixed slug, overwrite |
| smoke       | discardable                  | never retrieved         | delete after use |

- Memory = current state (progress, todo, last decision); knowledge = stays true and reusable regardless of when it was written.
- Long-form knowledge bodies live in the file hub; gbrain knowledge pages are summaries + pointers, never full documents.
- Session-start injection favors recent memory; question answering favors stable knowledge with recent memory mixed in.

## Write-back discipline

Two write patterns; never mix them:

1. **Stateful memory — fixed slug, overwrite.** Progress, todos, and current decisions write to one stable slug per project/topic (e.g. `project/<id>/state`). Updating = `gbrain put` the same slug again, not a new page. Keeps "current state" retrievable as one page instead of a noisy history.
2. **Durable knowledge — append-only.** New lessons, references, and durable decisions are new pages. Never overwrite a knowledge page to reflect today; write a new page or a superseding decision.

- Every page carries `project` + `tags`; `source` marks provenance.
- Never invent a slug — derive it from project/topic + a stable identifier.
- Promotion: when a memory fact becomes durable (e.g. a lesson learned), write a new knowledge page; don't overload the state page.

## Offline / embedding policy

- Memory mixing across harnesses is a feature; `source`/`project` are provenance/trust metadata, never isolation.
- Embedding is a **default-required config** — Chinese recall depends on it (tsvector does not tokenize CJK). Configure SiliconFlow bge-m3 or local Ollama bge-m3 during bootstrap.
- If embedding is unreachable: writes must still succeed with `embed_skip: true`; retrieval falls back to keyword search (`gbrain search`) or `gbrain query` (auto-degrades to keyword), with a clear notice — never silent, never a failed write.
- Never fail a write because embedding is unavailable.
- Ingest-side policy (reference page writing + degradation notice): see `skills/asset-ingest/references/gbrain-write.md`.

## Recommended AI configuration (ask the user first; never forced)

Ask the user first; skip entirely if they decline or lack the required key. Both options are recommendations, not hard requirements — bootstrap must still succeed without them, but embedding itself is default-required for Chinese recall (see Offline / embedding policy).

### Option A - Online embedding: SiliconFlow bge-m3 (free)

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

### Option B - Chat model parity with the local harness (via cc-switch proxy)

Requires the user's harness model to be served by the cc-switch local proxy (`http://127.0.0.1:2006`; resource `cc-switch`, see `workspace/agent-infra/README.md`). Example: Codex configured with `deepseek-v4-flash`.

File layer first:

```json
// ~/.gbrain/config.json
{
  "chat_model": "litellm:deepseek-v4-flash",
  "expansion_model": "litellm:deepseek-v4-flash",
  "provider_base_urls": {
    "litellm": "http://127.0.0.1:2006/v1"
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
- Pure offline environment: fall back to local Ollama bge-m3, or write pages with `embed_skip: true` and rely on keyword search.
- Never force these options; they are recommendations. Bootstrap succeeds without them.
