import { z } from "zod";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { sha256, nowIso } from "../util/hash.js";
import { parseDraft, PLACEHOLDER_RE, firstPersonTestingStatements } from "../stages/draftParse.js";
import type { ResearchOutput, MetadataOutput, VisualsOutput } from "../stages/schemas.js";
import type { CodeVerification } from "./code.js";
import type { DiagramVerification } from "./diagrams.js";
import type { PipelineConfig } from "../config/schema.js";

export const consistencyIssueSchema = z.object({
  check: z.string(),
  severity: z.enum(["error", "warning"]),
  message: z.string()
});

export const consistencyVerificationSchema = z.object({
  generatedAt: z.string().datetime(),
  passed: z.boolean(),
  issues: z.array(consistencyIssueSchema)
});

export type ConsistencyVerification = z.infer<typeof consistencyVerificationSchema>;

export interface ConsistencyVerifierInput {
  runDir: string;
  articleMarkdown: string;
  research: ResearchOutput;
  visuals: VisualsOutput | null;
  metadata: MetadataOutput | null;
  codeVerification: CodeVerification | null;
  /** Author-supplied first-person assertions the draft is allowed to make. */
  authorAssertions: string[];
  phraseWarnings: { enabled: boolean; phrases: string[] };
}

/**
 * Fully deterministic consistency checks. No LLM involved.
 * Flags: placeholders, dangling claim/source ids, first-person testing claims,
 * code drift, missing diagrams, duplicate headings, empty metadata,
 * version-sensitive claims without qualifiers, phrase warnings.
 */
export function verifyConsistency(input: ConsistencyVerifierInput): ConsistencyVerification {
  const issues: ConsistencyVerification["issues"] = [];
  const add = (check: string, severity: "error" | "warning", message: string) =>
    issues.push({ check, severity, message });

  const knownClaimIds = new Set(input.research.claims.map((c) => c.id));
  const parsed = parseDraft(input.articleMarkdown, knownClaimIds);

  // Placeholders / unresolved markers
  const placeholders = [...input.articleMarkdown.matchAll(PLACEHOLDER_RE)].map((m) => m[0]);
  if (placeholders.length) {
    add("placeholders", "error", `${placeholders.length} unresolved placeholder(s): ${[...new Set(placeholders)].join(", ")}`);
  }

  // Claim markers referencing nonexistent claim IDs
  for (const unknown of parsed.issues.unknownClaimIds) {
    add("claim-ids", "error", `Claim marker references nonexistent claim id ${unknown}`);
  }
  const markerIds = new Set(parsed.claimMarkers.map((c) => c.claimId));
  for (const claim of input.research.claims) {
    if (claim.kind === "doc-fact" && !markerIds.has(claim.id)) {
      add("claim-coverage", "warning", `doc-fact claim ${claim.id} is never marked in the draft`);
    }
  }

  // Cited source IDs absent from research
  const sourceIds = new Set(input.research.sources.map((s) => s.id));
  for (const claim of input.research.claims) {
    for (const sid of claim.sourceIds) {
      if (!sourceIds.has(sid)) add("source-ids", "error", `Claim ${claim.id} cites source ${sid} absent from research`);
    }
  }

  // First-person testing claims without author assertions
  for (const hit of firstPersonTestingStatements(input.articleMarkdown)) {
    const allowed = input.authorAssertions.some((a) => a.trim() && hit.toLowerCase().includes(a.toLowerCase().slice(0, 40)));
    if (!allowed) {
      add("personal-experience", "error", `First-person testing claim without author assertion/evidence: "${hit}"`);
    }
  }

  // Version-sensitive claims without version qualifier
  for (const claimId of input.research.versionSensitiveClaims) {
    const claim = input.research.claims.find((c) => c.id === claimId);
    if (!claim) continue;
    const hasVersion = /\b\d+\.\d+(\.\d+)?\b/.test(claim.text) || /latest|current|as of/i.test(claim.text);
    if (!hasVersion) {
      add("version-qualifier", "warning", `Version-sensitive claim ${claim.id} lacks a version qualifier: "${claim.text.slice(0, 80)}"`);
    }
  }

  // Code drift: article bytes vs tested bytes
  if (input.codeVerification) {
    const byId = new Map(input.codeVerification.checks.map((c) => [c.codeId, c]));
    for (const block of parsed.codeBlocks) {
      const check = byId.get(block.id);
      if (check && check.sourceSha256 !== block.sha256) {
        add("code-drift", "error", `Code block ${block.id} differs from the tested bytes (hash mismatch)`);
      }
    }
  }

  // Missing diagrams referenced by the draft
  for (const ref of parsed.diagramRefs) {
    const record = input.visuals?.diagrams.find((d) => d.id === ref);
    if (!record) {
      add("diagrams", "error", `Draft references diagram ${ref} with no visuals record`);
    } else if (!record.mmdPath || !existsSync(`${input.runDir}/${record.mmdPath}`)) {
      add("diagrams", "error", `Diagram ${ref} source file missing`);
    }
  }
  for (const d of input.visuals?.diagrams ?? []) {
    if (d.mmdPath && !existsSync(`${input.runDir}/${d.mmdPath}`)) {
      add("diagrams", "error", `Diagram ${d.id} source file missing on disk`);
    }
  }

  // Duplicate headings
  const headings = [...input.articleMarkdown.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => (m[1] ?? "").trim().toLowerCase());
  const seen = new Set<string>();
  for (const h of headings) {
    if (seen.has(h)) add("headings", "error", `Duplicate heading: "${h}"`);
    seen.add(h);
  }

  // Empty required metadata
  if (input.metadata) {
    if (!input.metadata.headline.trim()) add("metadata", "error", "headline is empty");
    if (input.metadata.tags.length === 0) add("metadata", "error", "tags are empty");
    if (!input.metadata.subtitle.trim()) add("metadata", "error", "subtitle is empty");
    for (const [name, limit] of Object.entries(input.metadata.platformLimits)) {
      if (limit.unverified) {
        add("metadata", "warning", `Platform limit ${name} is unverified (${limit.lastVerifiedAt ?? "never"}, ${limit.sourceUrl ?? "no source"})`);
      }
    }
  }

  // Broken local artifact references (links to local files that must exist)
  for (const m of input.articleMarkdown.matchAll(/\]\((?!https?:|mailto:|#)([^)]+)\)/g)) {
    const ref = (m[1] ?? "").split("#")[0] as string;
    if (ref && !existsSync(`${input.runDir}/draft/current/${ref}`) && !existsSync(`${input.runDir}/${ref}`)) {
      add("local-refs", "error", `Broken local artifact reference: ${ref}`);
    }
  }

  // Configurable phrase linter — warnings, never proof of AI authorship
  if (input.phraseWarnings.enabled) {
    for (const phrase of input.phraseWarnings.phrases) {
      if (input.articleMarkdown.toLowerCase().includes(phrase.toLowerCase())) {
        add("phrase-lint", "warning", `Phrase warning: "${phrase}" (generic AI prose indicator, not proof)`);
      }
    }
  }

  const result: ConsistencyVerification = {
    generatedAt: nowIso(),
    passed: !issues.some((i) => i.severity === "error"),
    issues
  };
  persist(input.runDir, result);
  return result;
}

function persist(runDir: string, result: ConsistencyVerification): void {
  const dir = `${runDir}/verification`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/consistency.json`, JSON.stringify(result, null, 2) + "\n");
}

export function loadConsistencyVerification(runDir: string): ConsistencyVerification | null {
  const path = `${runDir}/verification/consistency.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ConsistencyVerification) : null;
}
