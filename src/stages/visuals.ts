import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { visualsOutputSchema, type VisualsOutput, type DiagramRecord } from "./schemas.js";
import { StageFailure, type StageDefinition, type StageContext } from "./types.js";
import { stageEntry, type Manifest } from "../run/manifest.js";
import { currentDraft } from "./draft.js";
import { currentOutline } from "./outline.js";
import { loadPrompt } from "../llm/prompts.js";
import { modelFor } from "./llmStage.js";
import { sha256 } from "../util/hash.js";
import type { StructuredRequest } from "../llm/types.js";
import { z } from "zod";

const visualsLlmSchema = z.object({
  diagrams: z
    .array(
      z.object({
        id: z.string().min(1),
        articleLocation: z.string().min(1),
        purpose: z.string().min(1),
        mermaid: z.string().min(1)
      })
    )
    .default([]),
  coverBrief: z.string().min(50)
});

export const visualsStage: StageDefinition = {
  name: "visuals",
  requiresLlm: true,
  approvalGate: true,
  async execute(ctx, manifest) {
    const entry = stageEntry(manifest, "visuals");
    const { markdown, draft } = currentDraft(ctx.runDir, manifest);
    const outline = currentOutline(ctx.runDir, manifest);
    try {
      if (!ctx.llm) throw new Error("visuals stage requires an LLM provider");
      const prompt = loadPrompt("prompts/stages/visuals.md");
      const model = modelFor(ctx.config, "visuals");
      const result = await ctx.llm.generateStructured({
        system: prompt.content,
        prompt: `ARTICLE:\n${markdown.slice(0, 30_000)}\n\nOUTLINE (diagram ids planned): ${JSON.stringify(
          outline.sections.flatMap((s) => s.diagramIds)
        )}\nDRAFT diagram refs: ${JSON.stringify(draft.diagramRefs)}`,
        schema: visualsLlmSchema,
        label: "visuals",
        maxRetries: ctx.config.retries.llmInvalidOutput,
        model
      });
      ctx.logger.log({
        event: "llm_call",
        stage: "visuals",
        model: result.model,
        promptHash: result.promptHash,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        durationMs: result.durationMs,
        retries: result.retries
      });

      const version = entry.version + 1;
      const dir = `${ctx.runDir}/visuals/v${version}`;
      mkdirSync(`${dir}/diagrams`, { recursive: true });
      const diagrams: DiagramRecord[] = result.data.diagrams.map((d) => {
        writeFileSync(`${dir}/diagrams/${d.id}.mmd`, d.mermaid + "\n");
        return {
          id: d.id,
          articleLocation: d.articleLocation,
          purpose: d.purpose,
          status: "conceptual" as const,
          mmdPath: `visuals/v${version}/diagrams/${d.id}.mmd`,
          renderedPaths: [],
          renderError: null
        };
      });
      writeFileSync(`${dir}/cover-brief.md`, result.data.coverBrief + "\n");

      // Default image mode is brief-only: no image file unless a real provider is configured.
      const cover: VisualsOutput["cover"] =
        ctx.config.imageProvider.mode === "brief-only"
          ? { status: "brief_created", briefPath: `visuals/v${version}/cover-brief.md`, imagePath: null, note: "brief-only mode: no image generated" }
          : { status: "not_requested", briefPath: null, imagePath: null, note: "image provider mode none" };

      const output: VisualsOutput = { diagrams, cover };
      writeFileSync(`${dir}/visuals.json`, JSON.stringify(output, null, 2) + "\n");

      return {
        entry: {
          ...entry,
          status: "passed",
          version,
          promptHashes: [{ path: "prompts/stages/visuals.md", sha256: prompt.hash }],
          outputs: [
            { path: `visuals/v${version}/visuals.json`, sha256: sha256(readFileSync(`${dir}/visuals.json`)) },
            { path: `visuals/v${version}/cover-brief.md`, sha256: sha256(readFileSync(`${dir}/cover-brief.md`)) }
          ],
          startedAt: entry.startedAt ?? new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          error: null
        }
      };
    } catch (err) {
      throw new StageFailure(`Visuals stage failed: ${(err as Error).message}`, "visuals");
    }
  }
};

export function currentVisuals(runDir: string, manifest: Manifest): VisualsOutput | null {
  const entry = stageEntry(manifest, "visuals");
  if (entry.version < 1) return null;
  const path = `${runDir}/visuals/v${entry.version}/visuals.json`;
  if (!existsSync(path)) return null;
  return visualsOutputSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

