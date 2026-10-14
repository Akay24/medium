import { readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { metadataOutputSchema, type MetadataOutput } from "./schemas.js";
import { runLLMStage } from "./llmStage.js";
import { StageFailure, type StageDefinition, type StageContext } from "./types.js";
import { stageEntry, type Manifest } from "../run/manifest.js";
import { currentDraft } from "./draft.js";
import { currentVisuals } from "./visuals.js";
import { readingTimeMinutes, proseWordCount } from "./draftParse.js";
import type { PlatformLimit } from "../config/schema.js";

function limitRecord(limit: PlatformLimit | undefined): MetadataOutput["platformLimits"]["tags"] {
  return {
    value: limit?.value ?? null,
    lastVerifiedAt: limit?.lastVerifiedAt ?? null,
    sourceUrl: limit?.sourceUrl ?? null,
    unverified: limit?.unverified ?? true
  };
}

export const metadataStage: StageDefinition = {
  name: "metadata",
  requiresLlm: true,
  approvalGate: true,
  async execute(ctx, manifest) {
    const entry = stageEntry(manifest, "metadata");
    const { markdown } = currentDraft(ctx.runDir, manifest);
    const visuals = currentVisuals(ctx.runDir, manifest);
    const limits = ctx.config.mediumLimits;
    try {
      const { entry: updated } = await runLLMStage({
        ctx,
        manifest,
        stage: "metadata",
        promptFile: "stages/metadata.md",
        userPayload:
          `ARTICLE (first 20k chars):\n${markdown.slice(0, 20_000)}\n\n` +
          `Platform limits (flags come from config; treat limits marked unverified as such and repeat the flag):\n${JSON.stringify(limits, null, 2)}\n` +
          `Prose word count: ${proseWordCount(markdown)}`,
        schema: metadataOutputSchema.omit({ readingTimeMinutes: true, platformLimits: true }),
        entry,
        files: (raw) => {
          const output: MetadataOutput = {
            ...raw,
            readingTimeMinutes: readingTimeMinutes(markdown),
            platformLimits: {
              tags: limitRecord(limits.maxTags),
              title: limitRecord(limits.maxTitleLength),
              subtitle: limitRecord(limits.maxSubtitleLength)
            }
          };
          return { "metadata.json": JSON.stringify(output, null, 2) + "\n" };
        }
      });
      return { entry: updated };
    } catch (err) {
      throw new StageFailure(`Metadata stage failed: ${(err as Error).message}`, "metadata");
    }
  }
};

export function currentMetadata(runDir: string, manifest: Manifest): MetadataOutput | null {
  const entry = stageEntry(manifest, "metadata");
  if (entry.version < 1) return null;
  const path = `${runDir}/metadata/v${entry.version}/metadata.json`;
  try {
    return metadataOutputSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}
