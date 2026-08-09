// core/registry/migrations.ts — hub.json schema migrations.
//
// hub.json is user data: `workspace upgrade` never file-replaces it. When the
// bundle moves the hub schema forward, upgrade runs a registered migration
// (read -> transform -> write) that preserves user domains/resources/projects.
// If no migration is registered for a version gap, upgrade fails WITHOUT
// touching the file — the user must migrate manually.

/** Current portable hub schema version (matches core/contracts/hub.ts). The
 *  version axis is the unified numeric `schema_version` (P2-2 dropped the
 *  legacy string `version` axis). */
export const HUB_SCHEMA_VERSION = "1";

export type HubTransform = (raw: Record<string, unknown>) => Record<string, unknown>;

/** from-version -> transform producing the next schema version. Empty today
 *  (no v2 yet); a future v2 registers `"1": (raw) => ({ ...raw, schema_version: 2 })`
 *  and chained steps as needed. Upgrade injects this via UpgradeDeps for tests. */
const MIGRATIONS: Record<string, HubTransform> = {};

export type MigrationStatus = "unchanged" | "migrated" | "no-migration";

export interface MigrationOutcome {
  status: MigrationStatus;
  from: string;
  to: string;
  /** migrated hub document; present only when status === "migrated" */
  document?: Record<string, unknown>;
}

/** Version of a hub document for migration comparisons: the unified numeric
 *  `schema_version` only (P2-2 dropped the legacy string `version` axis). */
function docVersion(doc: Record<string, unknown>): string {
  return String(doc.schema_version);
}

/** Migrate an installed hub document from its schema version to `toVersion`.
 *  - from === to -> "unchanged" (identity; the common 1->1 case).
 *  - a registered step chain leads to `toVersion` -> "migrated" + document.
 *  - the gap has no registered migration -> "no-migration" (caller must not
 *    rewrite the file).
 *  `registered` is injectable so tests can exercise the migrated path without
 *  mutating the module-level table. */
export function migrateHubSchema(
  raw: Record<string, unknown>,
  fromVersion: string,
  toVersion: string,
  registered: Record<string, HubTransform> = MIGRATIONS,
): MigrationOutcome {
  if (fromVersion === toVersion) {
    return { status: "unchanged", from: fromVersion, to: toVersion };
  }
  if (registered[fromVersion] === undefined) {
    return { status: "no-migration", from: fromVersion, to: toVersion };
  }
  let doc = registered[fromVersion](raw);
  let guard = 0;
  while (docVersion(doc) !== toVersion) {
    const next = docVersion(doc);
    const step = registered[next];
    if (step === undefined || guard++ > 8) {
      return { status: "no-migration", from: fromVersion, to: toVersion };
    }
    doc = step(doc);
  }
  return { status: "migrated", from: fromVersion, to: toVersion, document: doc };
}
