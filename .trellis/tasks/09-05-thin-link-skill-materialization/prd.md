# thin-link official skill materialization (issue #39, design needed)

Source: https://github.com/jionpz/jspace/issues/39

## Goal

Official skills exist as ONE physical copy per workbench (`.jspace/skills/`, the SSOT);
every harness projection (`.agents/` `.claude/` `.grok/` `.opencode/skills/`) and the
user-level `~/.agents/skills/` reference it through directory symlinks instead of
holding byte-identical full copies. This structurally eliminates (a) harness name
collisions from duplicate roots (Pi realpath dedup starts working) and (b) the
「正文 ↔ 细则」 divergence where SKILL.md loads from one copy while its absolute
`~/.agents/skills/...` anchors resolve into another, silently stale one.

## Problem (verified, issue #39)

- 6 full copies per machine (42 files × 6 roots = 252 entries); Pi reports 7 name
  collisions because it dedups only by realpath (copies have different inodes).
- `workspace upgrade` can split body↔details in one step (workbench roots `skip`
  stale local copies while `~/.agents` gets refreshed); `skills.projection_drift`
  only compares workbench projections ↔ SSOT and is blind to user-level divergence;
  `--accept-conflicts` can't converge `skip` entries (only manual deletion does).
- One upgrade = 5× fan-out in diff/journal/doctor (8 real changes reported as 41).

## Requirements (outcome level)

1. Materializer gains a link mode: per-skill **directory symlink** for each
   projection + user-level install; physical files stay only in `.jspace/skills/`.
2. Platforms without symlink privilege fall back to copy **visibly** (info line,
   never silent look-alike copies).
3. Existing workbenches migrate via `workspace upgrade`: content-identical legacy
   copies collapse into links; locally-divergent ones are preserved as copies and
   reported (never destroyed).
4. Doctor: `skills.duplicate_roots` (info) when a harness sees two official skill
   roots; link-target structural check; `skills.projection_drift` stays valid
   (through-link content compare) and becomes structurally impossible while links
   hold.
5. Docs/templates wording updates wherever "同字节投影/byte-identical copy" is
   contractual (workbench README template, jspace-use), then gen-assets rerun.
6. C1 absolute anchors (`~/.agents/skills/...`) keep resolving unchanged — they
   traverse the user-level link; skill content itself is NOT edited.

Full architecture, decision points and migration semantics: see `design.md`.

## Acceptance Criteria

- [ ] Fresh `init` workbench: `.jspace/skills/<name>` real dirs; all projections +
      `~/.agents/skills/<name>` are symlinks resolving into it; `pi` diagnostics
      show no jspace skill collisions.
- [ ] Upgrade on a legacy workbench: identical copies → links (journal shows
      collapse, not 5× fan-out); divergent copies kept + reported; after manual
      convergence, re-upgrade relinks.
- [ ] No-privilege fallback path test: link failure → copy + visible info.
- [ ] doctor: `duplicate_roots` fires for pi wiring; no drift warnings on linked
      workbenches; divergence between a kept legacy copy and SSOT is visible.
- [ ] `tsc` / `bun test` / `check-skills` / `check-harness-consistency` /
      `check-manifest-integrity` green; gen-assets rerun leaves no diff.
- [ ] Commit references issue #39.

## Key Decisions

- (open, see design.md §D) user-level `~/.agents/skills` anchor when multiple
  workbenches exist — recommended: link to the workbench `skills install` ran
  from; `--refresh` re-points.
- (open) migration default for divergent legacy copies — recommended: keep as
  copy + info, no destruction.
