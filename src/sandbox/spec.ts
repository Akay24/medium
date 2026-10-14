import { z } from "zod";
import { readFileSync, readdirSync } from "node:fs";
import YAML from "js-yaml";

export const sandboxSpecSchema = z.object({
  /** Stable run-spec id referenced by article code fences: ```ts run=redis-basic */
  id: z.string().min(1),
  /** Base image pinned to an explicit version tag or digest. */
  image: z.string().min(1),
  setup: z.array(z.string()).default([]),
  run: z.string().min(1),
  timeoutMs: z.number().int().min(1000).default(30000),
  memoryMb: z.number().int().min(64).default(512),
  cpus: z.number().min(0.1).default(1),
  pidsLimit: z.number().int().min(1).default(128),
  maxOutputBytes: z.number().int().min(1024).default(1_000_000),
  networkEnabled: z.boolean().default(false),
  /** Required services (e.g. redis) declared declaratively; the executor wires them. */
  services: z
    .array(
      z.object({
        name: z.string(),
        image: z.string().min(1),
        ports: z.array(z.string()).default([])
      })
    )
    .default([]),
  /** Human description of what the assertions in this spec actually test. */
  asserts: z.string().default(""),
  /** Behaviors deliberately NOT covered by the assertions. */
  untested: z.array(z.string()).default([]),
  cleanup: z.enum(["always", "on-failure"]).default("always")
});

export type SandboxSpec = z.infer<typeof sandboxSpecSchema>;

export class SandboxSpecError extends Error {}

export function loadSandboxSpec(path: string): SandboxSpec {
  const parsed = sandboxSpecSchema.safeParse(YAML.load(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new SandboxSpecError(`Invalid sandbox spec ${path}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function loadSandboxSpecs(dir: string): Map<string, SandboxSpec> {
  const specs = new Map<string, SandboxSpec>();
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".yml") && !name.endsWith(".yaml")) continue;
      const spec = loadSandboxSpec(`${dir}/${name}`);
      specs.set(spec.id, spec);
    }
  } catch {
    // no sandboxes dir -> empty map; code with run specs will fail clearly later
  }
  return specs;
}
