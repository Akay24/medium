import { z } from "zod";
import { readFileSync } from "node:fs";
import YAML from "js-yaml";

export const stageNameSchema = z.enum([
  "research",
  "outline",
  "draft",
  "visuals",
  "metadata",
  "qa"
]);

export const stageStatusSchema = z.enum([
  "pending",
  "running",
  "needs_approval",
  "passed",
  "failed",
  "stale",
  "skipped"
]);

/** Medium platform limits must carry verification metadata or be flagged unverified. */
export const platformLimitSchema = z.object({
  value: z.union([z.number(), z.string(), z.null()]),
  lastVerifiedAt: z.string().datetime().nullable(),
  sourceUrl: z.string().url().nullable(),
  unverified: z.boolean()
});

export const configSchema = z.object({
  defaults: z
    .object({
      model: z.string().min(1)
    })
    .optional(),
  models: z
    .object({
      research: z.string().optional(),
      outline: z.string().optional(),
      draft: z.string().optional(),
      visuals: z.string().optional(),
      metadata: z.string().optional(),
      qa: z.string().optional(),
      sourceSupport: z.string().optional()
    })
    .optional(),
  providers: z
    .object({
      llm: z.enum(["anthropic"]).default("anthropic"),
      research: z.enum(["manual", "web"]).default("manual"),
      image: z.enum(["brief-only", "none"]).default("brief-only"),
      sandbox: z.enum(["docker", "fake"]).default("docker")
    })
    .default({ llm: "anthropic", research: "manual", image: "brief-only", sandbox: "docker" }),
  retries: z
    .object({
      llmInvalidOutput: z.number().int().min(0).default(2)
    })
    .default({ llmInvalidOutput: 2 }),
  approvals: z
    .object({
      auto: z.boolean().default(false)
    })
    .default({ auto: false }),
  research: z
    .object({
      maxSources: z.number().int().min(1).default(12),
      maxRedirects: z.number().int().min(0).default(5),
      fetchTimeoutMs: z.number().int().min(1000).default(20000),
      maxResponseBytes: z.number().int().min(1024).default(2_000_000),
      allowedDomains: z.array(z.string()).default([]),
      allowPrivateAddresses: z.boolean().default(false)
    })
    .default({
      maxSources: 12,
      maxRedirects: 5,
      fetchTimeoutMs: 20000,
      maxResponseBytes: 2_000_000,
      allowedDomains: [],
      allowPrivateAddresses: false
    }),
  sandbox: z
    .object({
      image: z.string().default("node:22-bookworm-slim"),
      memoryMb: z.number().int().min(64).default(512),
      cpus: z.number().min(0.1).default(1),
      pidsLimit: z.number().int().min(1).default(128),
      timeoutMs: z.number().int().min(1000).default(30000),
      maxOutputBytes: z.number().int().min(1024).default(1_000_000),
      networkEnabled: z.boolean().default(false),
      repetitions: z.number().int().min(1).default(3),
      readonlyRootfs: z.boolean().default(true),
      dropAllCapabilities: z.boolean().default(true)
    })
    .default({
      image: "node:22-bookworm-slim",
      memoryMb: 512,
      cpus: 1,
      pidsLimit: 128,
      timeoutMs: 30000,
      maxOutputBytes: 1_000_000,
      networkEnabled: false,
      repetitions: 3,
      readonlyRootfs: true,
      dropAllCapabilities: true
    }),
  diagrams: z
    .object({
      rendererCommand: z.string().default("mmdc"),
      timeoutMs: z.number().int().min(1000).default(60000),
      format: z.enum(["svg", "png"]).default("svg")
    })
    .default({ rendererCommand: "mmdc", timeoutMs: 60000, format: "svg" }),
  imageProvider: z
    .object({
      mode: z.enum(["brief-only", "none"]).default("brief-only")
    })
    .default({ mode: "brief-only" }),
  mediumLimits: z
    .object({
      maxTags: platformLimitSchema,
      maxSubtitleLength: platformLimitSchema,
      maxTitleLength: platformLimitSchema,
      unverifiedNotice: z.string()
    }),
  phraseWarnings: z
    .object({
      enabled: z.boolean().default(true),
      phrases: z.array(z.string()).default([])
    })
    .optional(),
  exportPolicy: z
    .object({
      blockOnFailedVerification: z.boolean().default(true)
    })
    .default({ blockOnFailedVerification: true }),
  pricing: z
    .object({
      // USD per 1M tokens, keyed by model id. Cost is estimated ONLY for models present here.
      perModel: z.record(z.object({ inputPerMillion: z.number(), outputPerMillion: z.number() }))
    })
    .optional()
});

export type PipelineConfig = z.infer<typeof configSchema>;
export type PlatformLimit = z.infer<typeof platformLimitSchema>;
export type StageName = z.infer<typeof stageNameSchema>;

export const STAGE_ORDER: readonly StageName[] = [
  "research",
  "outline",
  "draft",
  "visuals",
  "metadata",
  "qa"
] as const;

export class ConfigError extends Error {}

export function loadConfig(path = "pipeline.config.yml"): PipelineConfig {
  let raw: unknown;
  try {
    raw = YAML.load(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(`Cannot read config file ${path}: ${(err as Error).message}`);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ConfigError(`Invalid pipeline.config.yml: ${issues}`);
  }
  return parsed.data;
}

/** Per-stage model id with a configurable fallback; never hardcoded at call sites. */
export function modelForStage(config: PipelineConfig, stage: StageName | "sourceSupport"): string {
  const perStage = config.models?.[stage as keyof NonNullable<typeof config.models>];
  return perStage ?? config.defaults?.model ?? "";
}
