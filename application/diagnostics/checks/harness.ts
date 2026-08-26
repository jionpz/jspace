// application/diagnostics/checks/harness.ts — active harness binary + capability health.
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";
import { loadCapabilities } from "../../../adapters/harness/registry.ts";
import { binaryOnPath } from "../../../adapters/harness/bin.ts";
import type { HarnessCheckDeps } from "../deps.ts";

/** Harness support health for the ACTIVE harnesses (the cron.json harness values
 *  of this workbench). Active-only by design: a full matrix scan of every
 *  capability (grok/opencode/pi/cursor) would warn "not installed" for harnesses
 *  the user never selected — noise, not signal. */
export function checkHarness(root: string, cron: HarnessCheckDeps): RegistryDiagnostic[] {
  const diags: RegistryDiagnostic[] = [];
  let crons;
  try {
    crons = cron.loadCrons(root).crons;
  } catch {
    return diags;
  }
  const caps = loadCapabilities();
  const binOnPath = cron.harnessBinOnPath ?? ((name: string) => binaryOnPath(name, cron.platform ?? process.platform));
  const active = new Set<string>();
  for (const c of crons) if (c.harness && c.enabled) active.add(c.harness);
  for (const name of active) {
    const cap = caps.harnesses[name];
    if (!cap) {
      diags.push({ severity: "warning", code: "harness.unknown", path: `harness.${name}`, message: `cron harness ${name} is not in capabilities.yaml; run jspace update and check cron.json` });
      continue;
    }
    if (cap.headless !== null && !binOnPath(name)) {
      diags.push({ severity: "warning", code: "harness.bin_missing", path: `harness.${name}`, message: `cron harness ${name} binary not found on PATH; scheduled runs will fail (install the harness CLI)` });
    }
    if (name === "pi" && binOnPath(name)) {
      diags.push({
        severity: "info",
        code: "harness.pi_mcp_adapter",
        path: "harness.pi",
        message: "Pi has no native MCP; gbrain works via the CLI. Optionally install pi-mcp-adapter for MCP access (MANUAL install, npm executes package code — verify source first; see harness-pi.md)",
      });
    }
  }
  return diags;
}
