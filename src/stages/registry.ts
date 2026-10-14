import { STAGE_ORDER, stageNameSchema, type StageName } from "../config/schema.js";
import type { StageDefinition } from "./types.js";
import { researchStage } from "./research.js";
import { outlineStage } from "./outline.js";
import { draftStage } from "./draft.js";
import { visualsStage } from "./visuals.js";
import { metadataStage } from "./metadata.js";
import { qaStage } from "./qa.js";

export const STAGES: Record<StageName, StageDefinition> = {
  research: researchStage,
  outline: outlineStage,
  draft: draftStage,
  visuals: visualsStage,
  metadata: metadataStage,
  qa: qaStage
};

export function stageNames(): StageName[] {
  return [...STAGE_ORDER];
}

export function parseStageName(raw: string): StageName {
  const parsed = stageNameSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Unknown stage "${raw}". Valid stages: ${STAGE_ORDER.join(", ")} (dependency order).`
    );
  }
  return parsed.data;
}

/** Linear dependency order: research -> outline -> draft -> visuals -> metadata -> qa. */
export function stageRange(from?: string, to?: string): StageName[] {
  const fromIdx = from ? STAGE_ORDER.indexOf(parseStageName(from)) : 0;
  const toIdx = to ? STAGE_ORDER.indexOf(parseStageName(to)) : STAGE_ORDER.length - 1;
  if (fromIdx > toIdx) {
    throw new Error(`--from (${String(from)}) must not come after --to (${String(to)}) in dependency order.`);
  }
  return STAGE_ORDER.slice(fromIdx, toIdx + 1);
}
