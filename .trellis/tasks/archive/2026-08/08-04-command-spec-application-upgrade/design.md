# CommandSpec、application 层与 workspace 升级 — Technical Design

## 1. Design Objective

Converge the command surface from "hand-rolled parser + scattered handlers" into a single **declarative CommandSpec registry** feeding a shared parser/validator/renderer, and give workbenches a **manifest-driven diff / upgrade / ownership / recovery** lifecycle. This closes parent R3 (stable, evolvable CLI contract) and R4 (separate CLI vs workbench lifecycle).

Scope boundary (user-confirmed): cron commands are **registered in the registry** (single source) but their handlers stay delegated to the existing `cmdCron*` implementations — the cron use-case migration belongs to Child C. `project` CLI, local v2, skill manifest lifecycle and asset-ingest recovery are out of scope.

## 2. Baseline (confirmed)

| Fact | Evidence |
| --- | --- |
| Command definitions are triplicated: `*_CHOICES` constants, `*_HELP` texts, `parseXXX` switch. | `cli/args.ts:21-26`, `cli/args.ts:55-299`, `cli/args.ts:416-768` |
| Handlers live in `cli/` and print directly (`console.log(JSON.stringify(...))`). | `cli/init.ts`, `cli/cmds.ts`, `cli/cron.ts`, `cli/update.ts` |
| Workbench root resolution is inconsistent: `workbenchRoot() = cwd`; only `doctor` and `cron run` accept `--dir`. | `cli/registry.ts:22-24`, `cli/args.ts:473-483,736-749` |
| Only `cron run` supports `--dry-run`. | `cli/args.ts:258-268` |
| `gen-assets.ts` emits a content map only; `DistributionManifestV1` contract exists but is unused. | `scripts/gen-assets.ts:32-42`, `core/contracts/distribution.ts` |
| `init --force` re-materializes over an initialized workbench. | `cli/init.ts:27-31,47` |
| `materializeTree` replaces `__DEV_ROOT__`, but templates/skills currently contain **no** such placeholder (documentation mentions it only). Replacement is a compatibility no-op today. | `cli/embed.ts:75-101`; grep of `templates/`, `skills/` |
| marker v1 (`workbench_id`, `template_version`) is the upgrade version anchor. | `core/contracts/workbench.ts`, `cli/init.ts:54-61` |
| No test locks argparse error-message text (cron/update test pure functions, init tests artifacts). | `cli/{cron,update,init}.test.ts` |

## 3. Target Architecture

```text
cli/main.ts                      # argv -> registry dispatch -> render
cli/commands/*.ts                # CommandSpec declarations (name/options/help/handler binding)
  registry.ts                    # top-level COMMANDS[] tree
application/commands/
  command.ts                     # CommandSpec types + parse engine + help generation + render (pure)
application/workspace/
  init.ts  doctor.ts             # use cases (return CmdResult)
  diff.ts  upgrade.ts            # manifest diff / upgrade lifecycle
application/registry/
  domain.ts  resource.ts         # use cases
  filehub.ts  inbox.ts
core/contracts/…                 # untouched pure contracts (hub/local/workbench/distribution)
core/registry/…                  # effective + inspect (consumed by doctor use case)
adapters/fs/workbench-state.ts   # atomic writes + materialization journal
cli/args.ts                      # DELETED after migration (replaced by registry)
```

Rules (parent design §3): `core` stays side-effect-free; `application` returns structured results/plans; `cli` owns syntax + rendering; cron handlers remain in `cli/cron.ts` until Child C.

## 4. CommandSpec Model

### 4.1 Types (`application/commands/command.ts`)

```ts
export interface PositionalSpec {
  name: string;
  required?: boolean;                    // default: true when it is the only positional
  rest?: boolean;                        // consume all remaining positionals
  validate?: (value: string) => string | null; // error message or null
  help: string;
}

export interface OptionSpec {
  name: string;                          // "--dir"
  takesValue: boolean;
  required?: boolean;
  repeatable?: boolean;                  // store-append (--tag)
  group?: string;                        // mutual-exclusion group id
  validate?: (value: string) => string | null;
  metavar?: string;
  help: string;
}

export interface OptionGroup {
  id: string;
  members: string[];                     // option names
  required: boolean;                     // "one of members is required"
  message: string;                       // e.g. "one of the arguments --path --url is required"
}

export interface CommandFeatures {
  dir?: boolean;                         // inject common --dir (workbench commands)
  json?: boolean;                        // inject --json (read/status)
  dryRun?: boolean;                      // inject --dry-run (mutating)
}

export interface CommandSpec<T = Record<string, unknown>> {
  name: string;
  aliases?: string[];
  summary: string;                       // one line for parent help
  features?: CommandFeatures;
  options?: OptionSpec[];
  positionals?: PositionalSpec[];
  groups?: OptionGroup[];
  children?: CommandSpec<unknown>[];     // subcommands
  customHelp?: string;                   // full help text override (rare; e.g. cron run usage note)
  handler?: (ctx: CmdContext, args: T) => CmdResult | Promise<CmdResult>;
}
```

`CommandFeatures` lets the engine inject `--dir` / `--json` / `--dry-run` into help text and arg collection once, instead of each spec repeating them. `handler` is optional for pure namespace nodes (`jspace domain`).

### 4.2 Engine responsibilities

- **Help generation**: build usage + positionals/options/children blocks from the spec, matching the current `*_HELP` text shape; `customHelp` wins when present.
- **Collect**: reuse the current `collect()` semantics (`cli/args.ts:341-392`) — `--opt=value`, `--` terminator, argparse-style "option starting with `-` is never consumed as a value", last-value-wins for store actions, append for repeatables.
- **Validation order** (mirrors argparse): unknown choice → missing required option/positional → mutual-exclusion group → per-option `validate` → extra positional. Error messages keep the current wording (`the following arguments are required: …`, `argument --path: not allowed with argument --url`, …).
- **Dispatch**: walk `COMMANDS[]` children against argv; return `{ spec, args, help? }`. Errors throw the existing `ArgError` (`usage`, `prog`, message) → exit 2 in `cli/main.ts`.

### 4.3 Shared context and result

```ts
export interface CmdContext {
  json: boolean;
  dryRun: boolean;
  dir: string | undefined;               // --dir
  root: string;                          // resolvePath(expandTilde(dir ?? cwd))
  cwd: string;
}

export interface CmdResult {
  exitCode?: number;                     // default 0; doctor/cron-check use 1 for unhealthy
  lines: string[];                       // human output lines
  data?: unknown;                        // structured payload for --json
  warnings?: string[];
}
```

- `render(ctx, result): string[]` is pure: JSON mode → `JSON.stringify(result.data, null, 2)` (when `data` defined); else `result.lines`; warnings print to stderr as `jspace: warning: …`. `cli/main.ts` prints the returned lines; no command prints JSON itself anymore.
- Business failure keeps `fail()` / `CliError` (exit 1). `doctor`/`cron check` encode unhealthy state via `exitCode: 1` while still printing diagnostics.

## 5. Command Registration & Migration

### 5.1 Registry (`cli/commands/registry.ts`)

```ts
export const COMMANDS: CommandSpec[] = [
  initSpec, doctorSpec, domainSpec, resourceSpec,
  filehubSpec, inboxSpec, cronSpec, updateSpec, workspaceSpec,
];
```

Top-level choices/help are generated from this array; the current `TOP_CHOICES`, `*_HELP` constants and the `parseArgs` switch (`cli/args.ts`) are deleted once every command is registered.

### 5.2 Migration sequence (non-cron first, cron last within this task)

- **Non-cron** (`init`, `doctor`, `domain/*`, `resource/*`, `filehub/*`, `inbox/*`, `update`): register specs whose handlers call the new application use cases (see §6). `update` keeps `cmdUpdate` behind a thin spec handler (network logic stays in `cli/update.ts`).
- **Cron**: register full specs (`add/list/remove/install/uninstall/run/status/failures|check`) so the parser single-sources them, but handlers **delegate** to existing `cmdCron*` via a small adapter:

```ts
function delegate(impl: (...args: unknown[]) => void | Promise<void>): Handler {
  return async (_ctx, args) => { await impl(...Object.values(args)); return { lines: [] }; };
}
```

Delegated handlers may set `process.exitCode` themselves (e.g. `cmdCronFailures`) — the renderer leaves it intact. This keeps the cron CLI surface byte-for-byte identical while satisfying R3 single-source now; Child C replaces the delegates with real use cases.

### 5.3 Context adoption

All workbench specs declare `features: { dir: true }`; the engine resolves `root` once. `doctor --dir` and `cron run --dir` keep their current semantics (the `--dir` option becomes engine-injected, not per-spec).

## 6. Application Use Cases

Each use case takes `(root, …)` and returns `CmdResult`; it consumes core contracts + adapters, never `process` output.

| Use case | Source handler moved | Notes |
| --- | --- | --- |
| `init` | `cli/init.ts cmdInit` | plus writes materialization journal (§8.3); applies the `--force` ban (§9) |
| `doctor` | `cli/cmds.ts cmdDoctor` | wraps `inspectWorkbench` diagnostics; JSON output keeps `code`/`severity`; exit 1 on errors |
| `domain list/add/remove` | `cmdDomain*` | `list` JSON = `{ domains: […] }`; `add/remove` use `writeHubAtomic` + skeleton rollback |
| `resource list/add/remove` | `cmdResource*` | `list` JSON keeps current `entrypoints` shape; paired `writeHubAndLocal` |
| `filehub init` | `cmdFilehubInit` + `registerFilehub` | filehub skeleton is `templates/filehub/**` materialized on demand |
| `inbox status` | `cmdInboxStatus` | JSON `{ inbox, count, files }` unchanged |
| `workspace diff/upgrade` | new | §8 |

Use cases keep the existing guard semantics (id validation, `isWithin`, duplicate checks, orphan-binding checks) by reusing `cli/registry.ts` helpers or moving them to `application/`.

## 7. Bundle Manifest & Freshness

### 7.1 Manifest generation (`scripts/gen-assets.ts`)

Extend the existing walk to also emit `cli/manifest.generated.ts`:

```ts
export const BUNDLE_MANIFEST: DistributionManifestV1 = {
  version: 1,
  bundle_version: VERSION,                    // marker.template_version anchor
  files: [
    { path: "templates/workbench/AGENTS.md",   sha256: "…", ownership: "managed" },
    { path: "templates/workbench/.jspace/hub.json", sha256: "…", ownership: "managed" },
    { path: "skills/jspace-bootstrap/SKILL.md", sha256: "…", ownership: "seed" },
    …
  ],
};
```

`sha256` is computed over the **raw bundle content** — no placeholder replacement is needed because templates/skills currently contain no `__DEV_ROOT__` (verified). If a future template reintroduces a placeholder, the render function must be shared with `materializeTree` (§8.2) so hashes stay comparable.

### 7.2 Ownership rules (single source, prefix-based)

```ts
function ownershipFor(rel: string): AssetOwnership {
  if (rel.startsWith("skills/"))                 return "seed";   // created once, never upgraded
  if (rel.startsWith("templates/filehub/"))      return "managed"; // on-demand filehub skeleton
  if (rel.startsWith("templates/workbench/"))    return "managed"; // templates may update; conflict on local edit
  return "managed";                                              // unknown path defensively managed
}
```

`user` content is anything in the workbench **not** covered by the manifest — never diffed for content, never touched by upgrade.

### 7.3 Freshness check

Compare the workbench tree + materialization journal against `BUNDLE_MANIFEST`:

- expected hash for a path = manifest `sha256` (raw content);
- last-applied hash for a path = materialization journal (`.jspace/state/materialized.json`, gitignored);
- current hash = sha256 of the on-disk file (workbench-relative path per §8.2 mapping).

CI freshness = `bun run scripts/gen-assets.ts && git diff --exit-code cli/assets.generated.ts cli/manifest.generated.ts` (parent AC13).

## 8. Workspace Diff / Upgrade

### 8.1 Materialized tree mapping

Extract the path mapping from `materializeTree` (`cli/embed.ts:85-95`) into a shared pure helper `materializedRel(key: string): string | null`:

| manifest key | workbench-relative path |
| --- | --- |
| `templates/workbench/<p>` | `<p>` |
| `skills/<name>/<p>` | `skills/<name>/<p>` |
| `templates/filehub/<p>` | (not materialized into the workbench; checked on filehub init only) |

### 8.2 Manifest / journal

- **Bundle manifest** (embedded, portable truth): `DistributionManifestV1` with `bundle_version`.
- **Materialization journal** `.jspace/state/materialized.json` (gitignored, machine truth): records the last-applied state:

```json
{ "version": 1, "asset_version": "1.0.3", "applied_at": "2026-08-04",
  "files": { "AGENTS.md": { "sha256": "…" }, "skills/jspace-bootstrap/SKILL.md": { "sha256": "…" } } }
```

Written by `init` and refreshed by `workspace upgrade`. Its absence (old workbench / fresh clone) means "no known base" — every managed file is treated as create-or-conflict conservatively.

### 8.3 `workspace diff`

Per manifest file, `rel` = `materializedRel(key)`:

| current hash | journal hash | manifest hash | action |
| --- | --- | --- | --- |
| missing | – | – | `create` (managed) / `create` (seed, only if absent) |
| == manifest | any | — | `no-op` |
| != manifest | == journal | — | `update` (managed) / `skip` (seed: journal says created, never overwrite) |
| != manifest | != journal or journal absent | — | `conflict` (managed) / `skip` (seed) |
| in journal, not in manifest | – | – | `stale` (managed; reported, never auto-deleted) |

`migrate` appears when the marker/schema version requires an explicit migration step (hook reserved; empty in this child). Output as `DiffEntry[]`; JSON = `{ bundle_version, entries }`; human = one line per entry `[action] rel (reason)`.

### 8.4 `workspace upgrade`

1. Run diff. If any `conflict` and no `--accept-conflicts`: refuse, list conflicts (exit 1). `--dry-run`: print plan, exit 0, no side effects.
2. Create `.jspace/state/upgrades/<id>/` with a backup of every managed file that will be replaced/removed (`before/<rel>`) plus `journal.json`:

```json
{ "id": "…", "from_version": "1.0.3", "to_version": "1.0.4",
  "plan": [ { "action": "update", "rel": "AGENTS.md" } ],
  "status": "pending" }
```

3. Apply each entry: `create`/`update` write via the atomic writer; `migrate` runs its hook; seed files are skipped by definition. `remove` is never executed without an explicit flag (deferred; `stale` is only reported).
4. Refresh the materialization journal.
5. Update `marker.template_version = BUNDLE_MANIFEST.bundle_version` (portable marker; atomic write).
6. Set journal `status: "applied"`, then run `doctor`; on failure set `status: "failed"` and leave `before/` intact.

**Recovery**: `workspace upgrade --rollback <id>` restores `before/<rel>` for every applied entry, refreshes the journal to the pre-upgrade state, and reverts `marker.template_version`. Journal + backup are gitignored (`.jspace/state/`).

### 8.5 Separation from `jspace update`

`jspace update` (`cli/update.ts`) replaces only the CLI binary — it never touches a workbench. `workspace upgrade` never touches the binary. Version anchor is `VERSION` for the binary, `bundle_version` for the workbench; a new binary whose manifest expects a higher `template_version` drives the user to `workspace upgrade` (doctor/diff surfaces the mismatch).

## 9. `init --force` Ban

Current behavior re-materializes over an initialized workbench when `--force` (`cli/init.ts:27-31,47`). New behavior:

- marker present → `init` fails regardless of `--force`, message: "already a JSpace workbench; use `jspace workspace upgrade`".
- marker absent + non-empty dir → `--force` still allowed (initialization into a non-empty directory), then materializes + writes marker/local/journal.
- `--force` never acts as an upgrade path.

## 10. Testing Strategy

| Area | Tests |
| --- | --- |
| Engine | fixture command registered once → top/sub choices, help, validation, dispatch auto-generate (AC-B1); error-message snapshots match current wording |
| Context/render | `--dir` resolution (explicit vs cwd), cwd fallback, JSON vs human, exit codes (AC-B2/B3) |
| Use cases | init/doctor/domain/resource/filehub/inbox behavior preserved (current tests keep passing); JSON schema assertions |
| Manifest | `gen-assets` no-git-diff; `decodeDistributionManifest` ok; freshness detects create/update/conflict/no-op (AC-B5) |
| Diff/upgrade fixtures | fresh init → diff all no-op; old fixture (`template_version` low, no journal) → `diff → upgrade → doctor`; user file untouched; managed edited → conflict + default refusal; seed edited → not overwritten; apply failure injection → journal `failed` + `--rollback` restores bytes (AC-B6) |
| init ban | `init --force` on an initialized workbench refused with upgrade hint; on a non-workbench empty dir still works (AC-B7) |

Existing 95 tests must stay green (AC-B8).

## 11. Risks & Rollout

- **Parser-surface regression**: mitigate by regenerating the exact help/error texts, migrating command-by-command, and keeping the existing tests green after each step.
- **Cron spec expansion in this child**: bounded by delegating handlers to the current `cmdCron*`; only the declaration surface changes.
- **Hash mismatch on manifest/journal**: ownership rules and path mapping live in one shared module; a consistency test pins `gen-assets` output to the embedded manifest.
- **Upgrade data safety**: default-refuse conflicts, backup `before/` + journal written before any mutation, atomic writes, never touches gitignored state.
- **Rollout**: M1 framework (additive, no behavior change) → M2 register all commands + delete `args.ts` → M3 use-case migration (non-cron) → M4 context/render unification → M5 manifest + freshness → M6 diff/upgrade + journal → M7 init ban + CI gate. Each milestone keeps `bunx tsc --noEmit` + `bun test` green and a temp-workbench `init → doctor` passing. `workspace upgrade` rollback point: journal/backup land in gitignored `.jspace/state/`; risky apply steps ship with plan/dry-run first.
