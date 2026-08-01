# jspace-dev domain

## Purpose

Maintain JSpace, the development repository that ships the workbench CLI and templates.

## Scope

- CLI in `bin/jspace`
- Workbench templates under `templates/workbench/`
- Bootstrap skill under `skills/jspace-bootstrap/`

## Workflow

When the user says "开发模式", read the JSpace dev repo `AGENTS.md` and edit the dev repo (`__DEV_ROOT__`). This workbench is generated output, not the template source; do not back-port workbench edits into the template.

## Entry Points

- Repository: `__DEV_ROOT__`
- CLI: `__DEV_ROOT__/bin/jspace`
