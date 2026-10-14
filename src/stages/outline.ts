import { readFileSync } from "node:fs";
import { outlineOutputSchema, type OutlineOutput } from "./schemas.js";
import { runLLMStage } from "./llmStage.js";
import { StageFailure, type StageDefinition } from "./types.js";
import { stageEntry, type Manifest } from "../run/manifest.js";
import { currentResearch } from "./research.js";

export const outlineStage: StageDefinition = {
  name: "outline",
  requiresLlm: true,
  approvalGate: true,
  async execute(ctx, manifest) {
    const entry = stageEntry(manifest, "outline");
    const research = currentResearch(ctx.runDir, manifest);
    const request = readFileSync(`${ctx.runDir}/request.md`, "utf8");
    try {
      const { entry: updated } = await runLLMStage({
        ctx,
        manifest,
        stage: "outline",
        promptFile: "stages/outline.md",
        userPayload:
          `ARTICLE REQUEST:\n${request}\n\nRESEARCH (claims and sources):\n${JSON.stringify(
            { thesis: research.thesis, claims: research.claims, sources: research.sources, evidenceGaps: research.evidenceGaps },
            null,
            2
          )}`,
        schema: outlineOutputSchema,
        entry,
        files: (output: OutlineOutput) => ({ "outline.json": JSON.stringify(output, null, 2) + "\n" })
      });
      return { entry: updated };
    } catch (err) {
      throw new StageFailure(`Outline stage failed: ${(err as Error).message}`, "outline");
    }
  }
};

export function currentOutline(runDir: string, manifest: Manifest): OutlineOutput {
  const entry = stageEntry(manifest, "outline");
  if (entry.version < 1) throw new StageFailure("Outline has not run yet", "outline");
  return outlineOutputSchema.parse(
    JSON.parse(readFileSync(`${runDir}/outline/v${entry.version}/outline.json`, "utf8"))
  );
}
