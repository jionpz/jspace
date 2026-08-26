# Cron 调用契约、Scheduler 对账与 Incidents — Technical Design

## 1. Design Objective

Converge the cron surface from "one `cli/cron.ts` file + prose logs" into typed contracts and adapters:

1. **Invocation contract**: `CronRunInvocation` is the single source shared by the CLI codec and every scheduler backend — backend-generated argv must parse back through the real parser (fixes audit F1).
2. **Scheduler adapters**: inspect/plan/apply reconciliation per platform with workbench-scoped identities (fixes cross-workbench task collisions).
3. **Structured state**: runs and incidents as JSON in `.jspace/state/` (machine truth); prose logs remain human payloads.
4. **Unified log contract**: inbox batch log lives at `<filehub>/.jspace-logs/inbox-batch.md` for both the skill and cron's batch guard (fixes audit F3).

No daemon, no event gateway, no real-scheduler mutation in automated tests.

## 2. Baseline (confirmed)

| Fact | Evidence |
| --- | --- |
| Cron definitions validated by hand (`CronRecord` + `isCronRecord`), no typed decoder | `cli/cron.ts:18-24,51-79` |
| **F1**: cron run parser wants positional `id`; launchd/crontab/schtasks backends emit `--id` → backend argv exits 2 | `cli/cron.ts:257,303`; cron run spec positional-only |
| All three backends inline in `cli/cron.ts` | `cli/cron.ts:177-310` |
| **F3**: skill writes `<filehub>/.jspace-logs/inbox-batch.md`; cron run checks `.jspace/logs/inbox-batch.md`; pending APPLY in `<filehub>/.jspace-logs/` | `skills/asset-ingest/SKILL.md:86`; `cli/cron.ts:578,712-720` |
| Run state = prose markdown; failures = prose lines; no structured machine truth | `cli/cron.ts:634-657,686-700` |
| Existing pure fns to keep: restricted `parseSchedule`, `harnessArgv` (claude/codex/pi), today-success skip, lock, batch-change guard | `cli/cron.ts:97-121,493-520,564-632` |
| Scheduler task names carry no workbench identity (`com.jspace.cron.<id>.plist`) | `cli/cron.ts:178-188` |
| cron commands registered in CommandSpec (Child B); handlers delegate to `cmdCron*` (cwd, no `--dir`) | `cli/commands/registry.ts` cronSpec |
| No ops commands: enable/disable, retry/force, ack, reconciliation | — |

## 3. Target Architecture

```text
cli/commands/registry.ts          # cron spec family -> application use cases (not cmdCron* delegates)
application/automation/
  invocation.ts                   # CronRunInvocation + argv codec + parser-side helper
  definitions.ts                  # cron.json typed contract (decode/encode), add/list/remove/enable/disable
  scheduler.ts                    # adapter interface + planReconciliation (pure)
  runs.ts                         # structured run records (.jspace/state/runs/)
  incidents.ts                    # incident state machine (.jspace/state/incidents/)
  execute.ts                      # run execution (spawn harness, lock, today-success, batch guard)
  use-cases.ts                    # cmdCronAdd/List/Remove/Install/Uninstall/Run/Status/Failures/Ack as CmdResult
adapters/scheduler/
  launchd.ts  crontab.ts  schtasks.ts
adapters/harness/
  argv.ts                         # claude/codex/pi argv generation (moved from cli/cron.ts)
core/contracts/
  cron.ts                         # CronDefinition + CronRunInvocation + decoders (typed)
cli/cron.ts                       # DELETED after migration (pure logic preserved in application/automation)
```

`core/contracts/cron.ts` stays side-effect-free. `application/automation` returns `CmdResult` and consumes injected filesystem/process deps (testability). `adapters/scheduler` own platform specifics and are only exercised via pure plan tests in CI.

## 4. CronRunInvocation Contract

### 4.1 Typed model (`core/contracts/cron.ts`)

```ts
export interface CronRunInvocation {
  workbench: string;     // workbench root (--dir)
  cronId: string;
  timeoutSec?: number;   // default 1800
  force?: boolean;       // skip today-success
}
```

`cron run` spec accepts **both** `--id ID` (scheduler-canonical) and positional `id`; both map to `args.id`. Supplying both is an ambiguous-argument error. `--force`/`--timeout`/`--dir` join the features already present.

### 4.2 Serialization (`application/automation/invocation.ts`)

```ts
export function invocationArgv(inv: CronRunInvocation): string[] {
  const a = ["cron", "run", "--id", inv.cronId, "--dir", inv.workbench];
  if (inv.force) a.push("--force");
  if (inv.timeoutSec !== undefined) a.push("--timeout", String(inv.timeoutSec));
  return a;
}
```

Contract test feeds `invocationArgv` output back through `parse` and asserts the handler args equal the invocation fields. This is the round-trip that closes F1 (all three backends build argv via `invocationArgv`).

## 5. Cron Definitions (`application/automation/definitions.ts`)

- Move `CronRecord`/`loadCrons`/`saveCrons`/`parseSchedule` into `application/automation` with a typed decoder (`core/contracts/cron.ts` `decodeCrons`), using the diagnostics pattern from Child A.
- `add/list/remove/enable/disable` become use cases returning `CmdResult`; `enable/disable` toggle `enabled` and hint to re-run `cron install`.

## 6. Scheduler Adapters & Reconciliation

### 6.1 Interface (`application/automation/scheduler.ts`)

```ts
export interface InstalledTask {
  taskId: string;        // platform identity (plist name / crontab marker / schtasks name)
  cronId: string;
  schedule: string;
  argv: string;          // installed command line (for change detection)
}
export type SchedulerOp =
  | { action: "create"; taskId: string; content: string }
  | { action: "update"; taskId: string; content: string }
  | { action: "delete"; taskId: string };

export interface SchedulerAdapter {
  kind: "launchd" | "crontab" | "schtasks";
  inspect(workbenchTag: string): InstalledTask[];
  apply(ops: SchedulerOp[]): string[];   // human results
}
```

`planReconciliation(desired, installed)` is **pure**: match by `cronId` within the workbench tag; identical argv+schedule → no-op; changed → update; desired-only → create; installed-only (disabled/deleted/stale) → delete. `cron install [--dry-run]` prints the plan; apply runs only when not dry-run.

### 6.2 Workbench-scoped identity

Derive a short stable tag from marker `workbench_id` (`shortHash`, already in cron.ts) so a workbench's tasks never collide with another's:

| platform | identity | current | new |
| --- | --- | --- | --- |
| launchd | plist label | `com.jspace.cron.<id>` | `com.jspace.cron.<tag>.<id>` |
| crontab | managed block markers | `jspace cron start/end` | `jspace <tag> cron start/end` |
| schtasks | task name | `jspace-<id>` | `jspace-<tag>-<id>` |

`cron uninstall` deletes only tasks whose identity carries this workbench's tag; another workbench's tasks are untouched (AC-C3).

## 7. Structured Runs & Incidents

### 7.1 Runs (`application/automation/runs.ts`)

```ts
export interface RunRecord {
  id: string;
  cronId: string;
  startedAt: string;
  exit: number | null;
  status: "ok" | "suspect" | "failed";
  timedOut: boolean;
  outputLog: string;      // prose payload path (.jspace/logs/cron/<id>/<stamp>.md)
  batchChanged: boolean;
}
```

Written to `.jspace/state/runs/<cronId>/<id>.json`. Prose log file is still written (human payload) but `cron status`/`failures`/doctor read the JSON. `lastRun`, `runsSince`.

### 7.2 Incidents (`application/automation/incidents.ts`)

```ts
export interface Incident {
  id: string;
  cronId: string;
  failureClass: "failed" | "suspect" | "batch-stale";
  status: "open" | "acknowledged" | "resolved";
  openedAt: string;
  resolvedAt?: string;
  acknowledgedAt?: string;
  evidence: string[];     // run ids / log paths
}
```

State machine:
- failed/suspect/batch-stale run → `openOrUpdate` (keyed cron+failureClass; keeps latest evidence).
- successful run → `resolveIncidents(cronId)` for that cron (resolved).
- `cron ack` → open incidents become `acknowledged` (evidence retained, no longer alerting).
- `cron check` exits 1 only when an **open** (unacknowledged) incident exists **or** actionable pending APPLY exists; acknowledged/resolved do not alert.

## 8. Execution (`application/automation/execute.ts`)

Migrate `cmdCronRun` body: resolve workbench (via `--dir`), load definition, compile `invocationArgv` → harness argv, today-success skip (unless `force`), lock, inbox batch guard (F3 path), spawn harness, write RunRecord + prose log, open/resolve incident, set exit code. `--dry-run` prints the compiled argv with no side effects (AC-C1).

Injected deps: `spawn`-like runner, file reads, clock — so tests can drive statuses without real harness processes.

## 9. F3 Unified Log Contract

`inboxBatchLog(fhRoot) = join(fhRoot, ".jspace-logs", "inbox-batch.md")` — the single location both asset-ingest writes and the cron batch guard reads. `filehubRoot(root)` (already in cron.ts) resolves the filehub root; the guard and pending-APPLY scan share this path resolution. doctor reuses the same helper (Child B doctor already reads `.jspace-logs` for APPLY).

## 10. Harness Adapter (`adapters/harness/argv.ts`)

Move `harnessArgv` + binary resolution out of `cli/cron.ts`; keep the claude/codex/pi argv shapes unchanged (claude `-p … --output-format text --allowedTools …`, codex `exec …`, pi `-p …`). Capability matrix documents which harnesses are `automated` (verified in CI), `best-effort`, or `manual`.

## 11. Platform Capability Matrix (AC-C8)

| platform | scheduler | CI-verified | notes |
| --- | --- | --- | --- |
| macOS | launchd | pure plan tests | plist generation + dry-run; real install manual |
| Linux | crontab | pure plan tests | block replacement tested; real install manual |
| Windows | schtasks | pure plan tests | arg mapping tested; real install manual |

Manual matrix references `docs/PLATFORMS.md` (existing doctor assertion table) for real-machine behavior.

## 12. Testing Strategy

| Area | Tests |
| --- | --- |
| Invocation | `invocationArgv` → real `parse` round-trip for darwin/linux/win32 generated argv (AC-C1/C2); `--id` + positional both parse; ambiguous error |
| Definitions | decode/round-trip, add/list/remove/enable/disable |
| Reconciliation | `planReconciliation` create/update/delete for enabled/changed/disabled/deleted/stale; two-workbench identity isolation (AC-C3) |
| Runs | write/read/lastRun; status computed from JSON |
| Incidents | open on failure, resolve on success, ack keeps evidence, check exit codes (AC-C4/C5) |
| Execution | dry-run no side effects; force skips today-success; batch guard reads `<filehub>/.jspace-logs/inbox-batch.md` (AC-C6) |
| Ops commands | enable/disable/ack exit codes (AC-C7) |

Existing 128 tests stay green; cron pure functions migrate to `application/automation` keeping their test coverage.

## 13. Risks & Rollout

- **Scheduler surface risk**: real launchd/crontab/schtasks mutation stays out of automated tests; reconciliation and argv are pure-verified; real behavior goes to the manual matrix.
- **F1 regression**: the `--id`+positional dual input must not break existing `cron run <id>`; contract test pins both.
- **Structured-state migration**: prose logs stay as payloads so existing tooling that greps logs keeps working; status computation switches to JSON.
- **Cross-child contracts**: `CronRunInvocation`, incident schema, and runs schema are the handoff to Child D/E (versioned in `core/contracts/cron.ts`).
- **Rollout**: M1 contract + round-trip → M2 definitions + ops use cases → M3 runs/incidents → M4 execution + F3 → M5 scheduler adapters + reconciliation → M6 platform matrix + final integration. Each milestone keeps tsc + tests green and never touches a real scheduler.
