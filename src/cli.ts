#!/usr/bin/env node
import { Command, InvalidArgumentError } from "commander";
import { initRun, runPipeline } from "./commands/run.js";
import { statusReport, formatStatus } from "./commands/status.js";
import { verifyCommand } from "./commands/verify.js";
import { exportRun } from "./commands/export.js";
import { STAGE_ORDER } from "./config/schema.js";

function parseStage(value: string): string {
  if (!STAGE_ORDER.includes(value as (typeof STAGE_ORDER)[number])) {
    throw new InvalidArgumentError(
      `Unknown stage "${value}". Valid stages in dependency order: ${STAGE_ORDER.join(", ")}`
    );
  }
  return value;
}

const program = new Command();

program
  .name("article-pipeline")
  .description("Local-first article pipeline: research, draft, verify, and package technical articles for manual Medium publication.")
  .version("0.1.0");

program
  .command("init")
  .description("Create a run: validate slug and request file, copy request, create manifest.")
  .argument("<slug>")
  .requiredOption("--request <path>", "path to the article request markdown file")
  .action((slug: string, opts: { request: string }) => {
    try {
      const { runDir } = initRun(slug, opts.request);
      process.stdout.write(`Initialized run "${slug}" at ${runDir}\n`);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("run")
  .description("Execute stages in dependency order; pauses at human approval gates unless --auto.")
  .argument("<slug>")
  .option("--from <stage>", "start stage", parseStage)
  .option("--to <stage>", "end stage", parseStage)
  .option("--auto", "bypass approval prompts (never bypasses validation or safety checks)", false)
  .option("--force", "re-run stages even if they already passed (writes a new version, never overwrites)", false)
  .action(async (slug: string, opts: { from?: string; to?: string; auto: boolean; force: boolean }) => {
    try {
      await runPipeline(slug, opts);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("status")
  .description("Show stage state, versions, approvals, verifier state, and blockers.")
  .argument("<slug>")
  .action((slug: string) => {
    try {
      process.stdout.write(formatStatus(statusReport(slug)) + "\n");
    } catch (err) {
      fail(err);
    }
  });

program
  .command("verify")
  .description("Run deterministic verifiers only (no LLM rewriting).")
  .argument("<slug>")
  .option("--only <check>", "restrict to one verifier: sources|code|diagrams|consistency")
  .action(async (slug: string, opts: { only?: string }) => {
    try {
      await verifyCommand(slug, opts.only);
    } catch (err) {
      fail(err);
    }
  });

program
  .command("export")
  .description("Create the review package; blocked by failed mandatory checks unless --force.")
  .argument("<slug>")
  .option("--force", "export even with failed checks; package is visibly marked UNVERIFIED", false)
  .action(async (slug: string, opts: { force: boolean }) => {
    try {
      const result = await exportRun(slug, opts.force);
      process.stdout.write(
        `Package written to ${result.packageDir}${result.forced ? " (FORCED — UNVERIFIED, see UNVERIFIED.txt)" : ""}\n`
      );
    } catch (err) {
      fail(err);
    }
  });

function fail(err: unknown): never {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
}

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
});
