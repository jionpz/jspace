# 架构澄清与可持续演进重构 — Technical Design

## 1. Design Objective

把当前“CLI 文件 + 模板 + prose skills”的隐式组合，收敛为三组明确契约：

1. **State contracts**：portable control plane、machine-local bindings/runtime、gbrain、filehub。
2. **Execution contracts**：command → use case → adapter，scheduler 与 CLI 共用 invocation。
3. **Distribution contracts**：binary、template、schema migration、skill manifest 与 workbench upgrade。

不增加 daemon，不包装 gbrain 检索，不建立动态插件市场。

## 2. Target Architecture

```text
CLI command specs
        |
        v
Application use cases  <----- semantic plans from skills
        |
        +--> Core contracts (Hub / Project / Cron / Skill / Upgrade)
        |
        +--> Filesystem + workbench repository
        +--> Scheduler adapters (launchd / crontab / schtasks)
        +--> Harness adapters (claude / codex / pi)
        +--> gbrain CLI/MCP boundary (external, not wrapped as a JSpace API)

Portable workbench (git)     Machine-local state (gitignored)
  hub.json                     local.json
  cron.json                    scheduler bindings
  domain/project context       runs/incidents/pending
  skill manifest               logs

                       gbrain memory     filehub assets
```

## 3. Module Boundaries

Target source layout; dependency direction is fixed. Naming/grouping is allowed to adjust per child task（实际结构见 §3.1）：

```text
cli/
  commands/          # declarative command specs + argument codecs
  main.ts            # parse, dispatch, render result
core/
  schema/            # hub/local/project/cron/skill/manifest codecs
  models/            # typed domain objects and invariants
application/
  workspace/         # init, diff, upgrade, doctor
  registry/          # domain/resource/project use cases
  automation/        # cron definition/run/reconcile/incident
adapters/
  fs/                # atomic files, manifests, repositories
  scheduler/         # launchd, crontab, schtasks
  harness/           # argv generation and capability matrix
templates/
skills/
```

Rules:

- `core` has no console, process cwd, platform command or filesystem side effects.
- `application` returns structured results/plans and consumes interfaces.
- `adapters` own platform/process/filesystem details.
- `cli` owns user-facing syntax and rendering only.
- Templates and docs consume the same generated schema/manifest data where practical; duplicated prose is checked by contract tests.

### 3.1 Current layout（2026-08-04，Child A 落地后）

Child A 已建立的实际结构；后续 child 在既有层内扩展，`application/` 与 `adapters/{scheduler,harness}/` 尚未创建：

```text
core/
  contracts/       # typed codecs: hub/local/workbench/distribution/ids/paths/diagnostics/files（含纯 decoder）
  registry/        # effective registry（portable+local 合并）+ inspect（分级 drift 诊断）
adapters/
  fs/              # workbench-state（marker/local 原子写）
cli/
  args.ts          # 手写 parser + dispatch（Child B 收敛为 declarative CommandSpec）
  cron.ts          # cron 定义 + launchd/crontab/schtasks + run/install/status/check/failures
  init.ts  update.ts  registry.ts  cmds.ts  embed.ts  errors.ts
```

`core/contracts` 相当于上图的 `core/schema`；`core/registry` 是新出现的应用侧纯层。`application/` 尚不存在——init/doctor/domain/resource 等 handler 仍在 `cli/` 内，由 Child B 迁出。

## 4. State Model

### 4.1 Portable hub v4

`hub.json` owns logical identities only:

```json
{
  "version": "4",
  "domains": [{ "id": "files", "path": "workspace/files", "tags": [] }],
  "projects": [{ "id": "acme", "domain": "sales", "asset_rel_path": "projects/acme", "status": "active" }],
  "resources": [{
    "id": "filehub",
    "type": "filehub",
    "domain": "files",
    "entrypoints": [{ "id": "path", "kind": "path", "binding": "filehub-root", "primary": true }]
  }]
}
```

URL entrypoints may retain portable URLs. Path entrypoints reference a binding key instead of carrying an absolute value.

### 4.2 Machine-local bindings

`.jspace/local.json` is gitignored and owns machine truth（已落地：`core/contracts/local.ts` 的 `LocalStateV1`）：

```json
{
  "version": 1,
  "installation_id": "…",
  "bindings": {
    "filehub-root": "/Users/example/filehub"
  }
}
```

Doctor resolves hub + local into an effective registry and reports unbound or missing paths distinctly. Secret values remain outside both files.

**Schema evolution（前瞻预留）**：`LocalStateV1` 严格拒绝未知字段。后续 Child B/C 需要把 `harnesses` / `scheduler` 等本机事实纳入 local.json 时，必须 bump `version` 到 2 并提供显式 migration（升级动作由 Child B 的 upgrade journal 承载），不得在 v1 上追加字段。

### 4.3 Runtime state

`.jspace/state/` and `.jspace/logs/` are gitignored:

- `runs/<cron>/<run-id>.json` — structured status metadata.
- `incidents/<incident-id>.json` — open/acknowledged/resolved state.
- `pending/<id>.json` + payload — versioned gbrain deferred write with idempotency key.
- scheduler adapter binding snapshots for reconciliation.

Markdown logs may remain as human-readable payloads, but status computation must not parse ad-hoc prose.

**Migration target（2026-08-04）**：`.jspace/state/` 目录已在模板 `.gitignore` 预留但尚无结构；当前失败状态在 `.jspace/logs/cron-failed.md`（prose，见 `cli/cron.ts:531,687`），pending gbrain write 在 `<filehub>/.jspace-logs/*.APPLY.md`（`cli/cron.ts:712-716`）。Child C/D 的目标是把这两处迁移为上述结构化状态——本小节是目标态而非当前态。

## 5. Command Model

A `CommandSpec<TArgs>` is the single source for name, aliases, options, positionals, help, parse codec and handler. The first child task may keep the current hand parser implementation internally, but duplicated choices/help/switch surfaces must disappear.

Recommended user surface:

```text
jspace init
jspace doctor [--dir] [--json]
jspace workspace diff|upgrade
jspace domain list|get|add|update|remove
jspace resource list|get|add|update|remove
jspace project list|get|add|link|archive
jspace filehub init|status
jspace inbox status
jspace cron add|edit|enable|disable|remove|list|run|rehearse
jspace cron install|uninstall|status|check|retry|ack
jspace update
```

Compatibility aliases may exist during development, but no published deprecation framework is needed.

Structured conventions:

- Read/status: optional `--json`, exit 0 unless the command contract explicitly represents unhealthy state (`doctor`, `cron check`).
- Workspace selection: a shared context resolver accepts explicit `--dir`, then cwd.
- External mutation: return an inspectable plan; `--dry-run` never changes system state.
- Errors: typed category + stable exit code + human message; stack traces only for unexpected faults.

## 6. Project Aggregate

Project is promoted to a portable identity, not a new heavy subsystem.

`project add/link` owns:

1. hub project record;
2. `filehub/projects/<id>/index.md` skeleton or resolved existing path;
3. domain README project index entry;
4. a machine-readable plan for memory-writeback to initialize `project/<id>/state`.

Because gbrain is external, steps use a journal + compensation model. Doctor checks missing filehub/index/domain links and optionally emits a repair plan; it does not silently invent project facts.

## 7. Scheduler and Harness Design

### 7.1 Shared invocation

Application creates a typed `CronRunInvocation { workbench, cronId, timeout?, force? }`. The CLI codec and scheduler adapters serialize from the same object. Contract tests feed serialized argv back through the parser.

### 7.2 Scheduler reconciliation

Each adapter implements:

```text
inspect(workbenchId) -> InstalledTask[]
plan(desired, installed) -> create/update/delete operations
apply(plan) -> operation results
```

Identifiers include a stable workbench ID on every platform. Install removes disabled/deleted/stale tasks for that workbench only. Uninstall never removes another workbench's tasks.

### 7.3 Cron task target

Cron v2 supports explicit target kinds:

- built-in skill target: `{ kind: "skill", skill, entrypoint, input }`;
- advanced custom prompt: `{ kind: "prompt", prompt }`.

Default inbox/weekly/consolidate jobs use skill targets so required skill presence and contract version can be checked before install. The harness adapter compiles target + workbench context into argv.

### 7.4 Incident lifecycle

- failed/suspect run opens or updates an incident keyed by cron + failure class;
- successful retry can resolve the incident automatically;
- `cron ack` records that the user saw a still-open incident without deleting evidence;
- `cron check` returns non-zero only for unacknowledged open incidents or actionable pending writes.

## 8. Workbench Distribution and Upgrade

The embedded bundle contains an explicit manifest:

```text
path
content hash
asset version
ownership: managed | seed | user
conflict policy
```

- `managed`: distribution may update when unmodified; local modification yields conflict.
- `seed`: created only when absent; future upgrade never overwrites.
- `user`: schema-validated but never supplied as authoritative content.

`workspace diff` compares installed marker/manifest with the running binary and reports create/update/conflict/migrate. `workspace upgrade` requires a clean plan, writes backups/journal, applies atomically where possible, then runs doctor. Binary rollback does not imply workspace rollback; workspace upgrade owns its own recovery snapshot.

## 9. Skill Lifecycle

`skills-manifest.json` records required workbench skills and global optional skills. Init and upgrade consume it; tests verify AGENTS/resolver declarations against it.

Minimum workbench skills:

- `jspace-bootstrap`: first-use configuration and verification.
- `asset-ingest`: semantic classification and asset write workflow.
- `memory-recall`: cited read-side recall.
- `memory-writeback`: durable session-fact writeback.

`harness-config` remains global and is installed/referenced explicitly rather than accidentally assumed present.

Lifecycle capability matrix labels each harness operation as `automated`, `best_effort`, `manual`, or `unsupported`. Product docs may only say “automatic” for verified automated paths.

## 10. Asset-Ingest Recovery

The semantic skill first writes an ingest plan containing source, target, slug, index entry and content hash. Execution follows a journaled sequence with compensations:

1. validate source/target/duplicate state;
2. stage target without losing the source;
3. write or stage gbrain reference;
4. update project index idempotently;
5. commit target and remove source;
6. mark journal complete.

On failure, restore inbox/source visibility and remove only artifacts created by the current journal. Existing knowledge pages are never overwritten without the explicit repair/version decision.

## 11. Security and Compatibility

- Remote installers are downloaded to a temporary file, source/host/checksum are shown or verified, and execution requires user approval.
- gbrain compatibility is declared in the distribution manifest and checked before `upgrade`.
- No configs/logs echo credentials or provider env values.
- Network endpoint changes remain explicit user decisions.

## 12. Rollout and Rollback

This repository is treated as pre-release: implement the new state baseline directly, with fixtures covering the current internal layout only for development confidence.

Each child task must preserve a green temporary-workbench path. Risky migrations and scheduler changes ship with plan/dry-run first. No child task may install/uninstall real scheduler state during automated tests.

