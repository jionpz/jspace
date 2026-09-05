# update: suffixed local build must not be judged up-to-date (issue #40)

Source: https://github.com/jionpz/jspace/issues/40

## Goal

`jspace update` must never claim "已是最新" for a locally built binary whose version carries a
suffix (`1.0.17-local`, `1.0.17-5-gabc…`). Numeric equality with the latest release tag proves
nothing about content for such builds; the self-check must say so explicitly and point at the
two supported escape hatches.

## Problem (verified on main)

- `cli/update.ts` `parts()` splits on `[.+-]`, so `1.0.17-local` → `[1,0,17]` = `1.0.17` →
  `upToDate` true → `--check` prints 已是最新 and bare `update` early-exits. The user is stuck
  on stale content with zero signal (real case: v1.0.17 release had `usage-mileage.md` +
  6 extra SKILL.md lines that the `-local` workbench materialization lacked).
- `0.0.0` dev builds are already handled (`isDevVersion`); suffixed real-version builds are not.

## Requirements

1. Add an exported pure helper (e.g. `isPlainReleaseVersion(v)` — the exact inverse shape of
   `normalizeReleaseTag`'s accepted form, leading `v` allowed) distinguishing pure `X.Y.Z`
   from suffixed builds.
2. `--check`, when the current version is suffixed AND numeric-compare says up-to-date:
   - do NOT print 已是最新;
   - print that the current build is a local/non-release build whose content may differ from
     the same-numbered official release, so the numeric self-check is not trustworthy;
   - print both escape hatches: `jspace update --version vX.Y.Z` (switch to official binary)
     and rebuilding from source (keep local changes);
   - still show 当前版本/最新版本 lines (they are factual).
3. Bare `update` (no `--version`), same condition (suffixed + up-to-date): do NOT silently
   early-exit with 已是最新版本; print the same explanation + escape hatches and return without
   downloading. Switching to the official build stays an explicit `--version` decision —
   auto-replacing a custom local build would be a surprise overwrite.
4. Suffixed current version with numeric-compare OLDER than latest (`1.0.16-local` vs v1.0.17):
   keep the normal 可更新/update path (numeric comparison is still meaningful there).
5. Pure `X.Y.Z` behavior is unchanged byte-for-byte (existing output text preserved).
6. Regression tests in `cli/update.test.ts` via the existing `UpdateDeps` stubs:
   - `--check` with `1.0.17-local` vs v1.0.17 → no 已是最新, mentions 本地构建 and `--version` hint;
   - bare update same condition → no download attempted (fetch stub must not be called for the
     binary), guidance printed, exit 0;
   - `1.0.16-local` vs v1.0.17 → normal 可更新到 v1.0.17 / update proceeds;
   - pure `1.0.17` vs v1.0.17 → existing 已是最新 output unchanged;
   - helper unit tests: `1.0.17` false, `v1.0.17` false, `1.0.17-local` true, `1.0.17-5-gabc` true,
     `0.0.0-dev` true (dev form is also suffixed; the earlier isDevVersion branch just runs first).
7. Document the `-local` build convention where the build entry points already live
   (`docs/PLATFORMS.md` build section — one short paragraph: suffix means "same number,
   different content", and what `update` does about it). `scripts/gen-version.ts` itself needs
   no change (manual `JSPACE_BUILD_VERSION` injection is a legitimate feature).

## Constraints

- Keep the existing `compareVersions` semantics untouched (spec quality-guidelines documents
  them; the spec line will be updated in Phase 3.3 to record the new self-check rule).
- No new network calls; the guidance path must work offline (no fetch beyond the latestTag
  lookup that already happens).
- Command surface unchanged: still `jspace update [--check] [--version <tag>]`.
- English for code identifiers/comments per repo convention; user-facing CLI strings in Chinese,
  matching existing update.ts output.

## Acceptance Criteria

- [ ] All cases in Requirement 6 pass; `bunx tsc --noEmit` and `bun test` green.
- [ ] Manual smoke: `JSPACE_BUILD_VERSION=1.0.17-local bun run build` binary (or deps-injected
      equivalent) shows the warning, not 已是最新.
- [ ] `docs/PLATFORMS.md` documents the suffix convention and update behavior.
- [ ] Spec `quality-guidelines.md` version-contract line updated to record the new rule
      (Phase 3.3).
- [ ] Commit message references issue #40.
