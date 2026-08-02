# jspace-dev domain

## Purpose

Maintain JSpace, the development repository that ships the workbench CLI and templates.

## Scope

- CLI in `cli/` (TypeScript/bun;`bin/jspace` 为 `bun run build` 编译产物)
- Workbench templates under `templates/workbench/`
- Bootstrap skill under `skills/jspace-bootstrap/`

## Workflow

When the user says "开发模式", read the JSpace dev repo `AGENTS.md` and edit the dev repo (`__DEV_ROOT__`). This workbench is generated output, not the template source; do not back-port workbench edits into the template.

## Entry Points

- Repository: `__DEV_ROOT__`
- CLI: `jspace`(编译二进制;源码检出:`bun run cli/main.ts`)

## 本域进行中的项目

| 项目 | 资产目录 | 状态 |
|---|---|---|
| <项目id> | `filehub/projects/<项目>/` | 进行中 |

> 跟踪新项目三步(资产协议,见工作台 README「资产管理」):
> ① 资产层建 `filehub/projects/<项目>/index.md`(dashboard);
> ② 本表挂一行;
> ③ 记忆层建实体(gbrain,记录项目事实与指针)。
