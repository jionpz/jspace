# Quality Guidelines

> Code quality standards for backend development in this project. These are the enforced gates plus the conventions every change must follow.

## Overview

- No linter configured; the enforced gates are `bunx tsc --noEmit`, `bun test`, the `import-boundary.test.ts` layer-direction gate (runs inside `bun test`), and generated-asset freshness (`gen-assets` must be a no-op vs committed).
- Conventions here are the project's actual patterns (CommandSpec single source, diagnostics decoders, DI injection, ownership model, security red lines).

## Forbidden Patterns

- **application imports `cli`** (non-test) — generated manifests/journal/readFile are injected by the cli layer, never imported.
- **Duplicate command surface** — name/options/help/handler must live only in the CommandSpec; no separate `CHOICES` constants, help strings, or parse switches.
- **Loose JSON parsing** — unknown payloads must go through the typed decoder (strict unknown-field), not ad-hoc casts.
- **Writing machine truth to prose** — recovery/idempotency/compensation decisions read structured state only.
- **Silent failure** — `fail()` swallowed into a fake success, or a state-machine illegal transition no-opped.
- **Real-environment mutation in tests** — no touching real home config, real scheduler, real gbrain store, or real filehub in automated tests.
- **Over-claiming automation** — product docs may only say "automatic/保证" for paths with CI/test evidence (parent invariant #7).

## Required Patterns

- **CommandSpec single source**: every command's name/aliases/options/positionals/help/handler come from one `CommandSpec` in `cli/commands/registry.ts`; handlers bind to `application/*/use-cases.ts`. Repeatable options (`repeatable: true`) need an explicit `dest` when the handler reads a plural key — without it the parser emits the singular key (`--tag` → `args.tag`) and the handler reading `args.tags` silently gets `undefined` (tags never persisted, exit 0; issue #8 #2).
- **`--dir` is the workbench root convention** for every command (feature `dir: true`); `init` also accepts a legacy positional target for backward compatibility — both together is an ambiguous error (exit 2). Do not add new positional-path commands.
- **Version string contract** (`scripts/gen-version.ts`): non-release builds carry the commit delta via `git describe --tags` (e.g. `1.0.9-2-g7cef2bc`) so `--version` distinguishes a tag-point build from leading commits — do NOT re-add `--abbrev=0` (it reintroduces binary/source drift). Release builds are overwritten to the clean tag by `JSPACE_BUILD_VERSION` (CI). `compareVersions` parses `[.+-]`-separated leading numerics, so suffixed versions compare equal to their tag — which is exactly why the `update` self-check must never treat a suffixed build as "已是最新" (equal numbers prove nothing about content, issue #40): suffixed + numerically-up-to-date emits the local-build guidance instead, and switching to the official binary stays an explicit `--version` decision.
- **Typed contract first**: any new schema gets `core/contracts/<name>.ts` (decoder, diagnostics pattern) + round-trip tests before use cases consume it.
- **Thin-link projection contract (issue #39)**: `.jspace/skills/<name>/` is the ONLY physical skill copy; every harness projection dir (`.agents|.claude|.grok|.opencode/skills/<name>`) is a relative directory symlink and `~/.agents/skills/<name>` an absolute one — created exclusively by `application/workspace/projections.ts` (never hand-rolled `symlinkSync` elsewhere; junction/copy fallbacks must stay visible as info lines + journal `mode: "copy"`). `materializedRels` maps skills to SSOT paths ONLY — adding a projection per-file rel back reintroduces the 5× fan-out and the body↔details divergence the engine exists to kill. The official skill set is **fully owned**: a real dir where a manifest name belongs is converged to the link (`converge`, reported — never `keep-divergent`), and a RETIRED official name is deleted outright from the workbench SSOT, every projection dir and `~/.agents/skills` (dangling link or non-empty stale copy alike) by `workspace upgrade` / `skills install --refresh`; user-created dirs under other names are still never touched. A name that ships AND is on the retire list is a build error (`scripts/check-skills.ts` C6). Renaming or dropping an official skill means adding the old name to `application/skills/retired.ts` in the same change; `skills.retired_present` (warning) is the doctor signal for a machine that only ran `jspace update` and still carries one. Journal `materialized.json` is v2 (`links` section); v1 decodes with empty links. Migration judgment is content-based (`diffDirs`), never journal-verdict-based — a copy refreshed to new content reads `stale`, not `remove`.
- **Filehub block writer is byte-conservative**: the managed block is spliced into a strictly-UTF-8-decoded copy (invalid bytes fail instead of silently becoming U+FFFD), insertion lands after a leading BOM and after YAML frontmatter (both must keep their required top-of-file position), markers count only as standalone whole lines (an inline example mention is not a marker) **and never inside a fenced code block** — backtick or tilde fences are skipped (info string allowed for tildes, a close must use the same char and at least as many of them, an unclosed fence suppresses to end-of-file, a 4-space-indented run is not a fence) so a README that documents the contract in an example does not read as "duplicate markers", a non-writable target is refused (plain `rename` only needs the parent dir and would otherwise swap a 0444 file for a 0644 one), the destination mode is carried through `writeBytesAtomic(..., mode)`, and the read is re-validated (ino/size/mtime) immediately before the rename so a concurrent edit or sync is never clobbered.
- **Managed-block contract upgrades**: user-owned prose files keep JSpace contract text between versioned markers (workbench `AGENTS.md` `JSPACE:START/END`; filehub `README.md` `JSPACE:FILEHUB:START/END` with `> filehub-contract-version: N`). Upgrades are explicit commands and replace/insert ONLY the block, never the text outside it; symlinked or damaged-marker targets are refused with the file unchanged. Contract upgrade and asset migration stay separate: `filehub upgrade` touches the README only, doctor reports `filehub.contract_stale` / `filehub.legacy_taxonomy` read-only (one-level scan, permission errors degrade), and any physical move is a separate user-confirmed, per-file rollback-able runbook (`asset-ingest/references/migration.md`). **Doctor must never throw** — a `chmod 000` filehub dir once aborted the whole command: probe with an `lstat`-based classifier that separates absent (`ENOENT`) from present-but-unreadable (`EACCES`), short-circuit every filehub content check when the bound root is not materialised (the registry layer already reports `binding.missing` once — a README "missing" warning there is a cascade, and its suggested `filehub upgrade <path>` cannot run), and never point at `filehub upgrade` for a target it will refuse (symlinked, unreadable). Discovery-by-name scans (`areas/*`) must not follow symlinks out of the filehub; explicitly-registered project roots keep follow-link behaviour.
- **Diagnostics must stay bounded on a big asset tree**: `jspace doctor` is read-only but not free — a real filehub can hold hundreds of thousands of files and hundreds of projects, and the pre-fix command emitted **two diagnostics per project** (200 projects → 400 info lines, 1000 → 2000) while walking every file for mtime. Two rules keep it usable: (1) any per-project/per-root fan-out goes through `pushCapped` — the first `FANOUT_LIMIT` stay concrete (specific `path`, script-parseable `code`) and the remainder collapse into ONE counted line of the same `code` at the parent path, so small workbenches keep the old shape and big ones stay readable; (2) mtime walks share one `newActivityScanBudget()` per run and short-circuit via `stopWhenNewerThan` (the only question is "was anything touched after T?"), so an active project costs O(1) and a pathological tree stops at `ACTIVITY_SCAN_BUDGET`. An exhausted budget must never be turned into a verdict: skip the stale conclusion, and report `filehub.scan_truncated` saying how many of how many projects were actually covered — a lower bound presented as a fact is worse than no answer.
- **Reserved archive directory names**: `docs|decks|data|notes` are banned as directory names anywhere under a filehub (project roots and `areas/*` alike) because they name a file shape, not an ownership/stage — ownership is decided first and format only picks the summarisation depth (`asset-ingest/references/filing.md`). `filehub.legacy_taxonomy` enforces exactly that bare whole name, so a topic merely *containing* the word (`data-science`) is not a hit. The words may appear only in forbid/detection/migration context, written as bare names — a backticked `docs/` in a materialized workbench/skill md trips `cli/assets-reachability.test.ts` (the guard exists to catch dead dev-repo doc links), and `templates/filehub/` is scanned separately (on-demand skeleton, excluded from that guard).
- **Contract version discipline**: each contract carries `version`/`schema_version`; unsupported versions fail with `*.version.unsupported`; internal schema changes bump the version with an explicit migration, never silently.
- **Incremental ownership model** (parent R4/AC5): bundle files carry `AssetOwnership` in three tiers — `seed` (user-customizable templates: README/.gitignore/.claude settings + bundled skills), `user` (`.jspace/` data such as hub.json/cron.json; upgrade never overwrites them, schema evolution goes through migration), and `managed` (reserved force-replace class, currently unused). `diffBundle` produces `create / no-op / update / conflict / skip / stale / remove / migrate / block-update` (`remove` = a recorded copy no longer in the bundle, unmodified, cleaned up on upgrade; `migrate` = hub schema migration; `block-update` = AGENTS.md JSPACE block refreshed, user content outside the block preserved); `materialized.json` is the last-applied base; `workspace upgrade` writes a plan + journal + rollback snapshot under `.jspace/state/upgrades/<id>/`. Locally-modified skills are never force-overwritten (reported as conflict).
- **Mixed DI**: selected ports are injected (generated manifests, journal, readFile, skill context, clock) by the cli layer; filesystem goes through `adapters/fs` directly. `application` stays free of `cli` imports.
- **External-process ports**: any production dep backed by an external CLI (gbrain) lives in `adapters/` and routes through `adapters/process/spawn.ts` (timeout + output cap + stdin) — a bare `spawnSync` in application is a hang risk for harness hooks. The port is async so a stalled process resolves `{ok:false}` after the timeout instead of blocking (issue #8 #8). The scheduler layer has the same red line via `adapters/scheduler/spawn.ts` (crontab/schtasks/plutil/launchctl always get `SCHEDULER_SPAWN_TIMEOUT_MS`; issue #9 #9-04).
- **Generator bootstrap hygiene**: a generator script must not import modules that load its own generated output (gen-assets → registry → capabilities.generated.ts was a bootstrap loop; fixed by moving `ownershipFor` to a pure module, issue #8 #17). Generated assets stay committed + freshness-checked.
- **Harness machine-config paths are SSOT data**: gbrain MCP config paths (path/format/server_key) and verified global-context entrypoints live in capabilities.yaml `mcp_config` / `global_context`, consumed by `harness wire` / doctor — never hardcoded in wiring code (issue #8 #16). `manual` / `unverified` are explicit non-check states, not wiring paths.
- **Structured diagnostics**: `doctor`/`inspect` classify invalid / unbound / missing / drift with distinct codes and severities — never collapsed.


## Scenario: State-root mutation locks

### 1. Scope / Trigger

- Trigger: any cross-process read-modify-write of persistent state under a **state root**.
- All mutable CLI state is workbench-owned: `hub.json`, `local.json`, `cron.json`, `state/ingest/*.json`, `state/pending/*.APPLY.json`, `state/briefing.json`, workspace seeds/skills/upgrade journal.
- The filehub owns asset bodies and the inbox batch log; pending envelopes never live there.
- Goal: never silently lose a user-visible mutation. A competing writer must either run after the first completes or fail loudly.

### 2. Signatures

```ts
export const MUTATION_LOCK_STALE_MS = 30_000;
export const PENDING_MUTATION_LOCK_STALE_MS = 120_000; // > one gbrain call
export const INGEST_MUTATION_LOCK_STALE_MS = 120_000;  // > one gbrain call

export function mutationLockPath(root: string): string;        // <root>/.jspace/state/locks/mutation.lock
export function pendingMutationLockPath(root: string): string; // <root>/.jspace/state/locks/pending.lock
export function ingestMutationLockPath(root: string): string;  // <root>/.jspace/state/locks/ingest.lock

export function withWorkbenchMutationLock<T>(root, fn: () => T, deps?): T;
export function withPendingMutationLock<T>(root, fn: () => T, deps?): T;
export function withPendingMutationLockAsync<T>(root, fn: () => Promise<T>, deps?): Promise<T>;
export function withIngestMutationLock<T>(root, fn: () => T, deps?): T;
```

- Public mutators keep their existing signatures; internally they delegate to a `*Impl` function wrapped by the matching lock.
- Covered paths: `domain add/remove(--purge)`, `project add`, `resource add/remove`, `filehub init --register`, `cron add/remove/enable/disable`, `ingest begin/advance/complete/fail/rollback`, `pending apply/ack`, `context session-start`/`turn` briefing writes, `workspace upgrade/rollback`.
- Read-only commands and `--dry-run` call the `*Impl` directly and never acquire the lock.
- Pending and ingest use dedicated workbench locks instead of the ordinary registry lock so a slow backend does not block unrelated registry edits.

### 3. Contracts

- Lock files: `<workbench>/.jspace/state/locks/{mutation,pending,ingest}.lock`.
- One ordinary workbench lock protects registry/seed state; pending and ingest get dedicated locks for external-call budgets.
- **Critical-section budget**: a lock is held at most `staleMs`. Anything whose duration is unbounded (recursive deletion of a directory tree) or that can block for longer than the budget (an external call) must run OUTSIDE the lock, or the next process will treat a live holder as crash residue and steal the lock. Expensive-but-bounded steps (single-file copy) may stay if the design names the boundary and the follow-up trigger.
- A heartbeat/lease renewal is NOT a valid way to exceed the budget here: this codebase's fs work is synchronous, so a timer cannot fire while a blocking call runs.
- The ordinary budget (30s) is shorter than `GBRAIN_TIMEOUT_MS`; pending/ingest locks held across a gbrain call use the 120s budget and MUST hold for a single unit of work, never an unbounded batch.
- The callback MUST span the full `read → validate → mutate → write` section. Locking only the final write leaves duplicate-id/singleton checks racing on stale snapshots.
- Acquisition is `O_EXCL`; the file contains a process-unique ownership token. Release unlinks only when the token still matches.
- A fresh foreign lock fails fast. A lock older than 30 seconds is treated as a crash residue and reclaimed once.
- Same-process nesting for the same root is an explicit programmer error; different roots may be held simultaneously.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Fresh foreign lock | `CliError` exit 1; message contains the lock path and 30s retry guidance; no mutation runs |
| Stale lock (`mtime` > 30s) | Remove and retry the exclusive create once |
| `EEXIST` | Contention; fail fast (not an internal error) |
| `EPERM` / `EACCES` / `ENOSPC` / `EIO` while creating/writing the lock | Propagate; never report it as "another process is running" |
| Post-create token write fails | Remove our 0-byte poison lock, then propagate |
| Callback throws | Release in `finally`; never leave our own fresh lock behind |
| Same root nested in one process | Throw `internal: nested <noun> mutation lock for <root>` |
| Dry-run / read-only command | Do not create or inspect the lock file |
| Lock held across a > budget step | Forbidden — restructure so the lock spans only the O(1) handoff (e.g. `rename`), and do the slow part after release |
| Crashed pending applier | Its workbench pending lock is reclaimed after 120s; the envelope stays `staged` and the next apply is idempotent |

### 5. Good/Base/Bad Cases

- Good: two concurrent `domain add` processes either both succeed sequentially (both domains present) or one exits 1 with the lock-conflict message; `hub.json` stays valid.
- Base: one mutation process acquires, writes, and releases normally.
- Bad: two writers both `loadHub` before either writes, then each writes its own snapshot; the second silently overwrites the first.

### 6. Tests Required

- Unit lock tests: fresh contention, stale takeover, release-if-ours, same-root reentry, distinct-root holding, non-contention error propagation.
- Pending/ingest lock tests: workbench-local paths, `*_MUTATION_LOCK_STALE_MS > GBRAIN_TIMEOUT_MS`, per-root nesting, async release-on-reject.
- Long-operation tests: `domain remove --purge` leaves no trash residue on the happy path, reclaims only stale residue, and is covered by a `--dry-run` no-lock assertion.
- Best-effort hook paths (briefing) assert the lock conflict THROWS; the call site owns the degrade-to-no-op catch.
- Deterministic lost-update control: an unlocked interleave drops a writer; the same locked sections preserve both updates.
- Use-case contention tests: holding the lock makes `resourceAdd` / `cronAdd` fail before reading or writing state; the foreign lock remains untouched.
- Dry-run tests assert `mutationLockPath(root)` does not exist afterward.
- Manual concurrency smoke may exercise separate CLI processes, but automated tests must stay deterministic.

### 7. Wrong vs Correct

#### Wrong

```ts
const hub = loadHub(root);       // stale snapshot read before the lock
hub.domains.push(record);
withWorkbenchMutationLock(root, () => writeHubAtomic(root, hub));
```

#### Correct

```ts
function domainAddImpl(root, id, ..., dryRun) {
  const hub = loadHub(root);     // fresh read inside the critical section
  // validate + mutate
  writeHubAtomic(root, hub);
}

export function domainAdd(root, id, ..., dryRun) {
  return dryRun
    ? domainAddImpl(root, id, ..., true)
    : withWorkbenchMutationLock(root, () => domainAddImpl(root, id, ..., false));
}
```

#### Wrong (unbounded work inside the lock)

```ts
withWorkbenchMutationLock(root, () => {
  writeHubAtomic(root, hub);
  rmSync(domainDir, { recursive: true });   // minutes on a big tree -> lock stolen mid-delete
});
```

#### Correct

```ts
const { result, trash } = withWorkbenchMutationLock(root, () => {
  writeHubAtomic(root, hub);
  renameSync(domainDir, trashPath);          // O(1): the locked handoff
  return { result, trash: [trashPath] };
});
for (const p of trash) rmSync(p, { recursive: true, force: true }); // outside the lock
```


## Scenario: Headless cron provenance (source tag)

### 1. Scope / Trigger

- Trigger: any write whose gbrain page carries a provenance tag (`source:session` vs `source:cron`).
- The tag is chosen by **run mode, not by skill**: the same skill writes `source:session` in a
  session and `source:cron` under cron. Each write-side skill carries a 会话 / 无头(cron) row;
  the discipline source is `skills/jspace-use/references/gbrain.md` 「Provenance tag」.
- Goal: `source:cron` must be **countable**. The metric feeds `workbench-retro` check 1 and the
  M7 memory-leg closing condition; a wrong tag is not a cosmetic defect, it silently zeroes a leg.

### 2. Contracts

- **The child cannot infer its own run mode.** `adapters/process/spawn.ts` `cronSpawnEnv()` copies
  an allowlist of EXISTING env vars and injects no marker. A headless child therefore has no
  machine-readable signal for "was I launched by the cron runner?" — do not assume it can deduce this.
- **The prompt is the only channel every cron receives.** Cron definitions may carry a `tools`
  allowlist and write-only crons are deliberately granted no Bash, so "read an env var" is not a
  workable instruction for them. Run-mode facts belong in the compiled prompt.
- `compileSkillTarget()` stamps `CRON_RUN_MODE_NOTICE` at the head of every skill-target prompt
  (fact first, then the consequence: the tag is `source:cron`). The prose-prompt escape hatch
  (`cron.prompt`) is passed through unchanged — it is user-owned free text, not part of this contract.
- `compileSkillTarget()` is also called by `cron install` validation (result discarded), so stamping
  must stay side-effect free.

### 3. Validation & Error Matrix

| Case | Required behavior |
|---|---|
| Skill-target cron reaches the harness | Prompt opens with the run-mode notice; the skill's own decision table picks the tag |
| Prose-prompt cron | Prompt passes through byte-identical; no notice injected |
| `cron install --dry-run` (skill validation) | Validation unaffected; no side effect from the stamp |
| A page written by a headless run | `gbrain tags <slug>` contains `source:cron` — assert per page, not via `list` |

### 4. Evidence (why this contract exists)

Real-usage finding, 2026-09-12 M7 R1 rehearsal: `jspace cron run workbench-retro` produced
`records/retro/2026-09-12` tagged `source:session`, because the page's own prose read
"无头模式(会话内触发)" — the agent read `cron run` as an in-session trigger. Every rule document
was already correct; only the *fact* was missing. Guarded by
`application/automation/definitions.test.ts` (notice leads the compiled prompt) and
`application/automation/execute.test.ts` (skill-target argv carries it; prose argv does not).

## Scenario: Per-cron headless model

### 1. Scope / Trigger

- Trigger: any cron whose unattended run must not inherit the user's interactive default model.
- `CronDefinition.model` (optional) is the *only* supported way to pin a headless model. It exists
  because the interactive default is (a) not jspace's to depend on and (b) can be swapped to a
  rate-limited provider at any time — and a rate-limited model does **not** fail fast: `claude -p`
  hangs until killed (exit 142, zero output) or exits 1 printing only the 429 text.

### 2. Contracts

- The flag lives in the harness capability (`argv_flags.model`), never hardcoded per harness:
  claude `--model`, codex `-m`, opencode/pi `--model`; a harness without the key must **fail loud**.
- `assertHarnessSupportsModel()` mirrors `assertHarnessSupportsTools()`: a cron setting `model` on a
  harness that declares no model flag fails with an actionable message rather than silently falling
  back to the harness default — the exact failure this field exists to prevent.
- The measured concurrency constant for session-start gbrain fetches is `GET_CONCURRENCY` in
  `application/context/project-states.ts` (measured optimum on the live workbench; serial `get` was
  ~0.5s/spawn and blew the hook budget). Changing it invalidates the measurement — re-sweep.
- Dispatcher-side reconciliation (`planReconciliation`) must compare the **whole argv including
  argv[0]**. `argv` assembled from plist/crontab/schtasks that omits the binary path cannot see a
  drifted binary and will report up-to-date forever.
- Each read-back must recover argv[0] **from the element the platform actually writes it to**, and
  the test fixture must mirror that platform's real storage shape — not the write call's argument
  string. darwin stores the array verbatim (`ProgramArguments[0]`), the crontab line is stored as
  written (leading quoted token), but **schtasks does not store `/tr` verbatim**: it splits the run
  string at the first unquoted space, putting the program in `<Command>` and the remainder in
  `<Arguments>`. Reading argv[0] out of `<Arguments>` therefore always falls back to unprefixed and
  re-updates on every install — a Windows-only red that a fixture handing `<Arguments>` the entire
  `/tr` cannot catch (2026-10-16, v1.0.30 build: both Windows legs red, all others green).
- The entry's baked `PATH` (`schedulerPath`) is the **transitive closure** of everything the
  entry's processes resolve **by name at run time**, not just what jspace spawns: direct targets
  (harness, `gbrain`), **jspace itself** (harness hooks/plugins call bare `jspace`), and each
  resolved binary's **shebang interpreter** (`#!/usr/bin/env <name>` is a second name lookup;
  `#!<abs>` needs no lookup but may itself be a shim, so the walk continues). Walking is bounded by
  a visited set (keyed on resolved path) + `MAX_CLOSURE_NODES`, reading only the first 128 bytes of
  each candidate — the closure must never grow unbounded or read whole binaries.
- **Any value baked at install time that is not recomputed at run time must be part of the
  reconciliation key** — otherwise a fix to how that value is computed can never reach an entry
  that was already installed. `envPath` joins `taskId` / `schedule` / `argv` for exactly this
  reason (2026-10-16: after the closure fix, `cron install` reported "up to date" while 4 of 5
  plists still carried the pre-#50 PATH). Read it back from the element the platform stores it in
  (darwin plist `EnvironmentVariables.PATH`, linux crontab line `PATH='…'`); compare the dimension
  **only when both sides define it** — `undefined` means "platform stores no PATH (win32) or the
  read failed", and treating that as drift would re-update on every install.
  - Third instance, 2026-10-22: the per-cron **execution budget** (`cron.json` `timeoutSec`) lives in
    the same class of value. `buildDesired` must pass it into `invocationArgv` (which already
    serialized `--timeout`; nothing called it with a value), and every adapter must emit it into the
    entry **and** reconstruct it on read-back (`ProgramArguments`, the crontab line, `/tr` in the
    schtasks XML). Before this, `cron.json` had no such field at all and the scheduled path always
    ate the 1800s default — `server-status` was killed at 1915s and 2042s and no edit to cron.json
    could change it. Absence must stay byte-identical to pre-field output (no `--timeout` emitted,
    none reconstructed) so adding the field never rewrites every installed schedule.
  - The rule generalizes: when adding a cron field, ask "does this reach the scheduler, or only the
    manual `cron run` path?" A field that only the CLI reads is a per-run flag, not a definition.

### 3. Validation & Error Matrix

| Case | Required behavior |
|---|---|
| `cron.json` entry with `model` | dry-run argv contains the harness's model flag + value |
| `cron.json` entry without `model` | argv byte-identical to pre-feature output (backward compatible) |
| `model: ""` / non-string | `cron.model.invalid` decoder issue |
| `model` set, harness declares no `argv_flags.model` | fail loud at `cron run` (before spawn) |
| `cron.json` entry with `timeoutSec` | installed entry gains `--timeout <n>`; changing the value yields `[update]` |
| `cron.json` entry without `timeoutSec` | no `--timeout` in the entry, byte-identical to pre-field output; effective budget 1800 |
| `timeoutSec: 0` / negative / float / string | `cron.timeoutSec.invalid` decoder issue; `cron add --timeout` rejects at add time |
| `cron run --timeout N` on a cron with its own `timeoutSec` | N wins for that single run (lock staleness and spawn kill both use N) |
| Installed task points at a different binary | `cron install` reports `[update] <taskId>` |
| Installed entry carries a stale PATH (both sides define one) | `cron install` reports `[update] <taskId>` |
| Platform stores no PATH (win32) or the read-back failed | comparison skips the dimension — no drift |
| Same binary + schedule + argv + envPath | `cron install` reports nothing to do (idempotent) |

### 4. Evidence (why this contract exists)

Real-usage finding, 2026-10-13: five crons failed nightly because the user-level default model was
rate-limited, and `inbox-tidy`'s plist pointed at a stale dev binary (v1.0.22) that reconciliation
could not see — the argv it compared carried no binary path. Both defects are invisible in tests
that only check the written form; the round-trip (write → read back → reconcile) is the guard.
`adapters/scheduler/scheduler.test.ts` pins write→read→no-op and binary-drift→update per platform.

Real-usage finding, 2026-10-14 (issue #50's other face): the entry PATH resolved `gbrain` to its
shim but not the shim's interpreter — `env: bun: No such file or directory` — and did not resolve
`jspace` at all, so three harness hooks failed silently in the harness log
(`/bin/sh: jspace: command not found`). 2026-10-16: adding the closure alone was not enough;
because PATH was not in the reconciliation key, the fix did not reach installed entries. Both
lessons are pinned by `cli/scheduler.test.ts` (closure shapes incl. cycles, default name set) and
the per-platform PATH round-trip tests.

## Security & Red Lines (parent R8)

- Secrets/tokens/provider credentials never appear in logs, state, or diagnostics output.
- Bootstrap never default-executes remote pipe installs (`curl|bash` / `irm|iex`): download to a temp file, show source/checksum, require explicit user confirmation.
- Automated tests never mutate real home harness config, real scheduler, real gbrain store, or real filehub — always temp fixtures + injected stubs.
- gbrain is an external system; JSpace does not bypass its serve lock (conflicts are staged as pending envelopes).
- **Path-bounded destructive ops**: every unlink is confined to its owning root (filehub/workspace). Ingest validates the source lives in `<filehub>/_inbox` at `begin` AND re-checks a (possibly tampered) journal path at every unlink; `--rollback` ids are UUIDs and journal rel paths pass `portabilityIssues` (issues #8 #4/#15).
- **Shell/cmd injection**: `.cmd/.bat` spawn targets escape every arg for cmd (`"`→`""`, wrap in quotes so `& | < > ^ % !` stay literal); the crontab writer rejects newline/CR/NUL and its parser is symmetric with the writer (unshq restores `'\''` and `\%`) (issues #8 #3/#12).

## Testing Requirements

- Gates: `bunx tsc --noEmit` + `bun test` must stay green (currently 1052 tests across 84 files).
- New function → unit test; bug fix → regression test; changed behavior → update existing tests.
- Fault-injection via injected deps (ingest journal fs ops, pending envelope gbrain stub).
- Contract round-trip + decode-issue tests for every decoder.
- Scheduler behavior: pure `planReconciliation` tests + argv round-trip through the real parser; no real scheduler apply in tests.
- Regression tests call the real production path under test (public adapter methods, parse the actual output) — never hand-craft the internal payload with the expected values baked in. A test that assembles `schtasksArgs(...)`/`JSON.stringify` by hand stays green while the shipped method (`buildContent`) emits a mismatched task handle → false-green masked a Windows cron bug (issue #8 #1).
- **Cross-platform test portability (CI runs `bun test` on ubuntu + macos-14 + windows-latest)**:
  - Path assertions never hardcode `/`: build the expected value with `join()` from `node:path` (or normalize separators on both sides). A literal `expect(x).toBe("/wb/.grok/config.toml")` passes on POSIX and reds on Windows purely because `join()` returns `\wb\.grok\config.toml`.
  - Injected fs stubs must be separator-normalized (`p.replace(/\\/g, "/")`) before using a path as a Map/object key — the production code calls them with `join()` output.
  - Strings embedded into a serialized format must be escaped the same way the writer escapes them: the grok TOML fixture must use `JSON.stringify(path)` (TOML basic strings follow JSON escaping), otherwise a Windows path becomes an invalid TOML escape.
  - Platform-conditional skips are **only** `test.skipIf(process.platform === "win32")` (or `describe.skipIf`) with an inline reason. A silent `if (platform === "win32") return;` reports as **pass** and is forbidden — it hides coverage loss instead of surfacing it.
  - Removing a directory link/symlink must use `rmSync(p, { recursive: true, force: true })`; a bare `rmSync(link)` fails with `EFAULT` on Windows.
  - Do not leave Windows tests that pass for the wrong reason: if a POSIX-only fixture makes a spawn fail and the assertion (`"failed"` appears / lock is released) still holds, `skipIf` it and record the reason rather than banking a false green.
  - Classify every new-platform failure before touching it: **real product defect** (fix product, escalate if out of scope) vs **POSIX-only semantics** (`skipIf` + reason) vs **environment limit** (record in the task's skip list). Never widen a skip to make a pipeline green.

## Code Review Checklist

- [ ] tsc + tests green; generated assets fresh (`git diff --exit-code cli/*.generated.ts`).
- [ ] application layer has no `cli` import (non-test).
- [ ] New/edited schema uses the diagnostics decoder with strict unknown-field + version.
- [ ] Command surface added only via CommandSpec (no duplicate help/parse).
- [ ] No secrets/logs-in-state regression (R8).
- [ ] No real-environment mutation in tests.
- [ ] No hardcoded path separators / unnormalized stub keys; platform skips use `skipIf` + reason (never silent `return`).
