# Ingest Cleanup Recovery And v1.0.5 Release Design

## 1. Boundaries

本任务跨越四层，但不引入新模块：

```text
core/contracts/ingest.ts
  existing IngestJournalV1 legal state combination
        ↓
application/ingest/journal.ts
  cleanup state machine + fault-injectable filesystem transitions
        ↓
application/ingest/use-cases.ts + cli/commands/registry.ts
  truthful exit/output + same --complete recovery surface
        ↓
skills/asset-ingest + generated bundle
  agent recovery discipline
```

Release preparation is a separate final segment: source fix → local gates → deterministic version generation → release commit → remote verify → immutable tag workflow.

## 2. Cleanup State Machine

The existing schema remains version 1. No field or enum is added. The already-valid state below gains an explicit operational meaning:

```text
status = failed
failedStep = committed
failureReason = source cleanup pending[: last error]
```

Transitions:

```text
index
  │ --complete: persist cleanup-pending
  ▼
failed/committed (cleanup pending)
  │ source exists: unlink; source missing: treat as already cleaned
  │ unlink failure: remain cleanup-pending, return nonzero + retry action
  ▼
committed (persist only after cleanup is known complete)
```

Crash behavior:

| Crash/failure point | Durable state | Recovery |
| --- | --- | --- |
| before cleanup-pending write | `index` | rerun `--complete` |
| after pending write, before unlink | cleanup-pending + source exists | rerun `--complete`, unlink |
| unlink throws | cleanup-pending + source exists | nonzero + rerun `--complete` |
| after unlink, before committed write | cleanup-pending + source missing | rerun `--complete`, skip unlink, persist committed |
| after committed write | committed + source missing | terminal success |

This ordering prefers a visible retryable residue over false success or silent loss. It also removes the prior ambiguity where committed could mean either “source removed” or “unlink silently failed.”

## 3. Application And CLI Contract

- `advanceIngest(..., committed, ...)` accepts both `index` and cleanup-pending as valid starting states. Other failed states remain illegal.
- The application result distinguishes committed success from cleanup-pending failure. Failure uses `CmdResult.exitCode=1`, a warning/error line with the unlink reason, and an exact retry command.
- `ingest list/status` continues to expose the existing fields; human output labels `failedStep=committed` as cleanup pending. JSON shape does not change.
- The command remains `jspace ingest advance <id> --complete`; no second recovery command or duplicate parser branch is introduced.
- `beginIngest` treats cleanup-pending as an existing journal for that source rather than creating a second journal/target. The user/skill is directed to complete cleanup first.

## 4. Test Design

Use injected file operations and temp directories only. Required regressions:

1. normal complete: cleanup-pending is transient, unlink once, committed persisted;
2. unlink failure: durable cleanup-pending, nonzero/accurate output;
3. retry with source present: unlink succeeds, committed;
4. retry with source absent: no unlink required, committed;
5. failure writing final committed state after unlink: pending survives and retry converges;
6. begin on cleanup-pending source does not create another journal;
7. old v1 journal fixtures still decode and existing state transitions remain enforced.

Where fault injection needs write-stage control, extend the journal persistence dependency narrowly rather than adding global mutable test hooks. Reuse existing atomic writer and application patterns.

## 5. Documentation And Generated Assets

Update the authoritative skill sources (`skills/asset-ingest/SKILL.md`, `references/batch.md`) and operational docs that describe `--complete`. State that cleanup failure is actionable and retried with the same command. Regenerate embedded assets so initialized workbenches receive the same discipline.

## 6. Version And Release Flow

Deterministic local generation:

```bash
# package.json is changed to 1.0.5 first
JSPACE_BUILD_VERSION=v1.0.5 bun run scripts/gen-version.ts
bun run scripts/gen-assets.ts
```

The generated version is inspected before and after compile. A temporary compiled binary must report `jspace 1.0.5`; its initialized marker must report `template_version: 1.0.5`.

External sequence after local check and explicit approval:

```text
push main
  → wait for verify at exact release SHA
  → create annotated v1.0.5 tag
  → push tag
  → wait build/release/install jobs
  → inspect release assets/checksums
  → download current-host asset into temp dir and verify
```

Failure policy preserves immutable history:

- transient infrastructure failure: rerun the same workflow;
- defect requiring a commit before Release creation: leave the tag as evidence and use at least v1.0.6;
- real defect found after Release publication: add a warning to v1.0.5 Release, then publish a fixed higher patch version;
- never move/delete/recreate a public tag to make a failed release appear successful.

## 7. Rollback

- Before push: revert only this task's uncommitted/version changes through normal patches; do not touch unrelated work.
- After main push but before tag: fix forward on main and wait for the new SHA's verify; v1.0.5 may still be used because no tag exists yet.
- After tag: version identity is immutable; any source-changing fix moves to the next patch version.
