import { runDeterministicVerifiers, requireRun } from "./run.js";
import { refreshStaleness, saveManifest } from "../run/manifest.js";

const ONLY_VALUES = ["sources", "code", "diagrams", "consistency"] as const;

export async function verifyCommand(slug: string, only?: string): Promise<void> {
  const { runDir, manifest } = requireRun(slug);
  if (only && !ONLY_VALUES.includes(only as (typeof ONLY_VALUES)[number])) {
    throw new Error(`Invalid --only value "${only}". Valid: ${ONLY_VALUES.join(", ")}`);
  }
  saveManifest(runDir, refreshStaleness(runDir, manifest));
  await runDeterministicVerifiers(slug, only as (typeof ONLY_VALUES)[number] | undefined);
  process.stdout.write(`Verification complete for ${slug}${only ? ` (only: ${only})` : ""}.\n`);
}
