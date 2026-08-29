// application/diagnostics/checks/usage-mileage.ts — M7 evidence ledger kickoff hint.
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RegistryDiagnostic } from "../../../core/contracts/diagnostics.ts";

const LEDGER = ".jspace/usage-mileage-ledger.md";
const TEMPLATE = ".jspace/skills/jspace-use/references/usage-mileage-ledger-template.md";

/** M7 kickoff hint: the bundled ledger template is present but the user has
 *  not yet copied it to the gitignored instance path. info-only — skipping M7
 *  tracking is legitimate until real usage begins. */
export function checkUsageMileageLedger(root: string): RegistryDiagnostic[] {
  const ledgerPath = join(root, LEDGER);
  if (existsSync(ledgerPath)) return [];
  const templatePath = join(root, TEMPLATE);
  if (!existsSync(templatePath)) return [];
  return [
    {
      severity: "info",
      code: "usage.mileage_ledger_missing",
      path: "usage.mileage",
      message: `M7 evidence ledger not initialized — copy the bundled template to ${LEDGER} (gitignored) and fill real paths/dates; protocol: ~/.agents/skills/jspace-use/references/usage-mileage.md`,
    },
  ];
}
