import type { z } from "zod";
import type { StageName } from "../config/schema.js";
import type { Manifest, StageEntry } from "../run/manifest.js";
import type { LLMProvider } from "../llm/types.js";
import type { PipelineConfig } from "../config/schema.js";
import type { RunLogger } from "../run/log.js";

export interface StageContext {
  runDir: string;
  config: PipelineConfig;
  llm: LLMProvider | null;
  logger: RunLogger;
  auto: boolean;
  /** Versioned prompt file path relative to repo root. */
  promptPath: (file: string) => string;
}

export interface StageResult {
  entry: StageEntry;
  /** Message for logs/status output. */
  note?: string;
}

export interface StageDefinition {
  name: StageName;
  /** Whether this stage requires an LLM. */
  requiresLlm: boolean;
  /** Human approval gate after this stage (unless --auto). */
  approvalGate: boolean;
  execute(ctx: StageContext, manifest: Manifest): Promise<StageResult>;
}

export class StageFailure extends Error {
  constructor(
    message: string,
    public readonly stage: StageName
  ) {
    super(message);
  }
}
