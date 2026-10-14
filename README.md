# article-pipeline

A reliable, local-first TypeScript CLI that turns a topic request into a
researched, illustrated, quality-reviewed technical article package — ready for
**manual publication on Medium**. It does not publish; it reduces repetitive
writing work while making source checks, code execution, diagrams, and review
status auditable.

## Prerequisites

- Node.js 22+ (developed and tested on Node 24)
- pnpm 10+
- Docker Engine (optional, only needed for code verification; without it code
  stays `unexecuted` and code checks report `error` with the reason)
- `@mermaid-js/mermaid-cli` (`mmdc`) on PATH (optional, only for diagram
  rendering; without it diagrams stay `conceptual` with the reason recorded)
- `ANTHROPIC_API_KEY` in the environment (only for LLM stages; verifiers and
  manual research work without it)

## Setup

```sh
pnpm install
cp .env.example .env   # fill in locally; .env is gitignored
pnpm build
pnpm test
```

## Commands

```sh
pnpm pipeline init <slug> --request <path>   # validate slug/request, create manifest
pnpm pipeline run <slug> [--from S] [--to S] [--auto] [--force]
pnpm pipeline status <slug>
pnpm pipeline verify <slug> [--only sources|code|diagrams|consistency]
pnpm pipeline export <slug> [--force]
```

- `init` refuses to overwrite an existing run.
- `run` executes stages in dependency order (`research → outline → draft →
  visuals → metadata → qa`) and pauses at human approval gates unless `--auto`.
  `--auto` never bypasses validation, safety checks, or verification.
- Re-running a stage with `--force` writes a **new version** under
  `runs/<slug>/<stage>/v<N>/`; existing artifacts are never overwritten.
- `status` reports stage states, versions, approvals, verifier state, blockers.
- `verify` runs deterministic verifiers only — it never asks the LLM to
  rewrite content.
- `export` is blocked by failed mandatory checks; `--force` produces a package
  visibly marked `UNVERIFIED` (see `UNVERIFIED.txt` in the package) and lists
  remaining blockers. A forced export never turns a failed check into a pass.

## Pipeline configuration

`pipeline.config.yml` is schema-validated on load. Configure per-stage model
identifiers (no model names are hardcoded in stage logic), retry limits,
Docker sandbox limits, research fetch limits and domain allowlist, image
provider mode (`brief-only` by default), Medium platform limits, phrase
warning rules, and export policy.

**Medium platform limits carry verification metadata** (`lastVerifiedAt`,
`sourceUrl`, `unverified`). The shipped values are unverified placeholders —
confirm against help.medium.com and update, or they will surface as warnings.

Secrets come from the environment only (`.env` is gitignored, `.env.example`
contains placeholder names). A redaction layer strips secret-looking values
from run logs and artifacts.

## Safety boundaries

- **No fabrication:** claim provenance is explicit (`doc-fact` / `derived` /
  `opinion` with source IDs). Claim markers like `<!-- claim:c12 -->` link
  article sentences to research claims.
- **"Verified" means a verifier produced a persisted artifact.** Semantic
  source support is `model_assessed_support` — labeled LLM judgment, never
  deterministic proof. Fabricated evidence quotes are rejected.
- **SSRF defenses** in the source fetcher: HTTP/HTTPS only, private /
  link-local / reserved IP blocking (including redirect re-checks and DNS
  resolution), redirect/size/timeout/content-type limits, configurable domain
  allowlist. Fetched pages are treated as data, never instructions.
- **Sandboxed code execution:** article code with a run spec
  (```ts run=redis-basic```) executes in a throwaway Docker container — no
  privileged mode, no docker socket, read-only rootfs, dropped capabilities,
  `no-new-privileges`, cpu/mem/pids/time limits, no network by default, exact
  snippet bytes mounted read-only and hash-compared. Model text never reaches
  a host shell. Code without a run spec is labeled `unexecuted`, never run.
  Successful execution proves only the assertions and environment tested;
  untested behaviors are recorded.
- **Diagrams:** a successful Mermaid render proves renderability, not factual
  truth. Node labels are cross-checked against article terminology (warnings).
- **Editorial review is separated:** QA output keeps deterministic verifier
  results, LLM editorial review (explicitly labeled), and human review items
  apart; final status is derived from explicit rules.

## Run layout

```
runs/<slug>/
├── request.md          # copied at init
├── manifest.json       # stage versions/statuses/inputs/outputs/approvals (hashed)
├── log.jsonl           # structured events; secrets redacted
├── research/v1/…       # stage outputs, versioned, never overwritten
├── outline/v1/ draft/v1/ visuals/v1/ metadata/v1/ qa/v1/
├── verification/       # sources.json, code.json, diagrams.json, consistency.json
└── package/            # export output (see below)
```

Changing upstream inputs marks downstream stages **stale** (hash comparison in
the manifest).

## Export package

```
runs/<slug>/package/
├── article.md                # clean, claim markers stripped
├── article.html              # best-effort local conversion for review
├── source/article-with-markers.md
├── code/ diagrams/ logs/     # exact tested code, rendered diagrams, logs
├── metadata.json
├── references.md             # source fetch status + model-assessed support
├── verification-summary.json
├── QA.md  REMAINING_ACTIONS.md  review-package.md
└── UNVERIFIED.txt            # present only on --force exports with failed checks
```

## Testing

```sh
pnpm test        # 71 unit tests: config, manifest/versioning, SSRF fetch,
                 # source/code/diagram/consistency verifiers, draft parsing,
                 # export blocking/force, CLI smoke, secret redaction
```

Negative paths covered: invalid LLM output after retries, dead links, blocked
redirects into private IPs, contradicting pages, missing claim/source IDs,
failing/flaky/timing-out code, Mermaid syntax errors, placeholders, export
blocking, forced export marking, no-overwrite, stale marking, secret
redaction. External LLM calls are mocked; real Docker execution is exercised
only where Docker is available.

## Known limitations

- Docker and mermaid-cli are absent in the development environment used to
  build this repo: code verification there reports `error (sandbox
  unavailable)` and diagrams stay `conceptual`; both degrade with explicit
  reasons and block export (as designed).
- Medium publishing is intentionally out of scope: export files only.
- LLM stages require `ANTHROPIC_API_KEY`; the pipeline fails clearly without it.
