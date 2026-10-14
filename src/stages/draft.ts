import { readFileSync } from "node:fs";
import { draftOutputSchema, type DraftOutput } from "./schemas.js";
import { runLLMStage } from "./llmStage.js";
import { StageFailure, type StageDefinition, type StageContext } from "./types.js";
import { stageEntry, type Manifest } from "../run/manifest.js";
import { currentResearch } from "./research.js";
import { currentOutline } from "./outline.js";
import { parseDraft } from "./draftParse.js";
import { z } from "zod";

const rawDraftSchema = z.object({
  markdown: z.string().min(200),
  untestedBehaviors: z
    .array(z.object({ codeId: z.string(), behavior: z.string() }))
    .default([])
});

export const draftStage: StageDefinition = {
  name: "draft",
  requiresLlm: true,
  approvalGate: true,
  async execute(ctx, manifest) {
    const entry = stageEntry(manifest, "draft");
    const research = currentResearch(ctx.runDir, manifest);
    const outline = currentOutline(ctx.runDir, manifest);
    try {
      const { entry: updated } = await runLLMStage({
        ctx,
        manifest,
        stage: "draft",
        promptFile: "stages/draft.md",
        userPayload:
          `ARTICLE OUTLINE:\n${JSON.stringify(outline, null, 2)}\n\nRESEARCH CLAIMS (use <!-- claim:cN --> markers after sentences backed by external facts):\n${JSON.stringify(
            research.claims,
            null,
            2
          )}\n\nSOURCES:\n${JSON.stringify(research.sources.map((s) => ({ id: s.id, requestedUrl: s.requestedUrl })), null, 2)}`,
        schema: rawDraftSchema,
        entry,
        files: (raw) => draftFiles(raw.markdown, research.claims.map((c) => c.id), raw.untestedBehaviors ?? [])
      });
      return { entry: updated };
    } catch (err) {
      throw new StageFailure(`Draft stage failed: ${(err as Error).message}`, "draft");
    }
  }
};

/** Write article.md plus draft.json with parsed claim markers and materialized code blocks. */
function draftFiles(
  markdown: string,
  knownClaimIds: string[],
  untestedBehaviors: { codeId: string; behavior: string }[]
): Record<string, string> {
  const parsed = parseDraft(markdown, new Set(knownClaimIds));
  const draftJson: DraftOutput = {
    markdownPath: "article.md",
    claims: [],
    codeBlocks: parsed.codeBlocks,
    diagramRefs: parsed.diagramRefs,
    untestedBehaviors
  };
  return {
    "article.md": markdown,
    "draft.json": JSON.stringify(draftJson, null, 2) + "\n"
  };
}

export function currentDraft(runDir: string, manifest: Manifest): { markdown: string; draft: DraftOutput; version: number; dir: string } {
  const entry = stageEntry(manifest, "draft");
  if (entry.version < 1) throw new StageFailure("Draft has not run yet", "draft");
  const dir = `${runDir}/draft/v${entry.version}`;
  const markdown = readFileSync(`${dir}/article.md`, "utf8");
  const draft = draftOutputSchema.parse(JSON.parse(readFileSync(`${dir}/draft.json`, "utf8")));
  return { markdown, draft, version: entry.version, dir };
}

export function currentDraftVersion(manifest: Manifest): number {
  return stageEntry(manifest, "draft").version;
}
