// core/registry/migrations.test.ts — hub.json schema migration mechanism.
// Version axis is the unified numeric `schema_version` (P2-2 dropped the
// legacy string `version: "4"` axis).
// Run: bun test core/registry/migrations.test.ts
import { expect, test } from "bun:test";
import { HUB_SCHEMA_VERSION, migrateHubSchema } from "./migrations.ts";

const hubV1 = { schema_version: 1, domains: [{ id: "dev", path: "workspace/dev" }], resources: [], projects: [] };

test("same version -> unchanged (identity; the 1->1 case)", () => {
  const out = migrateHubSchema(hubV1, HUB_SCHEMA_VERSION, HUB_SCHEMA_VERSION);
  expect(out.status).toBe("unchanged");
});

test("gap with no registered migration -> no-migration (upgrade must fail without touching the file)", () => {
  const out = migrateHubSchema(hubV1, "1", "2");
  expect(out.status).toBe("no-migration");
  expect(out.from).toBe("1");
  expect(out.to).toBe("2");
  expect(out.document).toBeUndefined();
});

test("registered single-step migration -> migrated, user data preserved", () => {
  const registered = {
    "1": (raw: Record<string, unknown>) => ({
      ...raw,
      schema_version: 2,
      // a future v2 adds a field; domains/resources/projects ride through untouched
      domains: (raw.domains as { id: string }[]).map((d) => ({ ...d, scope: "global" })),
    }),
  };
  const out = migrateHubSchema(hubV1, "1", "2", registered);
  expect(out.status).toBe("migrated");
  expect(out.document).toMatchObject({ schema_version: 2 });
  expect(out.document?.domains).toEqual([{ id: "dev", path: "workspace/dev", scope: "global" }]);
});

test("chained migration walks intermediate versions", () => {
  const registered = {
    "1": (raw: Record<string, unknown>) => ({ ...raw, schema_version: 2, a: 1 }),
    "2": (raw: Record<string, unknown>) => ({ ...raw, schema_version: 3, b: 2 }),
  };
  const out = migrateHubSchema(hubV1, "1", "3", registered);
  expect(out.status).toBe("migrated");
  expect(out.document).toMatchObject({ schema_version: 3, a: 1, b: 2, domains: hubV1.domains });
});

test("chained migration ending before target -> no-migration", () => {
  const registered = {
    "1": (raw: Record<string, unknown>) => ({ ...raw, schema_version: 2 }),
  };
  const out = migrateHubSchema(hubV1, "1", "3", registered);
  expect(out.status).toBe("no-migration");
});
