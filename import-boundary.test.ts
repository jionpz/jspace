// import-boundary.test.ts — automated layer-direction gate (PRD R3).
// Production code must respect the dependency order; a forbidden edge fails
// this test so a layer ring can never reappear silently. Enforced inside the
// normal `bun test` run (the repo's primary verify gate).
// Run: bun test import-boundary.test.ts
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = join(import.meta.dir);
const LAYERS = ["core", "adapters", "application", "cli"] as const;
type Layer = (typeof LAYERS)[number];

/** All production .ts files under a layer (tests + generated excluded). */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...sourceFiles(p));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".generated.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** Static import specifiers: `from "..."` (covers re-exports too). */
function importSpecifiers(file: string): string[] {
  const src = readFileSync(file, "utf-8");
  const out: string[] = [];
  const re = /\bfrom\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}

function layerOf(p: string): Layer | null {
  const rel = relative(ROOT, p);
  for (const l of LAYERS) {
    if (rel === l || rel.startsWith(`${l}/`)) return l;
  }
  return null;
}

/** Forbidden edges: importer layer must not import the target layer. */
const FORBIDDEN: Array<[Layer, Layer]> = [
  ["adapters", "application"],
  ["application", "cli"],
  ["core", "application"],
  ["core", "adapters"],
  ["core", "cli"],
];

test("production imports respect the layer direction (no forbidden edges)", () => {
  const violations: string[] = [];
  for (const layer of LAYERS) {
    for (const file of sourceFiles(join(ROOT, layer))) {
      const imp = layerOf(file)!;
      for (const spec of importSpecifiers(file)) {
        if (!spec.startsWith(".")) continue; // node:/package/bare imports never cross layers
        const target = layerOf(resolve(dirname(file), spec));
        if (target === null) continue; // scripts/, templates/, etc. are not gated
        for (const [from, to] of FORBIDDEN) {
          if (imp === from && target === to) violations.push(`${relative(ROOT, file)} -> ${relative(ROOT, resolve(dirname(file), spec))}`);
        }
      }
    }
  }
  expect(violations).toEqual([]);
});
