# #9-07 [P2-1] tomlSkillsDirWired section 作用域

## Goal

tomlSkillsDirWired 严格限定目标 section，其它 server 段同 key 不误判。

## Requirements

- 文件：`application/diagnostics/doctor.ts:564-569`。
- 找到 [serverKey] 后只在该 section 与下一个 `[...]` 之间匹配 GBRAIN_SKILLS_DIR。

## Acceptance Criteria

- [ ] 单测包含「其它 server 段同 key 干扰」用例，断言不误判已 wired。
- [ ] 正常命中行为不变。
