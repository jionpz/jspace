// core/registry/migrations.test.ts — hub.json schema migration mechanism.
// Run: bun test core/registry/migrations.test.ts
import { expect, test } from "bun:test";
import { HUB_SCHEMA_VERSION, migrateHubSchema } from "./migrations.ts";

const hubV4 = { version: "4", domains: [{ id: "dev", path: "workspace/dev" }], resources: [], projects: [] };

test("same version -> unchanged (identity; the v4->v4 case)", () => {
  const out = migrateHubSchema(hubV4, HUB_SCHEMA_VERSION, HUB_SCHEMA_VERSION);
  expect(out.status).toBe("unchanged");
});

test("gap with no registered migration -> no-migration (upgrade must fail without touching the file)", () => {
  const out = migrateHubSchema(hubV4, "4", "5");
  expect(out.status).toBe("no-migration");
  expect(out.from).toBe("4");
  expect(out.to).toBe("5");
  expect(out.document).toBeUndefined();
});

test("registered single-step migration -> migrated, user data preserved", () => {
  const registered = {
    "4": (raw: Record<string, unknown>) => ({
      ...raw,
      version: "5",
      // a future v5 adds a field; domains/resources/projects ride through untouched
      domains: (raw.domains as { id: string }[]).map((d) => ({ ...d, scope: "global" })),
    }),
  };
  const out = migrateHubSchema(hubV4, "4", "5", registered);
  expect(out.status).toBe("migrated");
  expect(out.document).toMatchObject({ version: "5" });
  expect(out.document?.domains).toEqual([{ id: "dev", path: "workspace/dev", scope: "global" }]);
});

test("chained migration walks intermediate versions", () => {
  const registered = {
    "4": (raw: Record<string, unknown>) => ({ ...raw, version: "5", a: 1 }),
    "5": (raw: Record<string, unknown>) => ({ ...raw, version: "6", b: 2 }),
  };
  const out = migrateHubSchema(hubV4, "4", "6", registered);
  expect(out.status).toBe("migrated");
  expect(out.document).toMatchObject({ version: "6", a: 1, b: 2, domains: hubV4.domains });
});

test("chained migration ending before target -> no-migration", () => {
  const registered = {
    "4": (raw: Record<string, unknown>) => ({ ...raw, version: "5" }),
  };
  const out = migrateHubSchema(hubV4, "4", "7", registered);
  expect(out.status).toBe("no-migration");
});
