# 核心契约与可移植/本机状态分层 — Implementation Plan

## Execution Strategy

按“合同先行、repository 次之、消费者最后切换”的顺序实施。每一步保持可测试；模板与全部消费者完成切换后才生成 embedded assets，避免同时存在 v3/v4 两套运行合同。

## Phase 1. Contract Tests and Types

- [x] 扩展 tsconfig.json include，建立 core/contracts 与 core/registry。
- [x] 先写 hub v4、local v1、marker v1、distribution manifest v1 的失败/成功 table tests。
- [x] 实现 shared diagnostics、ID/path helpers 和 typed decoders。
- [x] 覆盖 strict boolean、unknown field、duplicate/reference/path traversal、round-trip。

Validation:

    bun test core
    bunx tsc --noEmit

Rollback point: pure core files独立，不修改模板或现有运行路径。

## Phase 2. Effective Registry and Filesystem Repository

- [ ] 实现 hub + local binding resolution 与 resolved|unbound|missing projection。
- [ ] 实现 domain/project/filesystem inspection 和 stable diagnostic codes。
- [ ] 实现 deterministic atomic JSON writes。
- [ ] 实现 paired hub/local mutation compensation，并注入 second-write failure 测试。
- [ ] 增加 missing-local、invalid-local、unused-binding 和 two-machine fixtures。

Validation:

    bun test core adapters
    bunx tsc --noEmit

Rollback point: repository 尚未接入 CLI；现有 v3 路径仍可运行。

## Phase 3. Init and Template Baseline

- [ ] 把模板 .jspace/hub.json 切换到 v4，增加 projects: []。
- [ ] .gitignore 增加 .jspace/local.json 与未来 .jspace/state/ runtime slot。
- [ ] init 生成 portable marker ID 与 machine-local installation ID，移除 marker source。
- [ ] 更新 bootstrap registry reference 和工作台文档中的 portable/local 说明。
- [ ] 新增 fresh-init 与 clone-without-local integration fixtures。

Validation:

    bun test cli
    bunx tsc --noEmit

Rollback point: 模板切换与 CLI consumer 切换必须在最终提交中保持一致；中间阶段不生成 assets。

## Phase 4. Registry Commands and Consumers

- [x] 将 cli/registry.ts 变为新 core/repository 的 compatibility facade。
- [x] 迁移 domain list/add/remove 到 typed hub mutations。
- [x] 迁移 resource list/add/remove 与 filehub register 到 paired hub/local mutations。
- [x] 迁移 doctor 到 structured contract/runtime diagnostics。
- [x] 迁移 inbox locate 和 cron filehubRoot/pending scan 到 shared effective resolver。
- [x] 删除上述路径中的 raw registry casts 和重复 entrypoint traversal。
- [x] 更新 cron fixtures 为 hub v4 + local v1。

Validation:

    bun test
    bunx tsc --noEmit

Rollback point: consumer migration按 domain/resource -> filehub/inbox -> doctor/cron 分批 review；任一消费者仍解析 raw hub 时不进入下一阶段。

## Phase 5. Generated Assets and Full Smoke

- [x] 运行 asset generator，确认只包含预期模板/文档变化。
- [x] 验证 generated asset freshness。
- [x] 创建临时工作台，检查 hub/marker/local shape 和 local ignore。
- [x] 演练 domain/resource list/add/remove 与 filehub register。
- [x] 用第二份 local fixture 替换绑定，验证 logical identity 不变、resolved path 改变。
- [x] 运行 doctor 并核对 invalid/unbound/missing/drift 分类。

Validation gate:

    bun run cli/main.ts --version
    bunx tsc --noEmit
    bun test
    bun run scripts/gen-assets.ts
    git diff --exit-code cli/assets.generated.ts

    SMOKE_DIR=$(mktemp -d /tmp/jspace-core-contracts.XXXXXX)
    bun run cli/main.ts init "$SMOKE_DIR"
    bun run cli/main.ts doctor --dir "$SMOKE_DIR"

Registry command smoke 在 SMOKE_DIR 内依次覆盖：

- domain list/add/remove
- resource list/add/remove --path <temporary absolute path>
- filehub init <temporary path> --register
- hub 无绝对 path value、local 有 binding value

## Cross-Layer Review Checklist

- [x] 每个 JSON contract 只有一个 decoder/encoder owner。
- [x] 所有 consumer 搜索不到 raw hub/local casts 或 entrypoint 私有解析。
- [x] Template、docs、fixtures、generated assets 与 version 常量一致。
- [x] doctor 不写状态，init/mutation 命令才创建 local。
- [x] Missing local 不被误判为 invalid hub；missing external path 不被误判为 schema invalid。
- [x] Project asset drift 在 filehub unbound 时为 unverifiable。
- [x] v3 只有明确拒绝路径，没有隐式 migration。
- [x] 测试只操作自己创建的临时目录。

## Files Expected to Change

- core/contracts, core/registry
- adapters/fs/workbench-state.ts
- cli/registry.ts, cli/cmds.ts, cli/cron.ts, cli/init.ts
- corresponding test files
- templates/workbench/.jspace/hub.json, templates/workbench/.gitignore
- skills/jspace-bootstrap/references/registry.md
- cli/assets.generated.ts, tsconfig.json

## Deferred to Later Children

- Child B: project CLI、CommandSpec、workspace diff/upgrade、manifest generation。
- Child C: scheduler reconciliation 与 structured run/incident state。
- Child D: skill manifest 与 harness lifecycle。
- Child E: project gbrain/index integration 与 asset-ingest compensation。

## Pre-Start Gate

- [ ] 用户已审阅并批准本 child 的 Goal、schema baseline、In/Out Scope、Acceptance Criteria 与 v3 rejection。
- [ ] implement.jsonl 与 check.jsonl 均包含真实 spec/research 条目。
- [ ] task.py start 仅在上述批准后执行。
