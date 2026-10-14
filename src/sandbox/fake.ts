import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import type { SandboxSpec } from "./spec.js";
import type { SandboxRun, CodeSandbox } from "./docker.js";

/**
 * Deterministic in-process sandbox used by tests and environments without Docker.
 * Interprets a tiny harness protocol: the spec's `run` command is
 * `node <entrypoint>` and files are executed with plain node. Only enabled
 * when explicitly selected (providers.sandbox=fake) — never a silent fallback.
 */
export class FakeSandbox implements CodeSandbox {
  readonly name = "fake";
  public available = true;

  async execute(
    spec: SandboxSpec,
    files: { path: string; contents: string }[],
    entrypoint: string
  ): Promise<SandboxRun> {
    const started = Date.now();
    const workspace = mkdtempSync(join(tmpdir(), "pipeline-fake-"));
    for (const file of files) writeFileSync(join(workspace, file.path), file.contents);
    const [cmd, ...args] = spec.run.split(" ").filter(Boolean);
    const result = await new Promise<{ stdout: string; stderr: string; code: number | null; timedOut: boolean }>((resolve) => {
      execFile(
        cmd === "node" ? process.execPath : (cmd as string),
        args.map((a) => (a === entrypoint ? join(workspace, entrypoint) : join(workspace, a))),
        { cwd: workspace, timeout: spec.timeoutMs, maxBuffer: spec.maxOutputBytes, killSignal: "SIGKILL" },
        (err?: Error | null, stdout?: string | Buffer, stderr?: string | Buffer) => {
          const errCode = err !== null && typeof (err as unknown as { code?: unknown }).code === "number" ? (err as unknown as { code: number }).code : null;
          const killed = Boolean((err as unknown as { killed?: boolean } | null | undefined)?.killed);
          resolve({
            stdout: stdout ? stdout.toString() : "",
            stderr: stderr && stderr.toString() ? stderr.toString() : err ? String(err.message ?? err) : "",
            code: errCode ?? (err ? 1 : 0),
            timedOut: killed
          });
        }
      );
    });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.code,
      timedOut: result.timedOut,
      durationMs: Date.now() - started,
      truncated: false,
      workspace
    };
  }

  cleanup(workspace: string): void {
    rmSync(workspace, { recursive: true, force: true });
  }
}
