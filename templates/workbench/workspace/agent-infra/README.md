# agent-infra domain - AI 资源管理

## 管理方式

本工作区所有 AI 资源均受 **cc-switch** 管理（`~/.cc-switch/`）。

## AI 客户端

| 客户端 | 说明 |
|--------|------|
| Claude Desktop | Anthropic 官方客户端 |
| Claude Code | Claude CLI/Code 工作流 |
| Codex | OpenAI Codex CLI |
| Gemini | Google Gemini |
| Pi | Pi Agent |

## 提供商站点资源

### 主力中转

| 提供商 | 端点 | 支持客户端 |
|--------|------|-----------|
| PackyCode | packyapi.com | Claude, Gemini |
| PackyCode2 | packyapi.com (备用) | Claude |
| DeepSeek | api.deepseek.com | Claude, Codex |

### 第三方中转

| 提供商 | 端点 | 支持客户端 |
|--------|------|-----------|
| AICodeMirror | api.aicodemirror.com | Codex |
| mirbuds | gpt.mirbuds.com | Codex |
| Mino-1 / mimo-1 | xiaomimimo.com | Claude, Codex |
| megallm | ai.megallm.io | Claude |
| GSCC Relay | gsccrelay.space | Claude |
| Code Router | api.code-relay.com | Claude |
| anyouter | anyrouter.top | Claude |
| 南玻万 | hone.vvvv.ee | Claude |
| Zhipu GLM | open.bigmodel.cn | Claude |

### 公益/拼车

| 提供商 | 端点 | 说明 |
|--------|------|------|
| 波奇酱公益站 | newapi.sorai.me | 公益中转 |
| 君公益站 / Temp1 | newapi.linuxdo.edu.rs | 公益中转 |
| 拼车 | code.sora.locker | API 拼车 |
| 黑与白 | ai.hybgzs.com | 自定义 |

### 本地测试

| 提供商 | 端点 | 说明 |
|--------|------|------|
| local-copilot | clawcloudrun.com | 本地代理测试 |

## 本地代理

- 地址: `127.0.0.1:2006`
- 功能: 自动故障切换 / 日志记录 / 健康检查

## 工作流

当用户说“弄一下 agent”或“管理 AI”时，读取本 domain 的 `README.md` 和 `domain.json`，再通过 `/Users/jionpz/.cc-switch` 管理 provider、model、proxy、client configuration 和 skills。

管理完 AI 配置后，用户会说“好了”或“去工作了”，此时确认下一步要进入哪个 domain。

## 本域进行中的项目

| 项目 | 资产目录 | 状态 |
|---|---|---|
| <项目id> | `filehub/projects/<项目>/` | 进行中 |

> 跟踪新项目三步(资产协议,见工作台 README「资产管理」):
> ① 资产层建 `filehub/projects/<项目>/index.md`(dashboard);
> ② 本表挂一行;
> ③ 记忆层建实体(gbrain,记录项目事实与指针)。
