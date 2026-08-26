# #9-02 [P1-1] doctor checkGBrain JSON 兜底

## Goal

doctor 只读诊断不再因非法 JSON 整体崩溃，降级为结构化 info。

## Requirements

- 文件：`application/diagnostics/doctor.ts`（checkGBrain）。
- JSON.parse 包 try/catch；解析失败 push `severity:"info"`、code `gbrain.config_invalid_json`（或本仓既有同类 code 规约），不抛出。

## Acceptance Criteria

- [ ] 新增 doctor.test.ts 用例：harness config 写成非法 JSON → doctor 成功返回、含上述 info，退出码 0。
- [ ] 无非法 JSON 时行为不变。
