# 全项目 8 维专家评审

## Goal

对 jspace 开发仓库（`/Users/jionpz/mycode/jspace`，bun+TypeScript CLI，v1.0.5）召开专家团队全项目 review，产出**分级发现报告 + 修复建议**。本轮只评审、不改代码。

## Scope

评审对象（全量，git status 干净基线）：

- `core/` — contracts（typed decoders）+ registry（effective merge / inspect / migrations）
- `application/` — automation / commands / ingest / pending / registry / workspace
- `adapters/` — fs / harness / scheduler（darwin·linux·win32）
- `cli/` — main / commands / cron / update / registry / embed + generated assets
- `templates/`（workbench + filehub）、`skills/`、`install/`（三平台脚本）、`docs/PLATFORMS.md`、CI 配置
- 对齐基准：`.trellis/spec/backend/` 声明的实际约定（directory-structure / error-handling / quality / logging / database=N/A）

评审 8 维：

1. **架构分层与依赖方向** — core→application→adapters→cli 单向、application 不得 import cli、重复与无效抽象
2. **正确性与边界条件** — 类型安全、async 正确性、null/空/并发边界、错误处理与 CmdResult
3. **安全与隐私红线** — 与 `~/.agents` 红线对齐：密钥/令牌、路径注入、破坏性操作防护、网络出口、远程代码执行、日志敏感字段
4. **测试质量** — 覆盖充分性、断言有效性、隔离性（不碰真实 home/cron/filehub）、纯测试 vs 集成
5. **数据一致性 / 可靠性** — journal 原子写、pending envelope、迁移机制、ownership 三态、cron 幂等、升级保护
6. **跨平台** — scheduler darwin/linux/win32、路径/shell 差异、CI 6 平台全绿
7. **CLI·UX·文档** — 命令面一致性、错误信息可读、README/docs/模板与实现无漂移
8. **发布分发** — version.generated 同步、gen-assets 确定性、build 产物、install 脚本下载/校验/回滚

## Constraints

- **只评审不改代码**：产出修复建议，不执行修复；验收要求 `git diff` 干净。
- 每条发现必须带**证据**（`file:line` + 引用片段）与**失败场景**。
- 严重度分级：`P0` 阻断/高危 · `P1` 重要 · `P2` 一般 · `P3` 建议。
- 与红线冲突项（密钥泄漏、无防护破坏性操作、未批准网络出口等）单独高亮，不因「仓库是开发层」而降级。
- 仓库 PUBLIC：评审中发现任何示例引用了真实个人/项目数据要单独标出（对照 `jspace-no-real-data-examples` 记忆）。
- 评审不引入新数据、不触发真实副作用（不写真实 home/cron/gbrain/filehub）。

## Acceptance Criteria

- [ ] 8 个维度各有一名专家 agent 独立评审，产出结构化 findings（维度/严重度/证据/失败场景/修复方向）。
- [ ] 全部 P0/P1 findings 经对抗性验证（attempt-to-refute），每条标注 `CONFIRMED / REFUTED / PLAUSIBLE`。
- [ ] 跨维度去重（同文件同点合并），最终分级报告写入 `.trellis/tasks/08-05-project-review/report.md`。
- [ ] 报告含：总结论、P0/P1/P2/P3 分级清单、每维覆盖说明与未验证项、修复优先级建议。
- [ ] 无任何源码改动（`git status` / `git diff --stat` 验证干净）。
- [ ] 任务按 Trellis Phase 3 收尾（有值得沉淀的规范才更新 spec；commit 只含任务规划/报告产物）。

## Notes

- 修复执行不在本任务范围；若用户后续要求修复，另行开任务。
- 评审过程若暴露「代码与已声明 spec 不一致」，记录在报告，不擅自改 spec 或代码。
