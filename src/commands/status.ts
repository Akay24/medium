import { existsSync, readFileSync } from "node:fs";
import { loadManifest, refreshStaleness } from "../run/manifest.js";
import { runDirFor } from "./run.js";
import { loadConsistencyVerification } from "../verifiers/consistency.js";
import { loadCodeVerification } from "../verifiers/code.js";
import { loadDiagramVerification } from "../verifiers/diagrams.js";
import { loadSourcesVerification } from "../verifiers/sources.js";
import { STAGE_ORDER } from "../config/schema.js";

export interface StatusReport {
  slug: string;
  stages: { name: string; status: string; version: number; approvals: string; error: string | null }[];
  verification: {
    sources: { exists: boolean; summary: string } | null;
    code: { exists: boolean; summary: string } | null;
    diagrams: { exists: boolean; summary: string } | null;
    consistency: { exists: boolean; summary: string } | null;
  };
  blockers: string[];
  export: { status: string; lastExportedAt: string | null };
}

/** Accurate report of stage states, versions, approvals, verifier state, blockers. */
export function statusReport(slug: string): StatusReport {
  const runDir = runDirFor(slug);
  if (!existsSync(`${runDir}/manifest.json`)) {
    throw new Error(`Run "${slug}" not found under ${runDir}.`);
  }
  const manifest = refreshStaleness(runDir, loadManifest(runDir));
  const blockers: string[] = [];

  for (const name of STAGE_ORDER) {
    const entry = manifest.stages.find((s) => s.name === name);
    if (!entry) continue;
    if (entry.status === "failed") blockers.push(`stage ${name} failed: ${entry.error ?? "unknown error"}`);
    if (entry.status === "stale") blockers.push(`stage ${name} is stale (upstream inputs changed; re-run)`);
    if (entry.status === "passed" && entry.approvals.state === "awaiting") {
      blockers.push(`stage ${name} awaits human approval`);
    }
  }

  const sources = loadSourcesVerification(runDir);
  const code = loadCodeVerification(runDir);
  const diagrams = loadDiagramVerification(runDir);
  const consistency = loadConsistencyVerification(runDir);

  if (sources) {
    const errors = sources.issues.filter((i) => i.severity === "error");
    if (errors.length) blockers.push(`source verification errors: ${errors.length}`);
  }
  if (code) {
    const bad = code.checks.filter((c) => c.status === "failed" || c.status === "error" || c.status === "flaky");
    for (const c of bad) blockers.push(`code check ${c.codeId}: ${c.status}`);
  }
  if (diagrams) {
    for (const d of diagrams.diagrams.filter((x) => x.status === "failed")) {
      blockers.push(`diagram ${d.id}: ${d.error ?? "failed"}`);
    }
  }
  if (consistency && !consistency.passed) {
    blockers.push(`consistency: ${consistency.issues.filter((i) => i.severity === "error").length} error(s)`);
  }
  if (!sources) blockers.push("source verification has not run");
  if (!consistency) blockers.push("consistency verification has not run");

  return {
    slug,
    stages: manifest.stages.map((s) => ({
      name: s.name,
      status: s.status,
      version: s.version,
      approvals: s.approvals.state,
      error: s.error
    })),
    verification: {
      sources: sources
        ? { exists: true, summary: `${sources.sources.filter((s) => s.fetchedAt).length}/${sources.sources.length} fetched, ${sources.modelAssessedSupport.length} model-assessed support records` }
        : null,
      code: code
        ? { exists: true, summary: `${code.checks.filter((c) => c.status === "passed").length}/${code.checks.length} passed (sandbox: ${code.sandbox}${code.sandboxAvailable ? "" : ", unavailable"})` }
        : null,
      diagrams: diagrams
        ? { exists: true, summary: `${diagrams.diagrams.filter((d) => d.status === "rendered").length}/${diagrams.diagrams.length} rendered` }
        : null,
      consistency: consistency
        ? { exists: true, summary: consistency.passed ? "passed" : `${consistency.issues.filter((i) => i.severity === "error").length} error(s)` }
        : null
    },
    blockers,
    export: { status: manifest.export.status, lastExportedAt: manifest.export.lastExportedAt }
  };
}

export function formatStatus(report: StatusReport): string {
  const lines = [
    `Run: ${report.slug}`,
    "",
    "Stages:",
    ...report.stages.map(
      (s) => `  ${s.name.padEnd(9)} ${s.status.padEnd(14)} v${s.version} approvals=${s.approvals}${s.error ? ` error=${s.error}` : ""}`
    ),
    "",
    "Verification:",
    `  sources:     ${report.verification.sources?.summary ?? "not run"}`,
    `  code:        ${report.verification.code?.summary ?? "not run"}`,
    `  diagrams:    ${report.verification.diagrams?.summary ?? "not run"}`,
    `  consistency: ${report.verification.consistency?.summary ?? "not run"}`,
    "",
    `Export: ${report.export.status}${report.export.lastExportedAt ? ` at ${report.export.lastExportedAt}` : ""}`,
    "",
    report.blockers.length ? "Blockers:" : "No blockers.",
    ...report.blockers.map((b) => `  - ${b}`)
  ];
  return lines.join("\n");
}


