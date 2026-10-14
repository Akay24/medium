# CLAUDE.md — project rules for working in this repository

## What this project is

`article-pipeline`: a local-first TypeScript CLI that produces reviewed,
verified article packages for **manual** Medium publication. No Medium API
integration. No auto-publishing. No web UI.

## Ground rules

1. **Never fabricate** URLs, citations, quotations, benchmarks, test output,
   personal anecdotes, or claims of execution.
2. **"Verified" means a verifier produced a persisted artifact** under
   `runs/<slug>/verification/`. LLM opinion is not verification; semantic
   source support is always stored with the `model_assessed_support` label.
3. Every LLM stage returns structured output validated with Zod
   (`src/stages/schemas.ts` / stage-local schemas). On invalid output, retry
   `config.retries.llmInvalidOutput` times including validation errors, then
   fail clearly. Never substitute silent defaults.
4. Stage artifacts are versioned: `runs/<slug>/<stage>/v<N>/`. Never overwrite
   an existing artifact; bump the version or require `--force`.
5. Human approval gates separate stages by default. `--auto` bypasses only
   the prompts — never validation, SSRF checks, or sandbox safety.
6. Keep prompts as versioned files under `prompts/` (see
   `prompts/master-editorial-prompt.md` for the 11-section review-package
   structure). Do not inline prompts in source.
7. Model identifiers live in `pipeline.config.yml` (`models.*` /
   `defaults.model`), never hardcoded in stage logic.
8. Secrets come from env vars only; `src/run/log.ts#redact` strips them from
   logs and artifacts. Never log keys or prompt/response payloads.
9. The trust boundary is `src/verifiers/`: deterministic checks (fetch
   evidence, code execution, diagram renders, consistency rules) decide
   statuses; `src/stages/qa.ts` derives final status from those results, not
   from the LLM.
10. Security invariants — do not weaken:
    - `src/util/safeFetch.ts`: SSRF blocklist (scheme, private/link-local/
      reserved IPs, redirect re-checks, DNS resolution), redirect/size/
      timeout/content-type limits, optional domain allowlist.
    - `src/sandbox/`: no privileged mode, no docker socket, read-only rootfs,
      dropped caps, `no-new-privileges`, cpu/mem/pids/time limits, no network
      by default, exact snippet bytes hash-compared, cleanup after runs.
    - Model-generated text is data, never executed on the host.

## Commands

```sh
pnpm typecheck   # tsc strict, must pass before any commit
pnpm test        # vitest, 71 tests
pnpm build       # tsc -> dist/
pnpm pipeline …  # init | run | status | verify | export (see README)
```

## Conventions

- ESM (`"type": "module"`); use `.js` extensions in relative imports.
- Strict TypeScript with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
- Errors are explicit: fail loudly with helpful messages and nonzero exit
  codes (`src/cli.ts#fail`); never swallow.
- Tests live in `tests/unit/`; mocked providers (`src/llm/mock.ts`,
  `src/sandbox/fake.ts`) keep tests offline. Do not add tests that require
  network or real API keys to the default suite.

## Editorial assets

`prompts/` files marked "Created by the article-pipeline scaffolding" are
reconstructions/placeholder because the original editorial assets were not in
the repository. Replace them with the real editorial prompts when supplied;
keep the 11-section review-package structure.
