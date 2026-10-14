import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
import { writeFileSync, rmSync } from "node:fs";

const CLI = join(HERE, "../../src/cli.ts");
const ROOT = join(HERE, "../..");

function cli(args: string[]): string {
  return execFileSync("npx", ["tsx", CLI, ...args], { cwd: ROOT, encoding: "utf8" });
}

function cliFails(args: string[]): string {
  try {
    execFileSync("npx", ["tsx", CLI, ...args], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    throw new Error("expected nonzero exit");
  } catch (err) {
    const e = err as { status?: number; stderr?: string };
    if (e.status === undefined) throw err;
    return e.stderr ?? "";
  }
}

const SLUG = "cli-smoke";

beforeEach(() => {
  rmSync(join(ROOT, "runs", SLUG), { recursive: true, force: true });
});

describe("CLI", () => {
  it("init + status roundtrip", () => {
    const req = join("/tmp/opencode", `${SLUG}-request.md`);
    writeFileSync(req, "# smoke request\nbody");
    const out = cli(["init", SLUG, "--request", req]);
    expect(out).toContain("Initialized");
    const status = cli(["status", SLUG]);
    expect(status).toContain("Run: cli-smoke");
    expect(status).toContain("pending");
    expect(status).toContain("Blockers:");
  });

  it("rejects invalid stage names with a helpful message and nonzero exit", () => {
    const err = cliFails(["run", SLUG, "--from", "bogus"]);
    expect(err).toContain("Unknown stage");
  });

  it("status fails for a run that does not exist", () => {
    const err = cliFails(["status", "no-such-run-xyz"]);
    expect(err).toContain("not found");
  });

  it("verify rejects invalid --only values", () => {
    cli(["init", SLUG, "--request", createReq()]);
    const err = cliFails(["verify", SLUG, "--only", "vibes"]);
    expect(err).toContain("Invalid --only");
  });
});

function createReq(): string {
  const p = join("/tmp/opencode", `${SLUG}-request-2.md`);
  writeFileSync(p, "x");
  return p;
}
