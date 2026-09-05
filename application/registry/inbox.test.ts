// application/registry/inbox.test.ts — countInbox / inboxStatus exclusion
// contract (issue #38): resident drop-zone files (README.md / AGENTS.md) and
// `.skip-inbox-tidy`-exempted directories are structure, never unfiled payload.
// countInbox is unit-tested on a plain dir; inboxStatus goes through the real
// filehub registration fixture (hub.json + local.json binding) so the degraded
// staging and registered `_inbox/` paths stay covered by the same filter.
// Run: bun test application/registry/inbox.test.ts
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { countInbox, inboxStatus } from "./inbox.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "jspace-inbox-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeInbox(): void {
  dir = join(dir, "_inbox");
  mkdirSync(dir, { recursive: true });
}

test("countInbox skips dotfiles, README.md and AGENTS.md (resident, never payload)", () => {
  makeInbox();
  writeFileSync(join(dir, "README.md"), "drop-zone contract");
  writeFileSync(join(dir, "AGENTS.md"), "routing note");
  writeFileSync(join(dir, ".hidden"), "x");
  writeFileSync(join(dir, "real.pdf"), "x");
  expect(countInbox(dir)).toBe(1);
});

test("countInbox excludes a directory marked .skip-inbox-tidy, contents included", () => {
  makeInbox();
  mkdirSync(join(dir, "deep-learn"));
  writeFileSync(join(dir, "deep-learn", ".skip-inbox-tidy"), "");
  writeFileSync(join(dir, "deep-learn", "note.md"), "x");
  writeFileSync(join(dir, "deep-learn", "_catalog.json"), "x");
  expect(countInbox(dir)).toBe(0);
});

test("countInbox still counts an unmarked directory as ONE item (top-level semantics)", () => {
  makeInbox();
  mkdirSync(join(dir, "pending-batch"));
  writeFileSync(join(dir, "pending-batch", "a.pdf"), "x");
  writeFileSync(join(dir, "pending-batch", "b.pdf"), "x");
  writeFileSync(join(dir, "top.pdf"), "x");
  expect(countInbox(dir)).toBe(2);
});

test(".skip-inbox-tidy nested deeper than a direct child does NOT exempt", () => {
  makeInbox();
  mkdirSync(join(dir, "keep", "sub"), { recursive: true });
  writeFileSync(join(dir, "keep", "sub", ".skip-inbox-tidy"), "");
  expect(countInbox(dir)).toBe(1); // keep/ is still payload
});

test("inboxStatus listing and JSON count apply the same exclusions", () => {
  // registered-filehub fixture (same shape doctor tests use)
  const wb = dir;
  mkdirSync(join(wb, ".jspace"), { recursive: true });
  writeFileSync(
    join(wb, ".jspace", "hub.json"),
    JSON.stringify({
      schema_version: 1,
      domains: [{ id: "files", path: "workspace/files" }],
      resources: [{ id: "filehub", type: "filehub", domain: "files", entrypoints: [{ id: "path", kind: "path", binding: "filehub-path", primary: true }] }],
      projects: [],
    }),
  );
  const fh = join(wb, "filehub");
  mkdirSync(join(fh, "_inbox", "exempted"), { recursive: true });
  writeFileSync(join(fh, "_inbox", "README.md"), "contract");
  writeFileSync(join(fh, "_inbox", "exempted", ".skip-inbox-tidy"), "");
  writeFileSync(join(fh, "_inbox", "exempted", "keepme.md"), "x");
  writeFileSync(join(fh, "_inbox", "todo.pdf"), "x");
  writeFileSync(join(wb, ".jspace", "local.json"), JSON.stringify({ schema_version: 1, installation_id: "i", bindings: { "filehub-path": fh } }));

  const text = inboxStatus(wb, false);
  const lines = text.lines ?? [];
  expect(lines.some((l) => l.includes("1 file(s)"))).toBe(true);
  expect(lines.some((l) => l.includes("todo.pdf"))).toBe(true);
  expect(lines.some((l) => l.includes("README.md") || l.includes("exempted"))).toBe(false);

  const json = inboxStatus(wb, true);
  const data = json.data as { count: number; files: { name: string }[] };
  expect(data.count).toBe(1);
  expect(data.files.map((f) => f.name)).toEqual(["todo.pdf"]);
});
