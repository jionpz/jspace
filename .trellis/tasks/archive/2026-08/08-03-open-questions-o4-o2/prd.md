# 开放问题攻坚：#4 office 解析深度 + #2 文件中心选址迁移

## Goal

攻坚 GOAL.md 开放问题 #4（office 文件解析深度：excel/ppt 从「摘要+指针」加深到逐表/逐页可抽取、关键数字可召回）与 #2（文件中心选址决策 + 存量迁移策略），各自产出可验收交付并更新 GOAL.md 开放问题状态。

## Requirements

- 拆两个子任务，独立可验收：
  - **#4 office 深度解析**（`08-03-office-deep-extract`）：零依赖抽取器 + asset-ingest 深入路径 + 文档与验收。
  - **#2 文件中心选址与存量迁移**（`08-03-filehub-migration`）：选址决策记录 + 存量收编 runbook + 真实环境验证。
- 执行顺序：#4 先（技术自包含），#2 后（需要真实环境输入）。
- 都遵守 JSpace 纪律：记忆存「事实与指针」、资产存「文件本体」、不做重资产全量 embedding、失败即停、改动 templates/skills 后重跑 gen-assets + build。

## Acceptance Criteria

- [x] 两个子任务各自的 PRD/design/implement 评审通过后开工，交付物按各自验收标准核验。
- [x] GOAL.md 开放问题 #2 与 #4 更新为闭合/缓解状态（注明结论与依据）。
- [x] 涉及技能/模板的改动已同步编译产物（gen-assets + build），git 提交干净。
- [x] 父任务统一集成评审：两子任务交付互不冲突、纪律一致。

## Notes

- 研究结论（2026-08-03）：
  - 本机无 libreoffice/pandoc/pdftotext、无 openpyxl/python-pptx；gbrain v0.42 仅对 office 做 MIME 登记/存储、不解析内容；Read 工具读不了二进制 xlsx/pptx → 深度抽取必须自带零依赖抽取器。原型已验证：python3 stdlib（zipfile + ElementTree）可正确解 xlsx（多 sheet/共享字符串/数字/inline string）与 pptx（页序 + 文本）。
  - 技能分发：`skills/asset-ingest/` 整树经 gen-assets.ts 嵌入二进制并物化进工作台 → 抽取脚本放 `skills/asset-ingest/scripts/` 即可随 jspace 分发。
  - 现状：filehub 根已注册为 `/Users/jionpz/filehub`（`jspace-work` hub.json），已有真实语料（projects/报表模块、areas/周报、areas/机器学习），`_inbox` 当前为空。
