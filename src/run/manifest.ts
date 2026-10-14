import { z } from "zod";
import { stageNameSchema, stageStatusSchema, STAGE_ORDER, type StageName } from "../config/schema.js";
import { sha256, nowIso } from "../util/hash.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureDirFor } from "../util/fs.js";

export const approvalStateSchema = z.object({
  state: z.enum(["not_required", "awaiting", "approved", "rejected"]).default("awaiting"),
  decidedBy: z.string().nullable().default(null),
  decidedAt: z.string().datetime().nullable().default(null)
});

export const artifactRefSchema = z.object({
  path: z.string(),
  sha256: z.string()
});

export const stageEntrySchema = z.object({
  name: stageNameSchema,
  status: stageStatusSchema,
  version: z.number().int().min(0),
  inputs: z.array(artifactRefSchema).default([]),
  outputs: z.array(artifactRefSchema).default([]),
  promptHashes: z.array(artifactRefSchema).default([]),
  approvals: approvalStateSchema,
  error: z.string().nullable().default(null),
  startedAt: z.string().datetime().nullable().default(null),
  finishedAt: z.string().datetime().nullable().default(null)
});

export const manifestSchema = z.object({
  slug: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  requestHash: z.string(),
  stages: z.array(stageEntrySchema),
  verification: z
    .object({
      sources: z.string().nullable().default(null),
      code: z.string().nullable().default(null),
      diagrams: z.string().nullable().default(null),
      consistency: z.string().nullable().default(null)
    })
    .default({ sources: null, code: null, diagrams: null, consistency: null }),
  export: z
    .object({
      status: z.enum(["not_exported", "exported", "exported_forced"]).default("not_exported"),
      lastExportedAt: z.string().datetime().nullable().default(null)
    })
    .default({ status: "not_exported", lastExportedAt: null })
});

export type Manifest = z.infer<typeof manifestSchema>;
export type StageEntry = z.infer<typeof stageEntrySchema>;

export class ManifestError extends Error {}

export function manifestPath(runDir: string): string {
  return `${runDir}/manifest.json`;
}

export function loadManifest(runDir: string): Manifest {
  const path = manifestPath(runDir);
  if (!existsSync(path)) {
    throw new ManifestError(`No manifest found at ${path}. Did you run "pipeline init ${runDir.split("/").pop()}"?`);
  }
  const parsed = manifestSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new ManifestError(`Corrupt manifest at ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function saveManifest(runDir: string, manifest: Manifest): void {
  const updated = { ...manifest, updatedAt: nowIso() };
  ensureDirFor(manifestPath(runDir));
  writeFileSync(manifestPath(runDir), JSON.stringify(updated, null, 2) + "\n");
}

export function createManifest(slug: string, requestBytes: string): Manifest {
  return manifestSchema.parse({
    slug,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    requestHash: sha256(requestBytes),
    stages: STAGE_ORDER.map((name) => newStageEntry(name))
  });
}

export function newStageEntry(name: StageName): StageEntry {
  return stageEntrySchema.parse({
    name,
    status: "pending",
    version: 0,
    inputs: [],
    outputs: [],
    promptHashes: [],
    approvals: { state: "awaiting", decidedBy: null, decidedAt: null }
  });
}

export function stageEntry(manifest: Manifest, name: StageName): StageEntry {
  const entry = manifest.stages.find((s) => s.name === name);
  if (!entry) throw new ManifestError(`Stage ${name} missing from manifest`);
  return entry;
}

/**
 * Recompute hashes of each stage's recorded input artifacts and mark the stage
 * (and everything downstream of it) stale when inputs changed on disk.
 */
export function refreshStaleness(runDir: string, manifest: Manifest): Manifest {
  const order = STAGE_ORDER;
  let staleFrom: StageName | null = null;
  const stages = manifest.stages.map((entry) => {
    const downstream = staleFrom !== null && order.indexOf(entry.name) > order.indexOf(staleFrom);
    if (entry.status === "pending" || entry.status === "running") return entry;
    const changed =
      entry.inputs.some((ref) => {
        if (!existsSync(`${runDir}/${ref.path}`)) return true;
        return sha256(readFileSync(`${runDir}/${ref.path}`)) !== ref.sha256;
      }) || (downstream && entry.status === "passed");
    if (changed) {
      if (staleFrom === null) staleFrom = entry.name;
      return { ...entry, status: "stale" as const };
    }
    return entry;
  });
  return { ...manifest, stages, updatedAt: nowIso() };
}

/** Stage statuses: approval-gates become needs_approval when --auto is not set. */
export function isApproved(entry: StageEntry, auto: boolean): boolean {
  if (auto) return true;
  return entry.approvals.state === "approved";
}
