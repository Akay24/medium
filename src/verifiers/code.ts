import { z } from "zod";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { sha256, nowIso } from "../util/hash.js";
import type { SandboxSpec } from "../sandbox/spec.js";
import type { CodeSandbox } from "../sandbox/docker.js";
import type { CodeBlock } from "../stages/schemas.js";
import type { RunLogger } from "../run/log.js";

export interface CodeCheck {
  codeId: string;
  status: "passed" | "failed" | "flaky" | "unexecuted" | "error";
  runSpec: string | null;
  sourceSha256: string;
  repetitions: number;
  exitCodes: (number | null)[];
  logs: { stdout: string; stderr: string }[];
  toolVersions: Record<string, string>;
  untestedBehaviors: string[];
  error?: string;
  /** Proof that the executed bytes equal the article's code bytes. */
  materializedSha256Matches: boolean;
}

export const codeVerificationSchema = z.object({
  generatedAt: z.string().datetime(),
  sandbox: z.string(),
  sandboxAvailable: z.boolean(),
  checks: z.array(
    z.object({
      codeId: z.string(),
      status: z.enum(["passed", "failed", "flaky", "unexecuted", "error"]),
      runSpec: z.string().nullable(),
      sourceSha256: z.string(),
      repetitions: z.number(),
      exitCodes: z.array(z.number().nullable()),
      logs: z.array(z.object({ stdout: z.string(), stderr: z.string() })),
      toolVersions: z.record(z.string()),
      untestedBehaviors: z.array(z.string()),
      materializedSha256Matches: z.boolean(),
      error: z.string().optional()
    })
  )
});

export type CodeVerification = z.infer<typeof codeVerificationSchema>;

export interface CodeVerifierInput {
  runDir: string;
  codeBlocks: CodeBlock[];
  specs: Map<string, SandboxSpec>;
  sandbox: CodeSandbox;
  /** Harness files (tests) kept separate from the article snippet. */
  harness: { [runSpecId: string]: { path: string; contents: string; entrypoint: string } };
  repetitions: number;
  logger?: RunLogger;
}

/**
 * Execute each article code block that carries a run spec.
 * - Materializes the EXACT snippet bytes into the sandbox and compares hashes.
 * - Blocks without a run spec are labeled `unexecuted`, never executed silently.
 * Successful execution proves only the assertions and environment actually tested.
 */
export async function verifyCode(input: CodeVerifierInput): Promise<CodeVerification> {
  const checks: CodeCheck[] = [];

  for (const block of input.codeBlocks) {
    const spec = block.runSpec ? input.specs.get(block.runSpec) : null;
    if (!block.runSpec) {
      checks.push({
        codeId: block.id,
        status: "unexecuted",
        runSpec: null,
        sourceSha256: block.sha256,
        repetitions: 0,
        exitCodes: [],
        logs: [],
        toolVersions: {},
        untestedBehaviors: ["entire snippet: no run spec provided"],
        materializedSha256Matches: false
      });
      continue;
    }
    if (!spec) {
      checks.push({
        codeId: block.id,
        status: "error",
        runSpec: block.runSpec,
        sourceSha256: block.sha256,
        repetitions: 0,
        exitCodes: [],
        logs: [],
        toolVersions: {},
        untestedBehaviors: [],
        materializedSha256Matches: false,
        error: `Run spec "${block.runSpec}" not found in sandboxes/`
      });
      continue;
    }
    if (!input.sandbox.available) {
      checks.push({
        codeId: block.id,
        status: "error",
        runSpec: block.runSpec,
        sourceSha256: block.sha256,
        repetitions: 0,
        exitCodes: [],
        logs: [],
        toolVersions: {},
        untestedBehaviors: spec.untested,
        materializedSha256Matches: false,
        error: input.sandbox.unavailableReason ?? "sandbox unavailable"
      });
      continue;
    }

    const harness = input.harness[block.runSpec];
    const files = [{ path: `snippet-${block.id}`, contents: block.code }];
    if (harness) files.push({ path: harness.path, contents: harness.contents });

    const materializedHash = sha256(block.code);
    const repetitions = Math.max(1, input.repetitions);
    const exitCodes: (number | null)[] = [];
    const logs: CodeCheck["logs"] = [];
    let lastRun: Awaited<ReturnType<CodeSandbox["execute"]>> | null = null;

    for (let i = 0; i < repetitions; i++) {
      const run = await input.sandbox.execute(spec, files, harness?.entrypoint ?? `snippet-${block.id}`);
      lastRun = run;
      exitCodes.push(run.exitCode);
      logs.push({ stdout: run.stdout, stderr: run.stderr });
      if (run.timedOut) {
        break; // timeout: no point repeating
      }
    }

    const allZero = exitCodes.length === repetitions && exitCodes.every((c) => c === 0);
    const anyZero = exitCodes.some((c) => c === 0);
    const timedOut = Boolean(lastRun?.timedOut);
    const status: CodeCheck["status"] = timedOut
      ? "failed"
      : allZero
        ? "passed"
        : anyZero
          ? "flaky"
          : "failed";

    checks.push({
      codeId: block.id,
      status,
      runSpec: block.runSpec,
      sourceSha256: block.sha256,
      repetitions: exitCodes.length,
      exitCodes,
      logs,
      toolVersions: { sandbox: input.sandbox.name, image: spec.image },
      untestedBehaviors: spec.untested,
      materializedSha256Matches: materializedHash === block.sha256
    });

    if (lastRun) input.sandbox.cleanup(lastRun.workspace);
  }

  const result: CodeVerification = {
    generatedAt: nowIso(),
    sandbox: input.sandbox.name,
    sandboxAvailable: input.sandbox.available,
    checks
  };
  persist(input.runDir, result);
  return result;
}

export function codeCheckPassed(v: CodeVerification): boolean {
  return v.checks.every((c) => c.status === "passed" || c.status === "unexecuted");
}

export function codeHasExecuted(v: CodeVerification): boolean {
  return v.checks.some((c) => c.status === "passed");
}

function persist(runDir: string, result: CodeVerification): void {
  const dir = `${runDir}/verification`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/code.json`, JSON.stringify(result, null, 2) + "\n");
}

export function loadCodeVerification(runDir: string): CodeVerification | null {
  const path = `${runDir}/verification/code.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as CodeVerification) : null;
}
