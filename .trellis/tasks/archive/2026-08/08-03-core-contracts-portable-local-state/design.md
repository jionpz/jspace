# 核心契约与可移植/本机状态分层 — Technical Design

## 1. Design Objective

把 registry 从“JSON object + scattered casts”改成单向依赖的状态管线：

    JSON files -> typed decode -> effective registry -> filesystem inspection -> CLI consumers

Child A 建立后续任务可依赖的状态合同，但不重写 CLI command framework，不实现 workspace upgrade，也不扩展到 cron incident 或 gbrain transaction。

## 2. State Ownership

| State | File/system | Portable | Owner |
| --- | --- | --- | --- |
| domain/resource/project logical identity | .jspace/hub.json | yes | Hub v4 contract |
| path binding and local installation identity | .jspace/local.json | no | Local v1 contract |
| logical workbench identity and template marker | .jspace/marker.json | yes | Marker contract |
| cron declaration | .jspace/cron.json | yes | Existing cron contract; Child C evolves it |
| runtime/log/incident/pending | .jspace/state/, .jspace/logs/ | no | Child C/D |
| memory facts and asset pointers | gbrain | separately portable | External gbrain contract |
| heavy asset body | filehub | no workbench git | Asset protocol |

.jspace/local.json is ignored. Marker is portable and must not contain a local source path.

## 3. Module Boundaries

Target layout:

    core/
      contracts/
        diagnostics.ts
        hub.ts
        local.ts
        workbench.ts
        distribution.ts
      registry/
        effective.ts
        inspect.ts
    adapters/
      fs/
        workbench-state.ts
    cli/
      registry.ts        # temporary compatibility facade for existing commands
      cmds.ts            # typed consumers; CommandSpec migration waits for Child B

Dependency direction:

- core/contracts depends only on JavaScript/TypeScript primitives.
- core/registry/effective.ts combines already-decoded values and may receive a path-existence callback for deterministic tests.
- adapters/fs owns JSON reads, atomic writes and filesystem inspection inputs.
- cli/registry.ts re-exports the new operations needed by existing commands; it does not define a second schema.
- cli/cmds.ts and cli/cron.ts consume typed projections and render messages.

tsconfig.json expands its include paths to cover the new core and adapters TypeScript trees.

## 4. Contracts

### 4.1 Hub v4

    interface HubV4 {
      version: "4";
      domains: Domain[];
      resources: Resource[];
      projects: Project[];
    }

    interface Domain {
      id: string;
      path: string;
      tags?: string[];
    }

    interface Resource {
      id: string;
      type: string;
      domain: string;
      entrypoints: Entrypoint[];
      tags?: string[];
      notes?: string;
    }

    type Entrypoint =
      | { id: string; kind: "path"; binding: string; primary?: boolean }
      | { id: string; kind: "url"; value: string };

    interface Project {
      id: string;
      domain: string;
      asset_rel_path: string;
      status: "active" | "archived";
    }

Invariants:

- IDs use the existing lowercase/digit/hyphen pattern.
- Domain/resource IDs remain globally unique; project IDs are unique within projects.
- Domain paths are normalized portable paths inside the workbench.
- Project asset paths use /, begin with projects/, contain no traversal, and resolve below the filehub root.
- Resource domain and project domain must exist.
- Every entrypoint ID is unique within its resource.
- A resource with path entrypoints has exactly one strict-boolean primary path.
- A path entrypoint has binding and no value; a URL entrypoint has value and no binding/primary.

### 4.2 Local v1

    interface LocalStateV1 {
      version: 1;
      installation_id: string;
      bindings: Record<string, string>;
    }

- installation_id is generated with crypto.randomUUID() when local state is created.
- Binding keys follow the same ID pattern.
- Values are non-empty absolute paths on the current platform.
- Secrets and provider configuration are not permitted fields.
- Missing local state is represented separately from invalid local state.

### 4.3 Marker v1

    interface WorkbenchMarkerV1 {
      schema_version: 1;
      product: "JSpace";
      workbench_id: string;
      template_version: string;
      created_at: string;
    }

workbench_id is generated once by init and remains stable when the portable workbench is synced. The old source field is removed.

### 4.4 Distribution manifest base

    type AssetOwnership = "managed" | "seed" | "user";

    interface DistributionManifestV1 {
      version: 1;
      bundle_version: string;
      files: Array<{
        path: string;
        sha256: string;
        ownership: AssetOwnership;
      }>;
    }

Only decoder/type/round-trip tests land in Child A. Child B decides the embedded artifact location, generates it and defines diff/upgrade conflict behavior.

## 5. Decode and Diagnostics

All decoders accept unknown and return:

    type DecodeResult<T> =
      | { ok: true; value: T }
      | { ok: false; issues: ContractIssue[] };

    interface ContractIssue {
      code: string;
      path: string;
      message: string;
    }

Rules:

- Do not throw for ordinary invalid fields; accumulate independent issues.
- Do not return a partial typed object after a failed decode.
- Do not perform filesystem I/O in decoders.
- Do not silently default a malformed field.
- Unknown fields are rejected for marker/local and contract-owned nested objects. Hub optional descriptive fields are explicitly enumerated.

Runtime inspection returns RegistryDiagnostic with severity error|warning plus stable code/path/message. Human output may change wording later; tests assert codes and typed projections.

## 6. Effective Registry

    interface EffectiveRegistry {
      hub: HubV4;
      local: LocalStateV1 | null;
      domains: Domain[];
      resources: EffectiveResource[];
      projects: EffectiveProject[];
    }

    interface EffectivePathEntrypoint {
      id: string;
      kind: "path";
      binding: string;
      primary?: boolean;
      resolved_path: string | null;
      resolution: "resolved" | "unbound" | "missing";
    }

Resolution:

1. Decode hub; invalid hub is blocking.
2. Decode marker; invalid/missing marker is a separate workbench diagnostic.
3. Read local:
   - missing -> local.missing, continue with null;
   - malformed -> blocking local.invalid;
   - valid -> resolve binding keys.
4. Resolve each path entrypoint:
   - binding absent -> unbound;
   - binding present and path absent -> missing;
   - binding present and path exists -> resolved.
5. Compute unused local bindings after all resource references are known.

Consumers use helpers such as primaryPathForResourceType(registry, "filehub"); they do not inspect raw entrypoint arrays.

## 7. Project Drift

Project inspection is deterministic:

- missing/invalid domain reference is already a hub contract error;
- if no resolved primary filehub exists, emit project.asset_unverifiable;
- if resolved, join filehubRoot + asset_rel_path, re-check containment, and warn when the directory or index.md is missing;
- archived projects may omit a live directory only if later policy explicitly allows it; in Child A both statuses retain a warning so data disappearance stays visible;
- gbrain page checks are excluded until Child E owns the write/recovery protocol.

## 8. Persistence

adapters/fs/workbench-state.ts owns:

- readHub, readLocal, readMarker;
- writeHubAtomic, writeLocalAtomic, writeMarkerAtomic;
- deterministic two-space JSON plus trailing newline;
- temporary sibling file + rename for each atomic file write.

Paired hub/local mutations:

1. Build desired typed hub/local in memory.
2. Encode and decode both to assert invariants.
3. Save original bytes.
4. Write temporary siblings.
5. Rename both; on a second-step failure, restore the first from original bytes.
6. Surface compensation failure explicitly.

Power loss can still leave an orphan binding or unbound reference. Doctor diagnostics make both states visible; no strong transaction is claimed.

For path resource creation, the default binding is <resource-id>-<entrypoint-id>. Explicit collision fails. Resource removal deletes a binding only when no remaining entrypoint references it.

## 9. Existing Command Adaptation

- domain list/add/remove use typed hub mutations.
- resource list renders portable identity plus effective resolved path where available.
- resource add --path writes a path binding to local state and a binding reference to hub.
- resource remove removes unreferenced local bindings.
- filehub init --register uses the same resource mutation helper.
- inbox status, doctor and cron pending scan call the shared filehub resolver.
- CLI grammar remains unchanged in Child A; help text is updated only where storage behavior is user-visible.

No project command is added in this child. Project records are exercised through schema/fixture/doctor tests until Child B introduces command handlers.

## 10. Init and Clone Behavior

Fresh init:

1. Materialize portable template with hub v4.
2. Generate marker with portable workbench_id.
3. Generate ignored local v1 with installation_id and empty bindings.
4. Create ignored log directory.
5. Doctor succeeds with expected warning when no filehub is configured.

Cloned workbench:

- hub and marker arrive through git;
- local is absent by design;
- doctor reports local missing and path resources unbound;
- a later binding command/bootstrap creates local state with a new installation ID;
- doctor never mutates the clone.

## 11. Compatibility and Rollout

- Runtime readers accept hub v4 only.
- v3 produces a stable unsupported-version error with guidance that workspace upgrade support arrives in Child B; there is no implicit conversion.
- All in-repo templates, fixtures, docs and generated assets switch in the same Child A commit.
- Existing personal workbenches follow the repository's pre-release policy: rebuild from the updated template until Child B implements upgrade.

Rollback is commit-level. Because this changes the baseline schema, partial rollback of only consumers or only templates is prohibited.

## 12. Test Strategy

1. Pure decoder table tests for every contract and invariant.
2. Effective registry tests for resolved/unbound/missing and two-machine bindings.
3. Repository tests for missing/invalid files, deterministic writes and injected rename failure compensation.
4. Doctor tests asserting diagnostic codes/severity for each drift class.
5. Consumer tests proving filehub/inbox/cron use effective resolution.
6. Command tests for domain/resource/filehub paired state mutations.
7. Init integration asserting marker/local/hub shape and ignored local state.
8. Generated asset freshness and full repository quality gates.

No test accesses actual user configuration, scheduler, gbrain or filehub.
