# Ingest Cleanup Recovery And v1.0.5 Implementation Plan

## M1. Cleanup Recovery Contract

- [x] Add explicit cleanup-pending semantics (`failed + failedStep=committed`) without changing `IngestJournalV1` shape/version.
- [x] Make `--complete` persist cleanup-pending before source deletion and committed only after cleanup is known complete.
- [x] Make repeated `--complete` recover when source exists or is already absent.
- [x] Prevent `begin` from creating a second ingest while cleanup is pending.
- [x] Return nonzero, truthful output and an exact retry action when cleanup fails.
- [x] Make list/status human output identify cleanup pending; retain stable JSON shape.

Validation gate:

```bash
bun test core/contracts/ingest.test.ts application/ingest/journal.test.ts application/ingest/use-cases.test.ts
bunx tsc --noEmit
```

- [x] 32/32 ingest tests pass (baseline 23 → +9 regressions); `bunx tsc --noEmit` clean.
- [x] CLI e2e (temp workbench): unlink-blocked `--complete` → exit 1 + retry action; begin while pending → exit 1, no second journal; retry after unblock → committed, source removed; status/list/--json shape verified.

Rollback point: state-machine/application changes stay reviewable before generated docs or version changes.

## M2. Skill And Operational Documentation

- [x] Update asset-ingest single-file and batch recovery instructions for cleanup pending and same-command retry.
- [x] Update README/headless operations only where they currently promise `complete` always removes source.
- [x] Regenerate embedded assets and confirm source/materialized references remain aligned.

Validation gate:

```bash
bun run scripts/gen-assets.ts
# 保存第一次生成结果，再生成一次并逐文件 cmp，证明生成确定性；
# 此阶段 generated files 本来就有预期 diff，不能用 git diff --exit-code 判 freshness。
ASSET_SNAPSHOT_DIR=$(mktemp -d)
cp cli/assets.generated.ts cli/manifest.generated.ts cli/skills.generated.ts "$ASSET_SNAPSHOT_DIR/"
bun run scripts/gen-assets.ts
cmp "$ASSET_SNAPSHOT_DIR/assets.generated.ts" cli/assets.generated.ts
cmp "$ASSET_SNAPSHOT_DIR/manifest.generated.ts" cli/manifest.generated.ts
cmp "$ASSET_SNAPSHOT_DIR/skills.generated.ts" cli/skills.generated.ts
bun test cli/assets-reachability.test.ts cli/lifecycle-and-safety.test.ts
```

- [x] gen-assets 重跑两次逐文件 cmp 一致(确定性);reachability/lifecycle 10/10;tsc clean。
- [x] 同步修正 SKILL/batch/README/headless-ops 中失效命令面(`ingest <id> --complete` → `ingest advance <id> --complete`;`ingest <id> --fail` → `ingest fail <id> --reason`),并写入 cleanup-pending 发现/重试路径。
- [x] 模板无物化 skill 副本(init 时从嵌入资产生成);skills-manifest 集合与版本号未变,无需改动。

## M3. Full Pre-Version Quality Gate

- [x] Run `bunx tsc --noEmit`.
- [x] Run all Bun tests; total must be at least 219.
- [x] Run Office extraction tests.
- [x] Run temporary-workbench full-chain integration without real scheduler/gbrain/filehub/home mutation.
- [x] Run `trellis-check`; resolve all release-blocking findings.
- [x] After M1-M2 changes are committed/staged as intended, rerun `bun run scripts/gen-assets.ts` and assert it produces no additional working-tree diff.

Commands:

```bash
bunx tsc --noEmit
bun test
python3 skills/asset-ingest/scripts/office-extract.test.py
# mirror .github/workflows/verify.yml full-chain in mktemp-backed paths
```

- [x] tsc clean; `bun test` 231 pass (≥219); office-extract PASS; temp workbench full-chain (init/doctor/domain/filehub/resource/cron dry-run+install+check+status/workspace diff+upgrade) all pass.
- [x] trellis-check(独立子代理):0 release-blocking;3 should-fix + 2 nits 全部修复:
  - ingestStatus 改用 `completeRetryCommand` 单一事实源;
  - 补崩溃矩阵第 1 行(pending 写失败→仍 index→重试收敛)回归 + advance/fail/rollback 对 cleanup-pending 拒绝的回归;
  - 补 fail-at-index→failedStep=committed→--complete 收敛回归(文档化该语义会合);
  - completeIngest pending 写失败携带可执行重试提示;beginIngest 同路径新文件场景加注释。
- [x] generated freshness:重跑 gen-assets 与工作树逐字节一致。

## M4. Deterministic v1.0.5 Preparation

- [x] Change `package.json` version to `1.0.5`.
- [x] Run `JSPACE_BUILD_VERSION=v1.0.5 bun run scripts/gen-version.ts`.
- [x] Run `bun run scripts/gen-assets.ts`.
- [x] Assert package/CLI/bundle versions all equal `1.0.5`.
- [x] Re-run tsc, full tests, Office tests and generated freshness.
- [x] Build a local binary into a temporary path; assert `--version` and initialized marker version.
- [x] Review complete diff for scope, generated files, secrets and unrelated changes.

Rollback point: no tag or remote mutation exists yet; version preparation can be corrected normally.

- [x] package.json / version.generated.ts / BUNDLE_MANIFEST.bundle_version 均为 1.0.5;tsc + 231 tests + office 全过。
- [x] 本地二进制:`--version` → `jspace 1.0.5`;init 后 marker `template_version=1.0.5`;doctor OK。
- [x] diff review:14 文件、范围干净;assets 仅重嵌入 3 个编辑文档 + bundle_version;占位符 API key 为既有配置示例非真实密钥;无无关改动/未跟踪文件。

## M5. Commit And External Release Gate

- [x] Commit reviewed implementation/version changes according to Trellis Phase 3.4.
- [x] Present commit SHA, final diff summary and local evidence to the user.
- [x] Obtain explicit approval for push/tag/release external actions.
- [x] Push `main` normally; wait for `verify` success at the exact release SHA.
- [x] Create a new annotated `v1.0.5` tag and push it once.
- [x] Wait for all build, release and install jobs; apply the PRD failure classification if anything fails.

Hard gate: tag creation is forbidden before exact-SHA remote verify success. No force-push or tag movement.

- [x] push main `f951e3f..7e0d3fc`(2 commits);远端 verify 在精确 SHA `7e0d3fc` success。
- [x] annotated tag `v1.0.5` → `7e0d3fc`,推送一次(`[new tag]`,remote 52548d6);build run 30897412032 completed success(六平台编译+binary smoke+checksums+Release+3 平台 install smoke)。

## M6. Published Artifact Verification And Wrap-Up

- [x] Confirm Release non-draft/non-prerelease and release notes describe the cleanup fix.
- [x] Confirm six platform binaries plus `checksums.txt`.
- [x] Download current-host asset and checksum into a temporary directory; verify SHA-256.
- [x] Assert published binary `jspace 1.0.5`, temp init/doctor success and marker `template_version=1.0.5`.
- [x] Confirm tag history contains `f951e3f` and the cleanup recovery fix.
- [x] Run final Trellis check/spec decision, record session and archive task only after every AC is satisfied.

- [x] Release v1.0.5 非 draft/非 prerelease;release notes 已补写(原子持久化 + source cleanup 可恢复)。
- [x] 六平台二进制 + checksums.txt 齐全;本机(arm64)资产 SHA-256 校验 OK、`jspace 1.0.5`、marker `template_version=1.0.5`、doctor OK。
- [x] tag history 含 `f951e3f` 与 cleanup recovery fix(`39f2b17`)。
- [x] 全部 10 项 AC 满足;spec 已更新(error-handling.md cleanup-pending 约定,本地);任务归档。
