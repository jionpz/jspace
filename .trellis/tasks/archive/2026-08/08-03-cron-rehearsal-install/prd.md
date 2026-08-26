# cron rehearsal gate + 机器端 install

## Goal

M4/M5 显式后续:对已解锁 cron 任务(weekly-report/memory-consolidate,及 inbox-tidy)跑 rehearsal gate(jspace cron run 各一次核对产出位置/slug),验证契约后再 jspace cron install 装进 launchd。真实 JWorkspace 操作。

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
