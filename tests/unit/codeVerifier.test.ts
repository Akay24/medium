import { describe, it, expect } from "vitest";
import { verifyCode, type CodeVerifierInput } from "../../src/verifiers/code.js";
import { FakeSandbox } from "../../src/sandbox/fake.js";
import { loadSandboxSpec, type SandboxSpec } from "../../src/sandbox/spec.js";
import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256 } from "../../src/util/hash.js";

function testDir(name: string): string {
  const dir = join(tmpdir(), `code-verify-${name}-${Date.now()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const spec: SandboxSpec = {
  id: "test-spec",
  image: "node:22",
  setup: [],
  run: "node snippet-test-spec",
  timeoutMs: 10000,
  memoryMb: 256,
  cpus: 0.5,
  pidsLimit: 64,
  maxOutputBytes: 100_000,
  networkEnabled: false,
  services: [],
  asserts: "exits zero",
  untested: ["concurrency"],
  cleanup: "always"
};

function makeInput(runDir: string, blocks: CodeVerifierInput["codeBlocks"], overrides?: Partial<CodeVerifierInput>): CodeVerifierInput {
  return {
    runDir,
    codeBlocks: blocks,
    specs: new Map([["test-spec", spec]]),
    sandbox: new FakeSandbox(),
    harness: {
      "test-spec": {
        path: "harness.mjs",
        contents: 'console.log("harness runs separately from the snippet");',
        entrypoint: "harness.mjs"
      }
    },
    repetitions: 3,
    ...overrides
  };
}

describe("code verifier", () => {
  it("passes a snippet whose assertions hold, records logs and hash match", async () => {
    const runDir = testDir("pass");
    const code = 'const x = 40 + 2;\nif (x !== 42) { throw new Error("bad math"); }\nconsole.log("math ok");';
    const result = await verifyCode(
      makeInput(runDir, [{ id: "test-spec", language: "ts", runSpec: "test-spec", code, sha256: sha256(code) }])
    );
    expect(result.checks[0]?.status).toBe("passed");
    expect(result.checks[0]?.repetitions).toBe(3);
    expect(result.checks[0]?.materializedSha256Matches).toBe(true);
    expect(result.checks[0]?.logs[0]?.stdout).toContain("math ok");
    expect(readFileSync(`${runDir}/verification/code.json`, "utf8")).toContain("passed");
  });

  it("fails a snippet whose assertion fails", async () => {
    const runDir = testDir("fail");
    const code = 'throw new Error("assertion failed");';
    const result = await verifyCode(
      makeInput(runDir, [{ id: "test-spec", language: "ts", runSpec: "test-spec", code, sha256: sha256(code) }])
    );
    expect(result.checks[0]?.status).toBe("failed");
    expect(result.checks[0]?.logs[0]?.stderr).toContain("assertion failed");
  });

  it("labels code without a run spec as unexecuted (never runs it)", async () => {
    const runDir = testDir("unexec");
    const result = await verifyCode(
      makeInput(runDir, [{ id: "no-spec", language: "ts", runSpec: null, code: "process.exit(1)", sha256: sha256("x") }])
    );
    expect(result.checks[0]?.status).toBe("unexecuted");
    expect(result.checks[0]?.repetitions).toBe(0);
  });

  it("errors when a referenced run spec is missing", async () => {
    const runDir = testDir("nospec");
    const result = await verifyCode(
      makeInput(runDir, [{ id: "b1", language: "ts", runSpec: "does-not-exist", code: "1", sha256: sha256("1") }])
    );
    expect(result.checks[0]?.status).toBe("error");
    expect(result.checks[0]?.error).toContain("not found");
  });

  it("reports flaky outcomes when repetition results differ", async () => {
    const runDir = testDir("flaky");
    const dir = tmpdir();
    const sandbox = new FakeSandbox();
    // Deterministic spec.run but flip via an env-independent trick: alternate file content
    // between repetitions using a custom sandbox wrapper.
    const flakySandbox = Object.create(sandbox) as FakeSandbox;
    let call = 0;
    (flakySandbox as unknown as { execute: CodeVerifierInput["sandbox"]["execute"] }).execute = async (specArg, files, entrypoint) => {
      call++;
      const mutating = files.map((f) =>
        f.path === "snippet-test-spec"
          ? { path: f.path, contents: call === 2 ? "process.exit(3);" : 'console.log("ok");' }
          : f
      );
      return sandbox.execute(specArg, mutating, entrypoint);
    };
    const code = 'console.log("ok");';
    const result = await verifyCode(
      makeInput(runDir, [{ id: "test-spec", language: "ts", runSpec: "test-spec", code, sha256: sha256(code) }], {
        sandbox: flakySandbox
      })
    );
    expect(result.checks[0]?.status).toBe("flaky");
    expect(result.checks[0]?.exitCodes).toContain(3);
  });

  it("flags timeout as failure", async () => {
    const runDir = testDir("timeout");
    const code = "while (true) {}";
    const result = await verifyCode(
      makeInput(runDir, [{ id: "test-spec", language: "ts", runSpec: "test-spec", code, sha256: sha256(code) }], {
        repetitions: 1
      })
    );
    expect(result.checks[0]?.status).toBe("failed");
  });

  it("reports error when sandbox is unavailable (Docker absent)", async () => {
    const runDir = testDir("nosandbox");
    const unavailable = { name: "docker", available: false, unavailableReason: "Docker not installed", execute: async () => { throw new Error("no"); }, cleanup: () => {} };
    const code = "console.log(1)";
    const result = await verifyCode(
      makeInput(runDir, [{ id: "test-spec", language: "ts", runSpec: "test-spec", code, sha256: sha256(code) }], {
        sandbox: unavailable as unknown as CodeVerifierInput["sandbox"]
      })
    );
    expect(result.checks[0]?.status).toBe("error");
    expect(result.checks[0]?.error).toContain("Docker not installed");
  });

  it("loads the shipped redis-basic spec", () => {
    const loaded = loadSandboxSpec("sandboxes/redis-basic.yml");
    expect(loaded.id).toBe("redis-basic");
    expect(loaded.networkEnabled).toBe(false);
    expect(loaded.image).toContain("node:22");
  });
});
