// adapters/harness/index.ts — adapter registry (capability key -> adapter).
// The production set is derived from capabilities.yaml: adding a pure declarative
// harness entry requires no harness-specific adapter file or index branch.
import { fail } from "../../core/shared/errors.ts";
import type { HarnessAdapter } from "./types.ts";
import { createAdapter } from "./generic.ts";
import { getCapability, harnessNames } from "./registry.ts";

const ADAPTERS: Record<string, HarnessAdapter> = Object.fromEntries(
  harnessNames().map((name) => [name, createAdapter(getCapability(name))]),
);

/** Look up an adapter by capability key; fails loudly on an unknown harness. */
export function getAdapter(name: string): HarnessAdapter {
  const a = ADAPTERS[name];
  if (!a) fail(`unsupported harness: ${name}`);
  return a;
}
