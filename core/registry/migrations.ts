// core/registry/migrations.ts — hub.json schema migrations.
//
// hub.json is user data: `workspace upgrade` never file-replaces it. When the
// bundle moves the hub schema forward, upgrade runs a registered migration
// (read -> transform -> write) that preserves user domains/resources/projects.
// If no migration is registered for a version gap, upgrade fails WITHOUT
// touching the file — the user must migrate manually.

/** Current portable hub schema version (matches core/contracts/hub.ts). */
export const HUB_SCHEMA_VERSION = "4";

export type HubTransform = (raw: Record<string, unknown>) => Record<string, unknown>;

/** from-version -> transform producing the next schema version. Empty today
 *  (no v5 yet); a future v5 registers `"4": (raw) => ({ ...raw, version: "5" })`
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

/** Migrate an installed hub document from its schema version to `toVersion`.
 *  - from === to -> "unchanged" (identity; the common v4->v4 case).
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
  while (String(doc.version) !== toVersion) {
    const next = String(doc.version);
    const step = registered[next];
    if (step === undefined || guard++ > 8) {
      return { status: "no-migration", from: fromVersion, to: toVersion };
    }
    doc = step(doc);
  }
  return { status: "migrated", from: fromVersion, to: toVersion, document: doc };
}
