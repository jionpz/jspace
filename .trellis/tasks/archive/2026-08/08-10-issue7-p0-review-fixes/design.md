# Issue #7 P0 — Design

## 现状与问题

| # | 缺陷 | 位置 |
|---|---|---|
| P0.1 | `session.created` spawn 丢弃 stdout 且未用 `--plain`，event 回调 side-effect only，注释声称「session-start injection」实际空转 | `templates/workbench/.opencode/plugins/jspace.ts:36-38` |
| P0.2 | `headlessArgv` 返回 `[bin, prompt]`，漏掉 capabilities 声明的 `run`；cron `harness: opencode` 会执行 `opencode <prompt>` 而非无头 `opencode run <prompt>`；测试断言同样错误 | `adapters/harness/opencode.ts:14`、`argv.test.ts:40` |
| P0.3 | compacting await 整段 stdout，无 timeout / 无退出码检查 / stdin 未 ignore；`jspace` hung 则永久阻塞 | `templates/workbench/.opencode/plugins/jspace.ts:65-78` |
| P0.4 | `release` 只依赖 `build`，tag 构建跳过 test 门禁 | `.github/workflows/build.yml:120` |

## P0.1 — session.created 真注入

### 调研结论（已核实 OpenCode 源码）

- **SDK 通道存在**：`client.session.prompt({ path, body })`，`body.noReply: true` 时仅创建 UserMessage、不触发 AI 生成循环（`packages/opencode/src/session/prompt.ts`：`const prompt = ... if (input.noReply === true) return message`）。SDK docs 明确标注对 plugins 注入 context 有用。
- **sessionID 可取**：`session.created` 事件 payload = `{ sessionID, info }`（`packages/schema/src/v1/session.ts`）；plugin event handler 收到 `{ event: { id, type, properties: event.data } }`（`packages/opencode/src/plugin/index.ts`），即 `event.properties.sessionID`。
- **client 可用**：PluginInput 含 `client`（`createOpencodeClient`）。

### 方案

`session.created` 分支：读 `event.properties.sessionID` → 跑 `jspace context session-start --plain`（带防护）拿文本 → 文本非空时 `client.session.prompt({ path: sessionID, body: { parts: [{ type: "text", text }], noReply: true } })`。全部 try/catch 静默，失败只丢注入、不阻塞 session。

**语义差异说明**：注入以一条可见 UserMessage 落在会话历史（非 system prompt）——这是 OpenCode 平台能提供的最大注入能力（compaction 通道只在压缩时注入；本通道在会话开头注入，最接近 Claude/Grok 的 SessionStart）。文档中如实说明。

### 可测性

保持纯函数骨架。当前 `createEventHandler(spawnFn, wbRoot)` 是纯函数、依赖注入 spawn。重构为：

```
createEventHandler(inject: InjectFn, wbRoot)   // InjectFn = (sessionID) => Promise<void>
```

- 真实 `InjectFn`（plugin 内）：跑 `runSessionStart()`（防护版）→ 非空则 `client.session.prompt(...)`。
- 单测 mock `InjectFn`：断言 session.created 分支以正确 sessionID 调用、idle 分支不变。

## P0.2 — headless argv 统一

`headlessArgv` 改为消费 `capability.headless.slice(1)`：

```ts
headlessArgv(prompt, _platform, bin) {
  const prefix = capability.headless.slice(1);   // claude/grok/pi = ["-p"], codex = ["exec"], opencode = ["run"]
  const argv = [bin, ...prefix, prompt];
  // claude/grok 的 argv_flags 追加逻辑不变（放在 prompt 之后，与现状一致）
  return argv;
}
```

**零行为变化验证**：claude `["claude","-p"]→slice(1)=["-p"]`、grok 同、pi `["pi","-p"]→["-p"]`、codex `["codex","exec"]→["exec"]`、opencode `["opencode","run"]→["run"]`。全部与现有 hardcode 逐字一致；仅 opencode 从「缺 run」变为「补 run」。统一后 `check-harness-consistency.ts`（P2.14 未来表驱动）无分叉可抓。

## P0.3 — Compaction 防护

真实 runner 用 Bun API 实现防护（模板 seed 不能 import 开发仓库的 `adapters/process/spawn.ts`）：

```ts
const proc = Bun.spawn(["jspace", "context", "session-start", "--plain"], {
  cwd: wbRoot,
  stdout: "pipe",
  stderr: "ignore",
  stdin: "ignore",
  signal: AbortSignal.timeout(8000),   // 超时 kill
});
const code = await proc.exited;
if (code !== 0) return "";
return await new Response(proc.stdout).text();
```

`AbortSignal.timeout` 在 Bun.spawn 支持 signal 时自动 kill；`proc.exited` 取退出码。全部 try/catch，失败返回 `""`。`createCompactingHandler` 纯函数签名不变，测试补超时 / 非零退出 mock。

## P0.4 — CI 门禁

`build.yml`：`release.needs: [build, test]`。`test` job 已含 tsc + bun test + check-skills，tag 发布必经。

## 兼容性 / 回滚

- **P0.2 / P0.4** 纯行为修正，无回滚面。
- **P0.1 / P0.3** 是模板 seed 文件改动，仅影响新 init / upgrade 生成的工作台；`gen-assets.ts` 需重跑同步嵌入 bundle（记忆：`jspace-cli-assets-regeneration`）。回滚 = git revert + 重跑 gen-assets。
- capabilities.yaml 仅注释改动（R1.5），无 schema 变更，`check-harness-consistency.ts` 不受影响。

## 风险

- `session.prompt` 在 session 刚创建时调用是否安全：源码显示 prompt 先 `sessions.get(sessionID)`，`session.created` 事件在 session 创建落库后 emit，安全。
- `AbortSignal.timeout` 对 Bun.spawn 的 kill 语义依赖 Bun 版本；模板不锁 Bun 版本，但失败路径返回 `""` 兜底，不阻塞 compaction。
