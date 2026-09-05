# inbox: exclude resident README and .skip-inbox-tidy dirs from unfiled count (issue #38)

Source: https://github.com/jionpz/jspace/issues/38

## Goal

`_inbox` unfiled counting must count payload, not structure: the drop-zone's resident
contract files and user-declared exempt directories are never "unfiled", so
`filehub.inbox_unfiled` stops being a permanent false warning that trains users to
ignore the one signal that matters.

## Problem (verified on main)

`countInbox` (`application/registry/inbox.ts`) skips only dotfiles. Consequences:

1. A resident `_inbox/README.md` (drop-zone contract doc, always present per the
   filehub STRUCTURE contract) is counted forever — the warning can never reach 0.
2. A directory the user explicitly exempted with `_inbox/<dir>/.skip-inbox-tidy`
   (e.g. a long-term learning folder with its own `_catalog.json`) is still counted
   wholesale: the marker convention exists in skill copy and on disk but no code
   implements it — a silent breach of a user declaration.

`jspace inbox status`, doctor (`filehub.inbox_unfiled`) and the context hook all
route through `countInbox` (plus `inboxStatus`'s own listing filter), so one fix
keeps all three in agreement; not fixing it makes all three cry wolf together.

## Requirements

1. Single filter, shared: extract the exclusion into one place in
   `application/registry/inbox.ts` used by BOTH `countInbox` and `inboxStatus`
   (count == listed items == doctor warning, by construction).
2. Exclusions (top level only):
   - dot-entries (existing behavior);
   - resident contract files: exactly `README.md` and `AGENTS.md` (case-sensitive);
   - any top-level directory containing a direct-child `.skip-inbox-tidy` marker
     file — the directory AND its contents are excluded (marker must be a direct
     child of the counted entry; nested deeper does not exempt).
   No hardcoded directory whitelists — the marker file is the portable mechanism
   (each workbench's subfolder semantics differ).
3. Doctor needs no logic change (`checkInbox` already calls `countInbox`); add a
   regression test proving `_inbox` with only README + an exempted dir produces
   NO `filehub.inbox_unfiled`, and one real file still warns with the right count.
4. Skill docs record the contract (semantics live on the AI side per batch.md's
   边界 section; CLI stays a read-only counter):
   - `skills/asset-ingest/references/filing.md`: drop-zone resident files +
     the `.skip-inbox-tidy` exemption (applies to `_inbox/` and the degraded
     staging dir — same job, two implementations);
   - `skills/asset-ingest/references/batch.md`: batch traversal skips
     `.skip-inbox-tidy` dirs and reports them in the skipped tally; counting
     comparisons use the same exclusions.
5. Regenerate embedded assets (`bun run scripts/gen-assets.ts`) since `skills/`
   changed; generated `cli/*.generated.ts` committed.

## Constraints

- No CLI surface change: `inbox status` output shape unchanged (fewer items when
  excluded), `doctor` codes unchanged.
- Exclusions apply identically to the registered `_inbox/` and the degraded
  staging dir (`locateInbox` is the shared entry).
- Keep top-level semantics (a directory = one item) — untouched.
- User-facing strings in Chinese; identifiers/comments in English per repo spec.

## Acceptance Criteria

- [ ] New `application/registry/inbox.test.ts`: README.md / AGENTS.md / marker-dir
      excluded from count AND listing; unmarked dir counts as one; marker nested
      deeper does NOT exempt; JSON `count` matches visible lines.
- [ ] `doctor.test.ts` regression: README + exempted dir only → no
      `filehub.inbox_unfiled`; +1 real file → warning reports exactly `1 unfiled`.
- [ ] `bunx tsc --noEmit`, `bun test`, `bun run scripts/check-skills.ts` all green;
      gen-assets rerun leaves no diff.
- [ ] Smoke on a fresh `/tmp` workbench: filehub with `_inbox/README.md` +
      `.skip-inbox-tidy` dir + 1 file → `inbox status` lists 1, doctor 0 warnings.
- [ ] Commit references issue #38.
