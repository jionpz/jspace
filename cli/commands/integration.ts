// cli/commands/integration.ts — optional, workbench-scoped tool integrations.
import type { CommandSpec } from "../../application/commands/command.ts";
import { fail } from "../../core/shared/errors.ts";
import { ASSETS } from "../assets.generated.ts";
import {
  enableJstack, disableJstack, jstackIntegrationStatus, JSTACK_BRIDGE_ASSET,
} from "../../application/integrations/jstack.ts";
import { attachJstack } from "../../application/integrations/attach.ts";
import { b, s } from "./helpers.ts";

export function bundledJstackBridge(): string {
  const source = ASSETS[JSTACK_BRIDGE_ASSET];
  if (typeof source !== "string" || source.length === 0) {
    fail("JStack bridge asset is missing from this JSpace bundle; run gen-assets and rebuild");
  }
  return source;
}
const integrationName = {
  name: "name", required: true, help: "integration name (currently: jstack)",
  validate: (name: string) => name === "jstack" ? null : `unsupported integration: ${name} (supported: jstack)`,
} as const;
const enableSpec: CommandSpec = {
  name: "enable",
  summary: "enable an optional integration in the workbench",
  features: { dir: true, dryRun: true },
  positionals: [integrationName],
  handler: (ctx, args) => enableJstack(ctx.root, bundledJstackBridge(), b(args.dryRun)),
};
const disableSpec: CommandSpec = {
  name: "disable",
  summary: "disable the workbench integration without touching project installations",
  features: { dir: true, dryRun: true },
  positionals: [integrationName],
  handler: (ctx, args) => disableJstack(ctx.root, b(args.dryRun), bundledJstackBridge()),
};
const statusSpec: CommandSpec = {
  name: "status",
  summary: "inspect the workbench's optional integration",
  features: { dir: true, json: true },
  positionals: [integrationName],
  handler: (ctx, args) => jstackIntegrationStatus(ctx.root, bundledJstackBridge(), b(args.json)),
};
const attachSpec: CommandSpec = {
  name: "attach",
  summary: "delegate project-scoped install to a trusted JStack checkout",
  features: { dir: true, dryRun: true },
  positionals: [integrationName],
  options: [
    { name: "--repo", takesValue: true, required: true, help: "registered Git resource's repository root" },
    { name: "--source", takesValue: true, required: true, help: "absolute path to an existing trusted JStack checkout (no automatic downloads)" },
  ],
  handler: (ctx, args) => attachJstack(ctx.root, s(args.repo), s(args.source), b(args.dryRun)),
};
export const integrationSpec: CommandSpec = {
  name: "integration",
  summary: "manage optional workbench integrations (JStack)",
  commandArgName: "integration_command",
  children: [enableSpec, disableSpec, statusSpec, attachSpec],
};
