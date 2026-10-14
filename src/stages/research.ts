import { readFileSync } from "node:fs";
import { researchOutputSchema, type ResearchOutput } from "./schemas.js";
import { runLLMStage } from "./llmStage.js";
import { StageFailure, type StageDefinition } from "./types.js";
import { stageEntry, type Manifest } from "../run/manifest.js";

export function currentResearch(runDir: string, manifest: Manifest): ResearchOutput {
  const entry = stageEntry(manifest, "research");
  if (entry.version < 1) throw new StageFailure("Research has not run yet", "research");
  const path = `${runDir}/research/v${entry.version}/research.json`;
  return researchOutputSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

export const researchStage: StageDefinition = {
  name: "research",
  requiresLlm: true,
  approvalGate: true,
  async execute(ctx, manifest) {
    const entry = stageEntry(manifest, "research");
    const request = readFileSync(`${ctx.runDir}/request.md`, "utf8");
    try {
      const { entry: updated } = await runLLMStage({
        ctx,
        manifest,
        stage: "research",
        promptFile: "stages/research.md",
        userPayload: `ARTICLE REQUEST:\n${request}`,
        schema: researchOutputSchema,
        entry,
        files: (output: ResearchOutput) => ({ "research.json": JSON.stringify(output, null, 2) + "\n" })
      });
      return { entry: updated };
    } catch (err) {
      throw new StageFailure(`Research stage failed: ${(err as Error).message}`, "research");
    }
  }
};
