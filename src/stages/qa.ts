import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { z } from "zod";
import { sha256, nowIso } from "../util/hash.js";
import { StageFailure, type StageDefinition, type StageContext } from "./types.js";
import { stageEntry, type Manifest, type StageEntry } from "../run/manifest.js";
import { currentDraft } from "./draft.js";
import { currentResearch } from "./research.js";
import { loadCodeVerification } from "../verifiers/code.js";
import { loadDiagramVerification } from "../verifiers/diagrams.js";
import { loadConsistencyVerification } from "../verifiers/consistency.js";
import { loadPrompt } from "../llm/prompts.js";
import { modelFor } from "./llmStage.js";

export const qaDimensionSchema = z.enum(["PASS", "NEEDS REVIEW", "FAIL"]);

export const qaOutputSchema = z.object({
  generatedAt: z.string().datetime(),
  finalStatus: z.enum(["PASS", "NEEDS REVIEW", "FAIL"]),
  dimensions: z.array(
    z.object({
      dimension: z.string(),
      status: qaDimensionSchema,
      source: z.enum(["deterministic_verifier", "editorial_review", "human_review"]),
      detail: z.string()
    })
  ),
  editorialReview: z
    .object({
      labeledAs: z.literal("editorial_judgment"),
      model: z.string(),
      summary: z.string(),
      suggestions: z.array(z.string())
    })
    .nullable(),
  humanReviewItems: z.array(z.string())
});

export type QaOutput = z.infer<typeof qaOutputSchema>;

const editorialSchema = z.object({
  summary: z.string().min(1),
  suggestions: z.array(z.string()).default([]),
  humanReviewItems: z.array(z.string()).default([])
});

export const qaStage: StageDefinition = {
  name: "qa",
  requiresLlm: true,
  approvalGate: true,
  async execute(ctx, manifest) {
    const entry = stageEntry(manifest, "qa");
    const { markdown } = currentDraft(ctx.runDir, manifest);
    const research = currentResearch(ctx.runDir, manifest);
    const code = loadCodeVerification(ctx.runDir);
    const diagrams = loadDiagramVerification(ctx.runDir);
    const consistency = loadConsistencyVerification(ctx.runDir);

    // Deterministic dimensions first — derived from verifier artifacts, never from the LLM.
    const dimensions: QaOutput["dimensions"] = [];
    dimensions.push({
      dimension: "source_mapping",
      status: research.claims.some((c) => c.kind === "doc-fact" && c.sourceIds.length === 0) ? "FAIL" : "NEEDS REVIEW",
      source: "deterministic_verifier",
      detail: "Claim→source mapping present for doc-fact claims; semantic support is model-assessed only."
    });
    dimensions.push({
      dimension: "code_verification",
      status: !code || code.checks.length === 0 ? "NEEDS REVIEW" : code.checks.some((c) => c.status === "failed" || c.status === "flaky" || c.status === "error") ? "FAIL" : "PASS",
      source: "deterministic_verifier",
      detail: code ? `${code.checks.filter((c) => c.status === "passed").length}/${code.checks.length} checks passed (sandbox: ${code.sandbox})` : "no code verification artifact"
    });
    dimensions.push({
      dimension: "diagrams",
      status: !diagrams || diagrams.diagrams.length === 0 ? "NEEDS REVIEW" : diagrams.diagrams.some((d) => d.status === "failed") ? "FAIL" : "PASS",
      source: "deterministic_verifier",
      detail: diagrams ? `${diagrams.diagrams.filter((d) => d.status === "rendered").length}/${diagrams.diagrams.length} rendered` : "no diagrams"
    });
    if (consistency) {
      dimensions.push({
        dimension: "consistency",
        status: consistency.passed ? "PASS" : "FAIL",
        source: "deterministic_verifier",
        detail: `${consistency.issues.filter((i) => i.severity === "error").length} error(s), ${consistency.issues.filter((i) => i.severity === "warning").length} warning(s)`
      });
    }

    // LLM editorial review — clearly labeled as editorial judgment, never merged into verdicts.
    let editorial: QaOutput["editorialReview"] = null;
    let humanReviewItems: string[] = ["Confirm publication metadata", "Read article end-to-end for voice and accuracy"];
    if (ctx.llm) {
      try {
        const prompt = loadPrompt("prompts/stages/qa.md");
        const model = modelFor(ctx.config, "qa");
        const result = await ctx.llm.generateStructured({
          system: prompt.content,
          prompt: `ARTICLE:\n${markdown.slice(0, 30_000)}\n\nDETERMINISTIC VERIFIER RESULTS:\n${JSON.stringify(dimensions, null, 2)}`,
          schema: editorialSchema,
          label: "qa",
          maxRetries: ctx.config.retries.llmInvalidOutput,
          model
        });
        editorial = { labeledAs: "editorial_judgment", model: result.model, summary: result.data.summary, suggestions: result.data.suggestions };
        humanReviewItems = [...humanReviewItems, ...result.data.humanReviewItems];
        ctx.logger.log({ event: "llm_call", stage: "qa", model: result.model, promptHash: result.promptHash, durationMs: result.durationMs });
      } catch {
        dimensions.push({
          dimension: "editorial_review",
          status: "NEEDS REVIEW",
          source: "editorial_review",
          detail: "LLM editorial review failed to produce valid output; treat as not reviewed"
        });
      }
    }

    const mandatoryFail = dimensions.some((d) => d.source === "deterministic_verifier" && d.status === "FAIL");
    const anyNeedsReview = dimensions.some((d) => d.status === "NEEDS REVIEW");
    const finalStatus: QaOutput["finalStatus"] = mandatoryFail ? "FAIL" : anyNeedsReview ? "NEEDS REVIEW" : "PASS";

    const version = entry.version + 1;
    const dir = `${ctx.runDir}/qa/v${version}`;
    mkdirSync(dir, { recursive: true });
    const output: QaOutput = {
      generatedAt: nowIso(),
      finalStatus,
      dimensions,
      editorialReview: editorial,
      humanReviewItems
    };
    writeFileSync(`${dir}/qa.json`, JSON.stringify(output, null, 2) + "\n");
    writeFileSync(`${dir}/qa-report.md`, qaReportMarkdown(output));
    const updatedEntry: StageEntry = {
      ...entry,
      status: "passed",
      version,
      outputs: [
        { path: `qa/v${version}/qa.json`, sha256: sha256(readFileSync(`${dir}/qa.json`)) },
        { path: `qa/v${version}/qa-report.md`, sha256: sha256(readFileSync(`${dir}/qa-report.md`)) }
      ],
      startedAt: entry.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: null
    };
    return { entry: updatedEntry };
  }
};

export function qaReportMarkdown(qa: QaOutput): string {
  const lines = [
    "# QA report",
    "",
    `Final status: **${qa.finalStatus}**`,
    "",
    "## 1. Deterministic verifier results",
    "",
    "| dimension | status | detail |",
    "|---|---|---|",
    ...qa.dimensions.filter((d) => d.source === "deterministic_verifier").map((d) => `| ${d.dimension} | ${d.status} | ${d.detail} |`),
    "",
    "## 2. LLM editorial review (editorial judgment, NOT verification)",
    "",
    qa.editorialReview ? `Model: ${qa.editorialReview.model}\n\n${qa.editorialReview.summary}\n\nSuggestions:\n${qa.editorialReview.suggestions.map((s) => `- ${s}`).join("\n")}` : "No editorial review available.",
    "",
    "## 3. Human review items",
    "",
    ...qa.humanReviewItems.map((h) => `- [ ] ${h}`)
  ];
  return lines.join("\n") + "\n";
}

export function currentQa(runDir: string, manifest: Manifest): QaOutput | null {
  const entry = stageEntry(manifest, "qa");
  if (entry.version < 1) return null;
  const path = `${runDir}/qa/v${entry.version}/qa.json`;
  if (!existsSync(path)) return null;
  return qaOutputSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
