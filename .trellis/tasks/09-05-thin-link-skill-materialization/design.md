# design.md — thin-link skill materialization (issue #39)

Status: draft for review. Not implemented yet.

## Current state (grounded in code)

| Site | Today |
| --- | --- |
| `application/workspace/manifest.ts:40` `materializedRels()` | per-FILE mapping: `skills/<name>/<file>` → `.jspace/skills/<name>/<file>` + one copy per projection dir (`workbenchProjectionDirs()` from capabilities.yaml) |
| `application/skills/install.ts` `installSkills()` | per-FILE copy into `~/.agents/skills/` (fill-gaps; `--refresh` rewrites differing) |
| `application/diagnostics/checks/skills.ts` | `skills.projection_drift` = `diffDirs(SSOT, projection)` byte-compare; `skills.bundle_stale` = SSOT ↔ embedded bundle |
| `application/workspace/diffBundle` + upgrade journal | per-file sha in `materialized.json`; projection copies recorded like any copy |
| `scripts/check-skills.ts` C1 | FORBIDS relative `references/x.md` in SKILL.md, mandates `~/.agents/skills/<skill>/…` anchors (82–95 live occurrences) |

Root structural facts to preserve:

- capabilities.yaml stays the single source for WHICH dirs are projections;
  thin-link changes HOW they are materialized, not the wiring table.
- C1 anchors are a maintained contract — the fix must live in the materialization
  layer, never by rewriting skill text to relative references.
- `.jspace/skills/` remains the harness-agnostic SSOT and the only physical copy.

## Target architecture

```
<workbench>/.jspace/skills/<name>/        ← physical files (SSOT, unchanged)
<workbench>/.agents|  .claude|  .grok|  .opencode/skills/<name>  → symlink → ../../.jspace/skills/<name>  (relative; two levels up from .claude/skills/)
~/.agents/skills/<name>                   → symlink → <wbRoot>/.jspace/skills/<name>          (absolute; cross-tree)
```

Why directory links, not per-file links: one link per (skill × projection) keeps
link count at 7×5=35 per workbench instead of 42×6; a skill's file set can change
on upgrade without touching links; realpath dedup in Pi works at the resolution
root level exactly the same.

Why this dissolves both failure modes:

- Collision: every harness root resolves (realpath) into the same SSOT dir →
  Pi's `realPathSet` dedups silently; first-wins order stops mattering because
  first == second == … == SSOT.
- Divergence: reading through any projection IS reading SSOT. `skip`-drift between
  copies becomes unrepresentable; the one remaining divergence surface is a legacy
  kept copy (handled visibly, below).

Unchanged by construction (the point of doing it at the materialization layer):

- C1 absolute anchors resolve through `~/.agents/skills/<name>` → SSOT.
- `diffDirs` projection_drift follows links → compares SSOT against itself.
- Claude Code / OpenCode / Grok / Cursor file discovery follows directory
  symlinks (verified behavior for all four harnesses' skill loading).

## Mechanics

### 1. Materializer link mode

- `materializedRels()` (skills branch) returns SSOT per-file rels (unchanged) and
  stops expanding projection per-file rels; instead the materializer emits ONE
  link entry per `(skill, projection)` — new journal entry kind
  `{ kind: "link", target }` in `materialized.json` (contract version bump +
  migration).
- **Journal carry-over, verified against `journal.ts:75` (`writeUpdatedMaterializedJournal`)**:
  the apply-time rewrite iterates `manifest.files × materializedRels()` only, so
  per-file projection entries that leave the mapping are dropped from
  `materialized.json` on the FIRST thin-link apply — no bespoke journal cleanup
  needed for the happy path. Two consequences to handle explicitly:
  (a) diff-time (BEFORE that first apply) the old rels surface through the
  recorded-loop (`manifest.ts:159`): never-touched copies → `remove`
  (`unlinkSync`, `workspace.ts:318`) — but that removes FILES, not the skill
  DIR, so the dir→link collapse is still a bespoke apply step (rmdir + symlink,
  see §3); (b) a copy whose content was refreshed to match the NEW bundle reads
  as `stale` (recorded-sha mismatch), i.e. "kept" — content-based judgment (§3)
  must override the journal verdict, or such copies silently stay copies.
  (c) `stale` copies that stay keep no journal record after the rewrite — they
  remain visible only through doctor's `diffDirs` projection check.
- Link creation order: write SSOT files first, then links (never link before
  target exists).
- Relative targets inside the workbench (survives workbench moves / cloud sync);
  absolute for `~/.agents/skills` (cross-tree by definition, per-machine state).

### 2. Fallback (must be visible)

`symlinkSync` failure (Windows non-developer mode, exotic filesystems):

- directory junction on Windows (`symlinkSync(target, path, "junction")`) first —
  junctions need no elevation and satisfy realpath-style dedup;
- junction/link both impossible → **copy + `info:` line** in init/upgrade output
  ("projection kept as copy: <reason>") and a `skills.copy_fallback` doctor info
  listing affected roots. Never silently degrade.
- Junction caveat (verified Node semantics): `symlinkSync(…, "junction")`
  normalizes the target to an ABSOLUTE path — junctions cannot be relative, so
  the workbench-movable property of in-workbench links is POSIX-only; a moved
  workbench on Windows shows broken junctions and repairs via
  `workspace upgrade` (which recreates them at the new location).

### 3. Migration on `workspace upgrade` (legacy workbenches)

Judgment is **content-based** (`diffDirs`-empty), never journal-based — the
journal's recorded-sha verdict misclassifies a copy that was refreshed to match
the new bundle as `stale` (see §1b). For each `(skill, projection)` where a REAL
directory sits where a link belongs:

- content-identical to SSOT (`diffDirs` empty) AND no unrecorded files inside
  (runtime artifacts like `__pycache__` are not bundle keys) → rmdir the dir,
  create the link, and register the `link` journal entry (this collapse is a
  bespoke apply step — the generic `remove` path only unlinks files,
  `workspace.ts:318`);
- differs → KEEP the real dir as copy, emit info `skills.divergent_copy` naming
  the path and the converge command sequence (delete + re-upgrade). No destruction
  of possible user edits — the issue's own convergence path stays manual.
- a regular FILE (or broken remnant) where the dir-link belongs — the signature
  of a Windows git checkout with `core.symlinks=false`, since `.jspace/skills/`
  and the projection dirs are workbench-git-tracked (verified: workbench
  `.gitignore` excludes none of them) — is NOT user content (its bytes are the
  link target text) → replace with junction/copy, no prompt.

`~/.agents/skills`: same rule via `skills install` (idempotent; `--refresh`
re-points an existing link whose target moved — the multi-workbench case).

### 4. Doctor additions

- `skills.duplicate_roots` (info): fires when a harness's discovery set contains
  two official skill roots — driven from capabilities.yaml data (pi currently:
  `user_install` + shared projection). Message states which copy wins (the link /
  same-realpath SSOT after this change).
- Structural link check (extends the existing projection check): entry exists,
  is a link (or accepted copy-fallback), and its resolved target == SSOT dir.
  Wrong-target/broken link → warning with the repair hint (`workspace upgrade`).
  The broken case matters most for `~/.agents/skills` pointing into a cloud-synced
  workbench that is currently unmounted: harnesses silently skip broken skill
  roots, so only this doctor check makes the absence visible.

### 5. Docs / wiring text

- Workbench README template + jspace-use registry.md: "同字节投影" wording →
  "薄链投影（symlink → .jspace/skills，物理副本唯一）"; gen-assets rerun (asset
  hashes change → commit generated files).
- `check-harness-consistency` assertions that phrase "projection" may need the
  same wording sweep — run it, don't assume.

## Decision points (D) — need sign-off before implementation

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | `~/.agents/skills` anchor with multiple workbenches on one machine | (a) link to workbench `skills install` ran from, re-point on each install/refresh; (b) keep user-level as copy (2 copies total, divergence window remains) | (a) — one truth; re-pointing is explicit and logged |
| D2 | Divergent legacy copies during migration | (a) keep + info (manual converge); (b) force relink (destroy) | (a) |
| D3 | Rollout | (a) default-on for fresh init + upgrade migration in one release; (b) behind a flag first | (a) — upgrade is already non-destructive by design; the migration is the release's point |
| D4 | Journal contract | new `link` entry kind + version bump vs. storing links out-of-band | new kind + bump — keeps materialized.json the single last-applied truth, reuses `remove` machinery |

## Rejected alternatives

- Per-harness exclusion configs (e.g. pi `.pi/settings.json` `!skills/**`):
  kills the warnings, keeps 6 copies and the divergence window, and needs a new
  config per future harness — the issue's 治标 option.
- Rewriting C1 to relative references: 95 anchors are a maintained multi-harness
  contract; relative refs break for harnesses whose CWD differs from the workbench
  root, and the body↔details pairing would then depend on which root loaded the
  body — strictly worse.
- Hardlinks: same-filesystem only (breaks `~/.agents` when workbench lives on
  another mount), and still per-file fan-out.

## Implementation order (sketch, each step independently green)

1. Journal contract: `link` entry kind + version bump + migration of recorded
   projection file entries → `remove` (pure contract work + tests).
2. Materializer: link mode for workbench projections w/ junction + visible copy
   fallback (init + upgrade paths).
3. `skills install`: user-level link mode + `--refresh` re-point.
4. Upgrade migration of legacy copies (identical→link, divergent→keep+info).
5. Doctor: `duplicate_roots`, structural link check, `copy_fallback`/
   `divergent_copy` infos.
6. Docs/templates wording sweep + gen-assets + full check suite.

Risks / watchpoints:

- Harnesses that *copy* trees on their own (some tools snapshot skill dirs) may
  materialize copies again — observe real pi/claude behavior on the smoke
  workbench before flipping default.
- Cloud-synced workbenches: sync engines handle dir symlinks inconsistently
  (some re-materialize as copies); acceptable — worst case is today's status quo
  plus a visible doctor info once sync diverges.
- Rollback across a migration de-links: the before-backup stores file CONTENT
  (backup write reads through links, `workspace.ts:280`), so `--rollback`
  restores real copies, not links. Consistent (copies are the old world) but the
  doctor infos will re-appear after a rollback — expected, document in release
  notes.
- Git sync upside worth stating: SSOT and links are both workbench-git-tracked,
  so a content edit shows as ONE changed file in `git status` (instead of five),
  and clones on macOS/Linux materialize valid relative links automatically;
  Windows checkouts are covered by the §3 file-remnant case.
- `bun build` compiled binary unaffected (assets embedded; links are runtime).
