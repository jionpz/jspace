# Child A State Contract Audit

## Scope

This audit records the current data flow that Child A must replace. It is evidence for planning and sub-agent context, not a proposed compatibility contract.

## Current Stored State

| File | Current role | Current issue |
| --- | --- | --- |
| .jspace/hub.json | v3 domains/resources registry | Path entrypoint stores machine absolute value; no projects. |
| .jspace/marker.json | init marker | Contains absolute source: devRoot(), no stable workbench identity or schema version. |
| .jspace/cron.json | portable cron declarations | Separate schema; not changed by Child A except consumers must still work. |
| .jspace/logs/ | runtime logs | Correctly gitignored; structured runtime redesign belongs to Child C. |
| .jspace/local.json | absent | No machine-local owner for bindings or installation identity. |

## Current Decode and Consumer Flow

    hub.json
      -> JSON.parse
      -> Record<string, unknown>
      -> validateHub(data, root, warnings)
      -> repeated local casts in:
           cmdDoctor
           cmdDomainList/Add/Remove
           cmdResourceList/Add/Remove
           registerFilehub
           locateInbox
           cron.filehubRoot/findPendingApplies

Evidence:

- cli/registry.ts:20-32 returns an untyped object.
- cli/registry.ts:62-228 combines schema, workbench filesystem, domain metadata and external path checks.
- cli/cmds.ts:67-125 re-parses filehub for doctor.
- cli/cmds.ts:344-476 mutates raw arrays and stores absolute path values.
- cli/cmds.ts:526-539 independently resolves the filehub inbox.
- cli/cron.ts:701-723 independently resolves filehub for pending writes.
- cli/cron.test.ts:138-161 builds v3 fixtures with inline absolute paths.

This is the same cross-layer failure mode described by .trellis/spec/guides/cross-layer-thinking-guide.md: every consumer owns a private projection of the payload.

## Required Target Flow

    hub.json ----> decodeHub -------+
                                    +--> resolveEffectiveRegistry --> typed consumers
    local.json --> decodeLocal -----+
                                          |
                                          +--> inspect filesystem --> diagnostics

    marker.json --> decodeMarker
    manifest ----> decodeDistributionManifest (contract only in Child A)

The decode boundary owns payload types and semantic invariants. Effective resolution owns binding projection. Filesystem inspection owns missing paths and drift. CLI commands may render or mutate typed state but may not parse raw JSON fields.

## Consumers That Must Move in Child A

1. cmdDoctor registry, filehub and project checks.
2. cmdDomainList/Add/Remove.
3. cmdResourceList/Add/Remove.
4. registerFilehub.
5. locateInbox.
6. cron.filehubRoot and pending apply discovery.
7. init marker/local-state creation.

The hand-written argument parser remains unchanged except for help text needed to describe the new storage behavior. CommandSpec migration belongs to Child B.

## State Boundary Decisions Inherited From Parent

- Hub is portable and moves to v4; local bindings are gitignored.
- Project is a minimal stable cross-layer identity, not a new service.
- gbrain remains external and is not wrapped.
- Pre-release status allows v3 to be rejected in normal operation.
- Workspace migration belongs to Child B.
- No real scheduler, home configuration, gbrain store or filehub is mutated by tests.

## Test Gaps

- No registry.test.ts or doctor contract suite exists.
- Current cron tests only exercise the v3 inline-path representation.
- No fixture proves the same logical hub resolves on two machines.
- No fault test covers paired hub/local mutation.
- No test distinguishes missing local, unbound binding and missing external path.

## Planning Consequence

Child A must include consumer migration, not only new interfaces. Leaving old raw casts in place would create two competing registry contracts and repeat the parent task's primary failure class.
