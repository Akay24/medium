import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from "node:fs";
import { loadManifest, refreshStaleness, saveManifest, stageEntry } from "../run/manifest.js";
import { runDirFor } from "./run.js";
import { loadCodeVerification } from "../verifiers/code.js";
import { loadDiagramVerification } from "../verifiers/diagrams.js";
import { loadConsistencyVerification } from "../verifiers/consistency.js";
import { loadSourcesVerification, sourcesCheckPassed } from "../verifiers/sources.js";
import { currentDraft } from "../stages/draft.js";
import { currentResearch } from "../stages/research.js";
import { currentVisuals } from "../stages/visuals.js";
import { currentMetadata } from "../stages/metadata.js";
import { currentQa } from "../stages/qa.js";
import { parseDraft, stripClaimMarkers, PLACEHOLDER_RE } from "../stages/draftParse.js";
import { nowIso } from "../util/hash.js";
import type { ConsistencyVerification } from "../verifiers/consistency.js";

export interface ExportResult {
  packageDir: string;
  forced: boolean;
  blocked: boolean;
  blockers: string[];
}

/** Mandatory checks that block a normal export. */
export function exportBlockers(runDir: string, consistency: ConsistencyVerification | null): string[] {
  const blockers: string[] = [];
  const code = loadCodeVerification(runDir);
  const diagrams = loadDiagramVerification(runDir);
  const sources = loadSourcesVerification(runDir);

  if (consistency && !consistency.passed) {
    for (const issue of consistency.issues.filter((i) => i.severity === "error")) {
      blockers.push(`consistency/${issue.check}: ${issue.message}`);
    }
  }
  if (code) {
    for (const check of code.checks) {
      if (check.status === "failed" || check.status === "flaky") {
        blockers.push(`code/${check.codeId}: execution ${check.status}`);
      }
      if (check.status === "error") {
        blockers.push(`code/${check.codeId}: ${check.error ?? "error"}`);
      }
    }
  }
  if (diagrams) {
    for (const d of diagrams.diagrams.filter((x) => x.status === "failed")) {
      blockers.push(`diagrams/${d.id}: ${d.error ?? "failed"}`);
    }
  }
  if (sources && !sourcesCheckPassed(sources)) {
    blockers.push("sources: claim/source mapping incomplete");
  }
  return blockers;
}

/** pipeline export <slug> [--force]: build the review package; normal export blocked by failed mandatory checks. */
export async function exportRun(slug: string, force: boolean): Promise<ExportResult> {
  const runDir = runDirFor(slug);
  if (!existsSync(`${runDir}/manifest.json`)) {
    throw new Error(`Run "${slug}" not found. Run "pipeline init ${slug}" first.`);
  }
  const manifest = refreshStaleness(runDir, loadManifest(runDir));
  if (stageEntry(manifest, "draft").version < 1) {
    throw new Error("Nothing to export: the draft stage has not produced an article yet.");
  }
  const consistency = loadConsistencyVerification(runDir);
  const blockers = exportBlockers(runDir, consistency);
  if (blockers.length > 0 && !force) {
    throw new Error(
      `Export blocked by ${blockers.length} failed mandatory check(s):\n  - ${blockers.join("\n  - ")}\nFix them, or pass --force to export a clearly-marked unverified review package.`
    );
  }

  const packageDir = `${runDir}/package`;
  rmSync(packageDir, { recursive: true, force: true });
  mkdirSync(packageDir, { recursive: true });

  const { markdown, draft } = currentDraft(runDir, manifest);
  const research = currentResearch(runDir, manifest);
  const visuals = currentVisuals(runDir, manifest);
  const metadata = currentMetadata(runDir, manifest);
  const qa = currentQa(runDir, manifest);

  // Source copy of the draft with claim provenance.
  mkdirSync(`${packageDir}/source`, { recursive: true });
  writeFileSync(`${packageDir}/source/article-with-markers.md`, markdown);

  // Clean readable article; unresolved claims/placeholders called out in REMAINING_ACTIONS.md.
  const parsed = parseDraft(markdown, new Set(research.claims.map((c) => c.id)));
  const remainingActions: string[] = [];
  for (const unknown of parsed.issues.unknownClaimIds) {
    remainingActions.push(`Claim marker references nonexistent claim id ${unknown}`);
  }
  const placeholders = [...markdown.matchAll(PLACEHOLDER_RE)].map((m) => m[0]);
  for (const p of [...new Set(placeholders)]) {
    remainingActions.push(`Unresolved placeholder remains: ${p}`);
  }
  writeFileSync(`${packageDir}/article.md`, stripClaimMarkers(markdown));

  // Best-effort local HTML conversion for review/pasting (not guaranteed Medium formatting).
  writeFileSync(`${packageDir}/article.html`, markdownToHtml(stripClaimMarkers(markdown)));

  // Rendered diagrams only if files actually exist.
  mkdirSync(`${packageDir}/diagrams`, { recursive: true });
  const diagrams = loadDiagramVerification(runDir);
  if (diagrams) {
    for (const d of diagrams.diagrams) {
      for (const rendered of d.renderedPaths) {
        if (existsSync(rendered.path)) {
          cpSync(rendered.path, `${packageDir}/diagrams/${d.id}-${rendered.path.split("/").pop()}`);
        }
      }
    }
  }

  // Exact tested code, run specs, logs, hashes.
  const code = loadCodeVerification(runDir);
  mkdirSync(`${packageDir}/code`, { recursive: true });
  for (const block of draft.codeBlocks) {
    writeFileSync(`${packageDir}/code/${block.id}.ts`, block.code);
  }
  if (code) {
    for (const check of code.checks) {
      writeFileSync(
        `${packageDir}/code/${check.codeId}.verification.json`,
        JSON.stringify(check, null, 2) + "\n"
      );
    }
  }

  // Logs and metadata.
  mkdirSync(`${packageDir}/logs`, { recursive: true });
  if (existsSync(`${runDir}/log.jsonl`)) {
    cpSync(`${runDir}/log.jsonl`, `${packageDir}/logs/log.jsonl`);
  }
  if (metadata) {
    writeFileSync(`${packageDir}/metadata.json`, JSON.stringify(metadata, null, 2) + "\n");
  }

  // References and verification summary.
  writeFileSync(`${packageDir}/references.md`, referencesMarkdown(research, loadSourcesVerification(runDir)));
  writeFileSync(
    `${packageDir}/verification-summary.json`,
    JSON.stringify(
      {
        generatedAt: nowIso(),
        sources: loadSourcesVerification(runDir)?.claimMapping ?? null,
        code: code?.checks.map((c) => ({ codeId: c.codeId, status: c.status })) ?? null,
        diagrams: diagrams?.diagrams.map((d) => ({ id: d.id, status: d.status })) ?? null,
        consistency: consistency ? { passed: consistency.passed, errors: consistency.issues.filter((i) => i.severity === "error").length } : null,
        forced: force && blockers.length > 0
      },
      null,
      2
    ) + "\n"
  );

  if (qa) writeFileSync(`${packageDir}/QA.md`, readFileSync(`${runDir}/qa/v${stageEntry(manifest, "qa").version}/qa-report.md`));

  // Forced exports are visibly marked unverified and include remaining blockers.
  if (force && blockers.length > 0) {
    writeFileSync(
      `${packageDir}/UNVERIFIED.txt`,
      [
        "!!! THIS PACKAGE IS UNVERIFIED !!!",
        `Exported with --force at ${nowIso()} despite failed mandatory checks.`,
        "A --force export never converts a failed check into a pass.",
        "",
        "Remaining blockers:",
        ...blockers.map((b) => `  - ${b}`)
      ].join("\n") + "\n"
    );
  }
  writeFileSync(
    `${packageDir}/REMAINING_ACTIONS.md`,
    (remainingActions.length
      ? ["# Remaining actions", "", ...remainingActions.map((a) => `- [ ] ${a}`)]
      : ["# Remaining actions", "", "- [ ] Final human review before manual publication on Medium"]
    ).join("\n") + "\n"
  );

  // Combined review document: 11-section structure (master editorial prompt, reconstructed).
  writeFileSync(`${packageDir}/review-package.md`, reviewPackageMarkdown({
    slug,
    research,
    markdown,
    metadata,
    visuals,
    qa,
    code,
    diagrams,
    consistency,
    blockers,
    forced: force && blockers.length > 0
  }));

  // Update export state.
  const updated = {
    ...manifest,
    export: {
      status: force && blockers.length > 0 ? ("exported_forced" as const) : ("exported" as const),
      lastExportedAt: nowIso()
    }
  };
  saveManifestState(runDir, updated);

  return { packageDir, forced: force && blockers.length > 0, blocked: false, blockers };
}

function saveManifestState(runDir: string, manifest: ReturnType<typeof loadManifest>): void {
  saveManifest(runDir, manifest);
}

function referencesMarkdown(research: ReturnType<typeof currentResearch>, sources: ReturnType<typeof loadSourcesVerification>): string {
  const lines = ["# References", ""];
  for (const s of research.sources) {
    const fetchRecord = sources?.sources.find((f) => f.sourceId === s.id);
    const status = fetchRecord?.retrievalError ? `FAILED: ${fetchRecord.retrievalError}` : `fetched ${fetchRecord?.fetchedAt ?? "n/a"}`;
    lines.push(`- [${s.id}] ${s.requestedUrl} — ${status}`);
  }
  if (sources?.modelAssessedSupport.length) {
    lines.push("", "## Support assessments (model-assisted, not deterministic proof)", "");
    for (const a of sources.modelAssessedSupport) {
      lines.push(`- ${a.claimId} <- ${a.sourceId}: ${a.verdict}`);
    }
  }
  return lines.join("\n") + "\n";
}

function markdownToHtml(markdown: string): string {
  // Best-effort minimal conversion for local review only.
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      out.push(inCode ? "</code></pre>" : "<pre><code>");
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escape(line));
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const listItem = /^\s*[-*]\s+(.*)$/.exec(line);
    const body = escape(line)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
    if (heading) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<h${heading[1]!.length}>${heading[2]}</h${heading[1]!.length}>`);
    } else if (listItem) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${listItem[1]}</li>`);
    } else if (line.trim() === "") {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push("");
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<p>${body}</p>`);
    }
  }
  if (inCode) out.push("</code></pre>");
  if (inList) out.push("</ul>");
  return out.join("\n") + "\n";
}

export interface ReviewPackageInput {
  slug: string;
  research: ReturnType<typeof currentResearch>;
  markdown: string;
  metadata: ReturnType<typeof currentMetadata>;
  visuals: ReturnType<typeof currentVisuals>;
  qa: ReturnType<typeof currentQa>;
  code: ReturnType<typeof loadCodeVerification>;
  diagrams: ReturnType<typeof loadDiagramVerification>;
  consistency: ConsistencyVerification | null;
  blockers: string[];
  forced: boolean;
}

/** 11-section combined review document (structure reconstructed from the master editorial prompt). */
export function reviewPackageMarkdown(input: ReviewPackageInput): string {
  const sections: string[] = [];
  sections.push(`# Review package: ${input.slug}`);
  sections.push(input.forced ? "**STATUS: UNVERIFIED — exported with --force despite failed checks.**" : "**STATUS: mandatory checks passed.**");
  sections.push("", "## 1. Summary", "", `Thesis: ${input.research.thesis}`);
  sections.push("", "## 2. Claim provenance", "");
  for (const claim of input.research.claims) {
    sections.push(`- ${claim.id} (${claim.kind}): ${claim.text} <- sources: ${claim.sourceIds.join(", ") || "none"}`);
  }
  sections.push("", "## 3. Source verification", "", "Fetch evidence and model-assisted support: see references.md and verification-summary.json.");
  sections.push("", "## 4. Code verification", "");
  if (input.code?.checks.length) {
    for (const c of input.code.checks) {
      sections.push(`- ${c.codeId}: ${c.status} (${c.repetitions} run(s), hash match: ${c.materializedSha256Matches})`);
    }
  } else {
    sections.push("- No executable code blocks verified.");
  }
  sections.push("", "## 5. Diagram verification", "");
  sections.push(...(input.diagrams?.diagrams ?? []).map((d) => `- ${d.id}: ${d.status}${d.labelWarnings.length ? ` warnings: ${d.labelWarnings.join("; ")}` : ""}`));
  sections.push("", "## 6. Metadata", "");
  sections.push(input.metadata ? `- headline: ${input.metadata.headline}` : "- metadata stage has not run");
  sections.push("", "## 7. QA report", "");
  if (input.qa) {
    sections.push(`Final QA status: ${input.qa.finalStatus}`);
    for (const d of input.qa.dimensions) {
      sections.push(`- ${d.dimension}: ${d.status} (${d.source})`);
    }
    if (input.qa.editorialReview) {
      sections.push("", "_Editorial review below is LLM editorial judgment, NOT verification._", "", input.qa.editorialReview.summary);
    }
  } else {
    sections.push("QA stage has not run.");
  }
  sections.push("", "## 8. Consistency findings", "");
  sections.push(...(input.consistency?.issues ?? []).map((i) => `- [${i.severity}] ${i.check}: ${i.message}`));
  sections.push("", "## 9. Remaining blockers", "");
  sections.push(...(input.blockers.length ? input.blockers.map((b) => `- ${b}`) : ["- none"]));
  sections.push("", "## 10. Publication checklist (manual Medium publishing)", "", "- [ ] Confirm metadata and tags", "- [ ] Insert rendered diagrams", "- [ ] Human read-through", "- [ ] Publish manually on Medium");
  sections.push("", "## 11. Limitations of this review", "", "- Model-assessed source support is not deterministic proof.", "- Successful code execution proves only the tested assertions and environment.", "- Rendered diagrams prove renderability, not factual truth.", "- Reading time and platform limits come from configuration and may be unverified.");
  return sections.join("\n") + "\n";
}


