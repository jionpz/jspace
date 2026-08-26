# Security Policy

## 支持的版本

安全修复优先合入**当前最新正式发布版**（GitHub Releases 上的最新 `v*` tag）及 `main` 分支上的后续补丁。

| 版本 | 支持 |
| --- | --- |
| 最新 `v*` release | ✅ |
| 更早的 release | ❌ 请升级到最新版 |
| 源码 `main` | ✅ 开发中的修复会合入 main |

安装脚本与 `jspace update` 默认拉取最新 release；长期使用旧版本需自行承担未修复风险。

## 报告漏洞

如果你发现 JSpace 的安全问题，请**不要**在公开 Issue 中披露可利用细节。

请通过以下方式私下报告：

1. **GitHub Security Advisory**（推荐）：在 [jionpz/jspace](https://github.com/jionpz/jspace) 仓库使用 **Report a vulnerability**（Security → Advisories）。
2. **私密联系**：若无法使用 Advisory，可在仓库维护者可见的私密渠道联系（例如已建立协作的维护者邮箱或私信），标题注明 `JSpace security`。

报告请尽量包含：

- 影响版本与平台（OS/arch）
- 复现步骤或 PoC（若可行）
- 影响评估（数据泄露、权限提升、远程代码执行等）
- 你是否愿意被致谢（可选）

## 响应说明

我们会确认收到并评估报告的严重性与可利用性。修复合入后会在 release notes 或 advisory 中说明（在不影响用户安全的前提下）。

**我们不承诺**固定响应时间、SLA 或赏金计划；处理节奏取决于严重性与维护者可用时间。

## 范围说明

- **在范围内**：JSpace CLI、安装脚本、`jspace init` 生成的工作台模板与官方技能中由本仓库维护的代码路径。
- **典型不在范围内**：用户自建的 domain/skill、第三方 harness（Claude Code / Cursor 等）自身漏洞、gbrain 上游问题（可向对应项目报告）、用户机器上错误配置的 cron 或网盘同步。

感谢负责任地披露。
