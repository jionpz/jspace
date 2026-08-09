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

/** application business submodules (registry-driven state + use cases). The
 *  aggregator layers (context/, diagnostics/) are deliberately excluded: they
 *  read across the tree but are never imported by the business submodules, so
 *  they cannot participate in a cycle. */
const BUSINESS_SUBMODULES = ["automation", "workspace", "pending", "ingest", "registry", "skills", "gbrain"] as const;

test("application business submodules form no import cycles (intra-layer ring guard)", () => {
  const graph = new Map<string, Set<string>>();
  for (const s of BUSINESS_SUBMODULES) graph.set(s, new Set());
  for (const file of sourceFiles(join(ROOT, "application"))) {
    const parts = relative(ROOT, file).split("/");
    if (parts.length < 3) continue; // application/x.ts shared files are not a submodule
    const imp = parts[1];
    if (!(BUSINESS_SUBMODULES as readonly string[]).includes(imp)) continue;
    for (const spec of importSpecifiers(file)) {
      if (!spec.startsWith(".")) continue;
      const tparts = relative(ROOT, resolve(dirname(file), spec)).split("/");
      if (tparts.length < 3 || tparts[0] !== "application") continue;
      const tgt = tparts[1];
      if (tgt !== imp && (BUSINESS_SUBMODULES as readonly string[]).includes(tgt)) graph.get(imp)!.add(tgt);
    }
  }
  // Tarjan SCC: any strongly connected component with >1 vertex is a cycle.
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  let counter = 0;
  const cycles: string[] = [];
  const strongconnect = (v: string): void => {
    idx.set(v, counter);
    low.set(v, counter);
    counter++;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v)!) {
      if (!idx.has(w)) {
        strongconnect(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, idx.get(w)!));
      }
    }
    if (low.get(v) === idx.get(v)) {
      const comp: string[] = [];
      while (true) {
        const w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
        if (w === v) break;
      }
      if (comp.length > 1) cycles.push(comp.join(" <-> "));
    }
  };
  for (const s of BUSINESS_SUBMODULES) if (!idx.has(s)) strongconnect(s);
  expect(cycles).toEqual([]);
});
