# Issue #2 修复 — 总体技术设计

## 分层不变式

- **依赖方向**:`cli` → `application` → `core`;`adapters` 是 `application` 的端口实现,不反向。P2-1/P2-7 的所有改动不得制造反向依赖。
- **机器真相**:同一天 cron 是否已跑 → 以结构化 RunRecord 为准,prose log 只是人类 payload(P0-1 确立的原则,扩散到 pending/ingest 的 issues 转发 P2-6)。
- **计数唯一实现**:`_inbox/` 计数唯一在 `application/registry/inbox.ts`(顶层项 + 10000 cap),doctor/context 全部复用(P0-2)。
- **契约即真相**:`SchedulerEnv`/contract decoder 的参数与注释必须等于实际使用(P1-3、P2-5 精神),无死字段、无过期注释。
- **schema 版本唯一形态**:所有 contract 用 `schema_version: number`(P2-2)。
- **CLI 退出协议**:`CmdResult { exitCode, lines }`,不走 `process.exit`(P2-7)。
- **模板资产同步**:任何 `templates/` 改动必须重跑 `scripts/gen-assets.ts`(memory: jspace-cli-assets-regeneration),否则 verify CI 红。

## 关键决策

1. **P1-1 version 一致性检查**:CI 上 `git describe` 受 fetch-depth 限制 → 采用「`git fetch --unshallow` 后 gen-version + diff」,若成本高则退化为 tag 构建检查并记录原因。
2. **P2-3 诊断聚合位置**:采用 `application/diagnostics/` 新目录(而非搬 CLI)—— 诊断逻辑仍是应用领域行为(读 workbench/pending/gbrain 等),CLI 只做展示;`application/diagnostics/` 可 import 各 application 子模块,但其它 application 子模块不得反向 import 它。
3. **P4-1 `.trellis/`**:保留。archive 有 60+ 归档任务,非 dead weight;本任务正依赖 Trellis。在 prd 记录决策,不删目录。
4. **P0-4 skill drift**:upgrade 链路用 hash-compare(相同跳过、不同刷新),不引入破坏性 `--force` 全量覆盖语义。
5. **顺序依赖**:p0 → p1 → p2-data-integrity → p2-architecture → p3-p4。P1-3 先于 P2-1(同文件)、P2-4 先于 P2-3(doctor 拆分是前提)。

## 数据面注意

- 本机主工作台 `~/jspace-work` 是真实环境(schema v4)。P2-2 改 hub contract 后需验证主工作台能平滑读 / 重建,doctor 保持 0 warning;不改动用户数据,仅 contract 校验层。
- 仓库 PUBLIC:示例 / 测试用中性路径(acme/12800/~/filehub),不引入真实个人数据。
