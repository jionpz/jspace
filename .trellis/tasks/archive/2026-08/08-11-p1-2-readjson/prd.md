# #9-03 [P1-2] doctor readJson lambda 兜底

## Goal

doctor 注入的 readJson 闭包在解析异常时返回结构化失败，供上层转 info，不再 throw。

## Requirements

- 文件：`application/diagnostics/doctor.ts`（约 :738，注入 readJson 闭包处）。
- 闭包内捕获解析异常，返回结构化失败；若需要调整 inspect.ts 调用方一并改。

## Acceptance Criteria

- [ ] 与 #9-02 同一测试文件新增用例，断言不再 throw。
- [ ] 正常解析路径行为不变。
