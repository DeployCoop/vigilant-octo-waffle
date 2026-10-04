# Vigilant Octo Waffle — Repository Improvements Implementation Plan

**Status:** Draft for review (2026-10-03)
**Companion to:** `authz_implementation.md` (Implemented — PRs #21–#27) and the CI
rollout (PR #28). This plan covers the engineering-health backlog identified in
two review passes over the repository on 2026-10-03: one before CI existed,
one after it landed.
**Reviewers:** please answer the questions in **§16** inline, the same way the
authz plan was reviewed. Work begins from those answers.

---

## 1. Executive summary

The repository is in good shape where it matters most: strict TypeScript in
every package, ~84k LOC with zero TODO/FIXME rot, 245 automated tests
(162 orchestrator + 83 web) that now run in CI on every PR, branch protection
on `main`, and — as of the authz rollout — a complete per-principal
authorization model. Nothing in this plan is firefighting.

What remains is a set of structural risks and unfinished infrastructure that
will compound as the codebase grows:

1. **The shipped runtime is not the tested runtime** (Node 22 in the
   Dockerfile vs Node 24 in CI/dev, declared nowhere).
2. **Half the product — 164 bash scripts — has no static checking and no
   contract with its TypeScript mirror.** The orchestrator's managers are
   hand-maintained duplicates of the bash runners; drift is inevitable and
   currently undetectable.
3. **Operational state is volatile.** Background-task records live in an
   in-memory map; a web restart orphans them.
4. **Error handling is improvised per route** (77 ad-hoc `catch (err: any)`
   blocks, two incompatible error conventions).
5. **Complexity is concentrating** in a handful of very large files
   (a 3,079-line page component; three engine files over 1,500 lines).
6. **The newest infrastructure is unfinished**: CI exists but runs no lint
   (there is no lint config to run), no ShellCheck, no secret scanning, and
   dependency updates are manual.

The plan is organized as nine workstreams (§4–§12), sequenced as twelve
numbered steps in §13 (one step, WS6, is itself a short series of PRs). Most are small and independent; two (parity tests, task persistence)
carry real design weight and are specified in the most detail.

---

## 2. Current state — verified evidence

All figures measured against `main` on 2026-10-03, after PR #28 merged.

| Fact | Evidence |
| --- | --- |
| CI | `.github/workflows/ci.yml`: 2 jobs (tests+typecheck, production build); branch protection requires both, strict mode on |
| Tests | Orchestrator 162 (`node --test`), web 83 (vitest), ink **0**; 25 test files |
| Bash surface | 164 scripts under `src/`; no ShellCheck, no test harness |
| API surface | 56 route files under `apps/web/src/app/api`; 77 `catch (err: any)` blocks in routes |
| Largest files | `apps/web/src/app/cluster/page.tsx` 3,079 · `packages/orchestrator/src/k3s.ts` 1,846 · `waffle.ts` 1,777 · `antigravity.ts` 1,516 · `apps/web/src/app/waffle/page.tsx` 1,465 |
| Runtime versions | CI/dev: Node 24 · Dockerfile: `node:22-bookworm-slim` (floating tag, no digest) · no `engines` in any `package.json`, no `.nvmrc` |
| Task state | `processManager` + `TaskRun` in `packages/orchestrator/src/executor.ts` — module-level in-memory map (README already flags this) |
| Lint | Root `pnpm lint` → `next lint` in apps/web; **no ESLint/Biome config exists anywhere** |
| Dependencies | No Dependabot/Renovate; no `.github/` config beyond the workflow |
| Releases | 0 git tags, no changelog |
| Secrets hygiene | Tracked `init/**` secret manifests are `${THIS_*}` templates (verified clean); `.secrets/` and generated `.env` files are gitignored but unscanned |
| Docs defects | 2 links point at `file:///home/thoth/...` (README.md, ARCHITECTURE.md) — broken for every other reader |
| Enabler | `node:sqlite` (`DatabaseSync`) works flag-free on Node 24.20 — relevant to §8 |

---

## 3. Goals, non-goals, principles

**Goals**

- Every layer of the product (bash, orchestrator, web, ink) gets the same
  treatment in CI: static checks + tests, enforced by branch protection.
- One declared runtime version, identical in dev, CI, and the shipped image.
- Behavioral parity between the bash and TypeScript engines becomes a tested
  property, not a maintainer's intention.
- Background work survives a web-process restart.
- Route error responses converge on one envelope; operational logs become
  structured and greppable.
- Large-file growth is reversed where it concentrates risk, without behavior
  change.

**Non-goals**

- No feature work. (Authz v2 items are catalogued in §12 for sequencing, but
  their design lives in `authz_implementation.md` and the ROADMAP.)
- No rewrite of the bash layer or of the templating model (`THIS_*` env
  templating, yq, envsubst stay).
- No multi-instance/HA web tier. Persistence in §8 targets single-host
  restart resilience, which matches the local-first model.
- No framework migrations (Next.js, Ink, pnpm all stay).

**Principles** (carried over from the authz rollout — they worked)

- Small, independently mergeable PRs, each green on its own.
- Anything CI should enforce gets a meta-test or a config gate, not a
  convention in a README.
- Fail closed, verify against the real artifact (the CI PR proves the CI;
  the parity PR proves parity on real fixtures).
- Behavior-preserving refactors land separately from behavior changes.

---

## 4. WS1 — Runtime version alignment & dependency automation

### 4.1 One Node version, declared once, used everywhere

**Problem.** CI and local development run Node 24; the shipped Docker image
runs Node 22 (`FROM node:22-bookworm-slim`, floating tag). No `package.json`
declares `engines`; there is no `.nvmrc`. The artifact that ships is not the
runtime that is tested — a class of bug CI cannot catch by construction.

**Proposal.**

1. Standardize on **Node 24** (current LTS line, already what CI/dev use; it
   is also the floor for §8's `node:sqlite` approach). §16 Q1 confirms.
2. Encode it in every place that chooses a runtime:
   - `.nvmrc` (`24`) at the repo root.
   - `"engines": { "node": ">=24 <25" }` in all four `package.json` files
     (root, orchestrator, web, ink).
   - Dockerfile: `FROM node:24-bookworm-slim` **pinned by digest**
     (`node:24-bookworm-slim@sha256:…`), with the digest refreshed by
     Dependabot's docker ecosystem (§4.2).
   - CI already uses 24; switch it to `node-version-file: .nvmrc` so the file
     is the single source of truth going forward.
3. Verify: `pnpm build` + full test suites + `docker build` + a container
   smoke check (`node --version` inside the image reports 24.x).

**Risk.** Low. Next.js 15 and all current dependencies support Node 24; the
web production build in the container is the verification gate.

### 4.2 Dependabot

**Proposal.** `.github/dependabot.yml` covering:

- `npm` ecosystem at `/` (pnpm workspaces are understood via the lockfile),
  weekly, grouped minor/patch bumps for the Next/React and dev-tooling
  families to limit PR volume.
- `docker` ecosystem at `/` (base-image digest refresh for §4.1).
- `github-actions` ecosystem (action version bumps).

Every Dependabot PR runs the full CI suite; branch protection does the rest.
Auto-merge is **not** enabled initially (§16 Q9).

---

## 5. WS2 — CI hardening: lint, ShellCheck, secret scanning

CI exists; this workstream gives it the remaining three standard gates. Each
lands as its own job first in *report-only* mode where noted, then becomes a
required check (§14).

### 5.1 A real lint config

**Problem.** `pnpm lint` resolves to `next lint` in apps/web, but there is
no ESLint or Biome configuration anywhere in the repository — the script has
nothing to run, and `next lint` itself is deprecated upstream. The
orchestrator and ink packages have no lint script at all.

**Proposal.**

1. Adopt **ESLint flat config** (`eslint.config.mjs`) at the repo root
   (§16 Q2 covers the ESLint-vs-Biome choice) with:
   - `typescript-eslint` recommended rules for all TS/TSX,
   - `eslint-config-next` for apps/web,
   - a small set of high-signal rules beyond the presets, notably
     `@typescript-eslint/no-explicit-any` as a warning (error in new code is
     unrealistic across 77 existing catch sites; §7 burns those down).
2. `lint` scripts in every package delegating to the root config; root
   `pnpm lint` already fans out.
3. CI job `lint` running `pnpm lint`. Existing violations are fixed in the
   same PR where mechanical, or baselined with scoped `eslint-disable`
   comments carrying a tracking note — no silent global suppressions.

**Risk.** The initial violation count is unknown; the PR may need one
`--fix` sweep commit. Rules are chosen to be autofix-heavy.

### 5.2 ShellCheck for the bash layer

**Problem.** 164 scripts under `src/` implement cluster lifecycle,
templating, GitOps runners, and secret generation. They receive no static
checking of any kind. ShellCheck catches the classic shell failure classes
(unquoted expansions, word splitting, masked exit codes) that code review
reliably misses.

**Proposal.**

1. Run ShellCheck (via the `shellcheck` binary in a dedicated CI job,
   `--severity=warning`, `src/**/*.bash src/**/*.sh ./up` and extensionless
   scripts with shell shebangs).
2. **Baseline first**: land the job in report-only mode with the full finding
   list attached to the PR, fix the error-severity findings (likely few),
   and make warning-severity the gate. Per-line `# shellcheck disable=SCxxxx`
   with a one-line justification is the only permitted suppression.
3. Follow-up burn-down of warning findings proceeds file-by-file in later
   PRs; the gate prevents new debt.

§16 Q3 sets the initial gate severity.

### 5.3 Secret scanning (gitleaks)

**Problem.** The tracked tree is clean (verified: `init/**` secret manifests
are `${THIS_*}` templates), but the working model involves generated `.env`
files, `.secrets/` directories, localStorage tokens, and a `.vow/` runtime
directory — exactly the artifacts that get committed by accident eventually.
Nothing would catch it.

**Proposal.** A CI job running `gitleaks` (pinned action/container version)
over the full history on push to `main` and over the PR diff on pull
requests, failing the check on any finding. Add a repo `.gitleaks.toml`
allowlist only if a fixture trips it (test fixtures with throwaway token
shapes are the expected case — allowlist by path + rule, never by value
pattern alone).

---

## 6. WS3 — Bash ↔ TypeScript parity contract tests

**This is the plan's deepest workstream.** It addresses the repository's
largest structural risk.

### 6.1 Problem

The product has two engines for the same operations:

- **Bash**: `src/*.bash` runners (`argoRunner.bash`, `fluxRunner.bash`, the
  dpkg-style stage scripts, `src/mk*.sh`) driven by `THIS_*` env templating.
- **TypeScript**: `packages/orchestrator` managers (`argocd.ts`, the flux
  module, `waffle.ts`'s `prepareAppManifest`, etc.), documented in
  ARCHITECTURE.md as "mirrors" of the bash layer.

The mirrors are maintained by hand. There is no test, fixture, or generated
artifact that compares their outputs, so drift is silent: a manifest field
changed in the bash runner does not appear in the dashboard's synthesized
manifests, and nobody finds out until a deploy differs depending on which
surface started it.

### 6.2 Proposal: golden-fixture contract tests

For each mirrored pair, define a **fixture**: a complete `THIS_*`
environment + app definition, plus the **golden output** (the synthesized
Kubernetes manifests / kustomization, normalized). A contract test runs
*both* engines against the fixture and asserts byte-equality (post
normalization) with each other and with the golden file.

- **Normalization**: parse YAML, sort keys, strip volatile fields
  (timestamps, generated names with random suffixes — generators must accept
  a seeded/fixed suffix under test, see 6.3), then compare canonical JSON.
- **Fixture corpus** lives in `packages/orchestrator/src/__tests__/fixtures/parity/`
  (env file, app values, expected output per engine pair), seeded from the
  repository's own example apps (`src/examples/`, the Helm example chart) so
  fixtures represent real configurations, not synthetic minima.
- **Order of pairs** (§16 Q4 may re-rank):
  1. App manifest synthesis (`prepareAppManifest` vs the bash templating
     path) — highest traffic, pure function, easiest to fixture.
  2. ArgoCD application generation (`argocd.ts` vs `argoRunner.bash`).
  3. Flux kustomization generation (flux module vs `fluxRunner.bash`).
- The bash side runs in-test via `execFile` against the repo's own scripts
  with the fixture env, in a temp dir — the same stub-binary technique the
  storage tests proved out in PR #28 for any cluster-facing commands.

### 6.3 Supporting change: deterministic generation under test

Where either engine injects randomness (name suffixes, generated secrets,
timestamps — e.g. `mksecret.sh`-style generation), the engines must accept
an injected fixed value under test (env override such as
`VOW_TEST_FIXED_SUFFIX` is acceptable; a proper options parameter in TS).
This is a small, behavior-preserving change per call site, done in the pair's
PR. *Production defaults do not change.*

### 6.4 Drift policy

Once a pair is covered, **a change to one engine without the other fails
CI** — that is the point. The golden file is regenerated by a documented
command (`pnpm --filter @vow/orchestrator test:parity:update`) and goldens
changes require the same review scrutiny as code. If a divergence is ever
*intentional*, the fixture splits per engine with a comment citing the
reason; intentional divergence without a fixture note is treated as drift.

### 6.5 What this does not do

It does not merge the engines or generate one from the other. A single
implementation (TS generating what bash consumes, or bash retired behind the
orchestrator) is a legitimate long-term direction, but it is a product
decision (§16 Q4 includes it as an option) and is out of scope here. Parity
tests are valuable under every end-state: they are the safety net that makes
a future consolidation possible.

**Effort:** L overall, sliced per pair (3 PRs). **Risk:** fixture design is
the work; the harness itself is small.

---

## 7. WS4 — API error envelope & structured logging

### 7.1 Problem

Route error handling is improvised. Across 56 route files there are 77
`catch (err: any)` blocks producing two incompatible conventions:

- HTTP error status with `{ error: string }` (most routes), and
- HTTP 200 with an error embedded in the payload (a minority, incl. some
  streaming/task endpoints), which clients must special-case.

Separately, the web tier's only structured log is the authz audit trail
(`.vow/audit.log`). Operational errors are `console.*` free text — not
timestamped consistently, not greppable by route or principal, and lost on
container restart.

### 7.2 Proposal

**One envelope.** All API error responses become:

```jsonc
{ "error": { "code": "string_code", "message": "human readable", "reason": "optional authz-style reason" } }
```

- `code` is a stable machine-readable string (`internal`, `bad_request`,
  `not_found`, or the authz `reason` vocabulary where one exists). The authz
  layer already returns `{ error, reason }` on denials; the envelope absorbs
  it as `{ error: { code: "forbidden", message, reason } }` — one breaking
  change to the authz deny shape, called out in §16 Q5, with the dashboard's
  fetch layer updated in the same PR.
- A single helper in `apps/web/src/lib/`: `routeError(err, { route, status? })`
  that classifies known error types (`AuthzError` → 401/403, `ZodError` →
  400, `AuthzInvariantError` → 409, else 500), logs (§7.3), and returns the
  envelope `NextResponse`.

**Migration.** Mechanical, route group by route group (apps, cluster, k8s,
system/misc), one PR per group, each verified by the route tests plus a new
**envelope meta-test** in the style of the authz coverage test: walk route
files and fail if a `catch` block returns a raw `NextResponse.json({ error: … })`
outside the helper. Client call sites that consumed 200-with-error payloads
are enumerated per group in that group's PR; the dashboard's fetch helpers
are updated to throw on `error` uniformly.

**Structured logging.** Introduce a tiny logger in `apps/web/src/lib/log.ts`
(JSON lines to stderr: `{ ts, level, route, principalId?, msg, err? }`),
used by `routeError` and the existing audit writer left as-is (audit ≠ logs:
audit is a product feature with its own reader API; logs are operational).
No new dependency — the format is deliberately boring. Container deployments
get logs via `docker logs`, as today, but now parseable.

**Risk.** The 200-with-error conversions are the only behavior changes;
each is listed explicitly in its PR. Dashboard consumers are all in-repo.

---

## 8. WS5 — Persistent background-task state

### 8.1 Problem

`processManager` (`packages/orchestrator/src/executor.ts`) tracks background
tasks (`TaskRun`: id, label, status, log tail, exit state) in a module-level
in-memory map. Consequences, already noted in the README:

- A web-process restart (deploy, crash, container recreate) **orphans every
  running and historical task**: the UI's Tasks view empties, log tails are
  lost, and a task that actually completed is indistinguishable from one that
  died with the server.
- The Tasks API and its polling UI have no recovery story at all.

Exec (PTY) sessions are also in-memory; §8.4 argues they should stay that way.

### 8.2 Proposal: SQLite under `.vow/`, via `node:sqlite`

- Store: `<projectRoot>/.vow/state.db`, opened by the orchestrator, using
  **`node:sqlite`** (`DatabaseSync`) — available flag-free on Node 24 (§4.1
  makes 24 the declared floor), so **zero new dependencies** and no native
  build. §16 Q6 covers the fallback (JSON-lines file store) if reviewers
  prefer avoiding an experimental API.
- Schema (v1, created idempotently; `PRAGMA journal_mode=WAL`):
  `tasks(id TEXT PK, label, kind, status, pid, started_at, ended_at,
  exit_code, log_tail TEXT, meta JSON)`. Log tails stay capped exactly as
  the in-memory implementation caps them today; full logs are out of scope.
- `processManager` keeps its in-memory cache for live tasks and writes
  through to SQLite on every state transition (start, log flush points,
  completion). Reads (`listTasks`, task detail) merge: live entries from
  memory, historical entries from the DB.
- **Startup reconciliation**: on boot, rows still marked `running` whose
  pid no longer exists are marked `interrupted` (new terminal status) with
  `ended_at` set — honest history instead of silent disappearance. If the
  pid exists (same host, process genuinely still running), the task is
  re-attached as read-only history; live log streaming for re-attached tasks
  is out of scope.
- `.vow/` is already gitignored and holds `authz.yaml` + `audit.log`;
  `state.db` joins them with mode `0600` on creation, consistent with the
  authz store.

### 8.3 Tests

Orchestrator tests against a temp-dir DB: persistence across a simulated
restart (new manager instance, same file), reconciliation of a dead pid
(spawn a short-lived child, kill the "server", reboot), interrupted
marking, log-tail cap parity with today's behavior. Existing task tests
must pass unchanged against the write-through implementation.

### 8.4 What stays in-memory, deliberately

PTY exec sessions and WebSocket streams hold live OS resources (file
descriptors, child processes) that cannot survive a restart in any design;
their state is *session* state, not *record* state. The plan persists
records (tasks) and leaves sessions ephemeral, documented as such in
ARCHITECTURE.md. If a PTY dies with the server, the client reconnect flow
already handles a fresh session.

**Effort:** M. **Risk:** `node:sqlite` is marked experimental (it prints no
warning in Node 24.20 in our verification, but the API could shift in a
future major — contained behind one module, `taskStore.ts`, so swapping
implementations is a one-file change).

---

## 9. WS6 — Complexity reduction in the largest files

### 9.1 Problem

| File | Lines | Why it matters |
| --- | --- | --- |
| `apps/web/src/app/cluster/page.tsx` | 3,079 | Every cluster feature edits the same client component; reviews are unwieldy, merge conflicts routine |
| `packages/orchestrator/src/k3s.ts` | 1,846 | Join/status/install/teardown in one module |
| `packages/orchestrator/src/waffle.ts` | 1,777 | Manifest synthesis + blueprint export + templating |
| `packages/orchestrator/src/antigravity.ts` | 1,516 | Gateway lifecycle + sync in one module |
| `apps/web/src/app/waffle/page.tsx` | 1,465 | Same page-component pattern as cluster |

### 9.2 Proposal — behavior-preserving decomposition only

- **Cluster page**: extract per-section components
  (`ClusterOverview`, `KindSection`, `K3sSection`, `NodesSection`,
  `JoinPanel`, …) into `apps/web/src/app/cluster/components/`, and shared
  state/polling into hooks (`useClusterStatus`, `useNodeActions`). The page
  becomes composition. Ability gating (PR #26) moves with the controls it
  gates — the client↔server ability consistency tests guard the permission
  mapping through the move.
- **Engine files**: split by sub-domain along the seams the modules already
  have (e.g. `k3s.ts` → `k3s/install.ts`, `k3s/status.ts`, `k3s/nodes.ts`
  with a barrel `k3s.ts` re-exporting, so **no import sites change**).
  Barrel-first means the split is reviewable as pure file motion.
- **Guardrails**: no logic edits inside a decomposition PR (any fix found
  en route gets its own PR); web changes gated on `next build` + the full
  vitest suite; engine changes on the orchestrator suite (+ parity fixtures
  from §6 where they exist by then — sequencing in §13 puts at least the
  manifest-synthesis pair first for exactly this reason).

**Effort:** M per file, one PR per file. **Risk:** low with the guardrails;
the failure mode to avoid is the "while I'm here" fix, which the PR template
for these should explicitly forbid.

---

## 10. WS7 — Ink CLI test suite

**Problem.** `apps/ink` is a full command surface (interactive TUI plus the
commander-based `vow` non-interactive commands, now including the `vow authz`
delegation) with **zero tests and no test script** — the only package in the
monorepo with neither.

**Proposal.**

1. Add `"test": "node --test dist/__tests__/*.test.js"` mirroring the
   orchestrator pattern (tests compile with the package's existing `tsc`).
2. Cover, in priority order:
   - **Command parsing & dispatch** for the non-interactive CLI (argv →
     command/flags), including the raw-args passthrough that `vow authz`
     depends on — a regression there breaks authz administration.
   - **Pure view-model logic** in the TUI (formatting, status mapping) —
     components render-tested with `ink-testing-library` only where a pure
     extraction is impractical (§16 Q7 sets the appetite).
   - One subprocess smoke test mirroring the orchestrator's authz CLI tests
     (which already cover the delegated binary end-to-end; here, the ink-side
     half).
3. Root `pnpm -r test` picks the suite up automatically; CI runs it via the
   existing filter list (add `@vow/ink` to the test job).

**Effort:** S–M. **Risk:** low; TUI components vary in testability, hence
the priority order (parsing first — highest value, easiest).

---

## 11. WS8 — Docs & release hygiene

Small, bundled, deliberately last:

1. Replace the two `file:///home/thoth/...` links (README.md,
   ARCHITECTURE.md) with repo-relative links.
2. **Tags + changelog**: adopt annotated tags (`vX.Y.Z`) per release and a
   `CHANGELOG.md` in Keep-a-Changelog format, seeded from the PR history
   (the authz rollout and CI are the first two entries under the initial
   tag). A release workflow that drafts GitHub Release notes from the
   changelog section is optional polish (§16 Q8).
3. Refresh CONTRIBUTING.md where the ground moved: CI expectations, branch
   protection, `allowBuilds` note for future native deps, and the
   scratch-copy workaround is *not* documented (it is a sandbox artifact,
   not a project property).

**Effort:** S.

---

## 12. WS9 — Authz v2 follow-ups (sequencing placeholder)

Design authority remains `authz_implementation.md` + the ROADMAP entries
written in PR #27. Catalogued here only so the sequence in §13 is complete:

1. **Audit log rotation / size caps** for `.vow/audit.log` (unbounded today).
2. **Kubeconfig-context scoped grants** (cut from authz v1 per §16 Q2 of
   that plan; the permission target shape already anticipates it).
3. **Session-cookie alternative** to localStorage tokens (ergonomics;
   touches the middleware deferral and the dashboard fetch interceptor).

Each gets its own mini-plan when picked up. §16 Q10 asks whether audit
rotation should jump the queue (it is the only item in this plan-adjacent
list with an unbounded-growth failure mode in production).

---

## 13. Sequencing — the PR map

Dependencies are few; the order below front-loads the cheap gates (they make
every later PR safer) and puts parity fixtures for manifest synthesis before
the `waffle.ts` decomposition that benefits from them.

| PR | Workstream | Scope | Depends on | Effort |
| --- | --- | --- | --- | --- |
| 0 | — | **This plan** (review + §16 answers) | — | — |
| 1 | WS1 | Node 24 alignment: `.nvmrc`, `engines`, Dockerfile + digest pin, CI `node-version-file` | — | S |
| 2 | WS1 | Dependabot (npm grouped, docker, github-actions) | PR 1 | S |
| 3 | WS2 | ESLint flat config + fixes/baseline, `lint` scripts, CI lint job | — | M |
| 4 | WS2 | ShellCheck job (report-only → gate at agreed severity) + error-severity fixes | — | M |
| 5 | WS2 | gitleaks job (+ `.gitleaks.toml` if fixtures require) | — | S |
| 6 | WS3 | Parity harness + fixture corpus + pair 1 (manifest synthesis) + determinism hooks | — | L |
| 7 | WS3 | Parity pairs 2–3 (ArgoCD, Flux) | PR 6 | M |
| 8 | WS4 | Error envelope helper + `log.ts` + group-by-group route migration (may split into 8a/8b) | PR 3 helps | M–L |
| 9 | WS5 | `taskStore.ts` (node:sqlite), write-through processManager, startup reconciliation, tests | PR 1 (Node 24 floor) | M |
| 10 | WS7 | Ink test script + parsing/dispatch suite + CI wiring | — | S–M |
| 11 | WS6 | Decomposition series: cluster page, then `k3s.ts`, `waffle.ts`, `antigravity.ts` (one PR each, file-motion only) | PR 6 for waffle | M ×4 |
| 12 | WS8 | Doc link fixes, CHANGELOG + first tag, CONTRIBUTING refresh | any time | S |

WS9 items are unscheduled; they enter this map by amendment when picked up
(audit rotation is the candidate to insert after PR 5 if Q10 says so).

**Branch protection evolution** (§14) happens as PRs 3–5 land: each new job
is added to the required checks only after it has run green on `main` once,
never in the same PR that introduces it.

## 14. CI & branch-protection policy

- New checks spend at least one `main` run as *non-required* before being
  promoted — a flaky required check trains everyone to ignore red.
- Required set after this plan: *Tests & typecheck*, *Production build*,
  *Lint*, *ShellCheck*, *Secrets scan* (names finalized in their PRs).
- Flake policy: a check that flakes twice in a week is demoted to
  non-required until fixed; the fix PR re-promotes it. (Written down so the
  demotion is a procedure, not an argument.)
- The parity job (§6) is part of the orchestrator test step, not a separate
  check — drift failures should read as test failures.

## 15. Risks & mitigations

| Risk | Where | Mitigation |
| --- | --- | --- |
| Node 24 breaks a transitive dep in the container only | WS1 | PR 1 gates on `docker build` + container smoke test, not just CI |
| Lint baseline buries real bugs in disable comments | WS2 | Disables must be line-scoped and carry a tracking note; count reported in the PR |
| ShellCheck findings overwhelm (164 legacy scripts) | WS2 | Report-only first; gate at error severity, warnings burned down incrementally |
| Parity fixtures encode today's bugs as "golden" | WS3 | Fixtures seeded from real examples; golden diffs reviewed like code; intentional-divergence notes required |
| `node:sqlite` experimental API shifts | WS5 | Single-module containment (`taskStore.ts`); Q6 fallback is a JSONL store behind the same interface |
| Envelope change breaks a dashboard consumer | WS4 | All consumers are in-repo; per-group PRs enumerate them; envelope meta-test prevents regressions |
| Decomposition PRs smuggle behavior changes | WS6 | File-motion-only rule, barrel re-exports, full suites + build as gates |
| Plan stalls after the cheap PRs | all | The sequence is value-ordered; every prefix of it is a coherent stopping point |

---

## 16. Open questions for reviewers

Please answer inline. Each has a recommendation; dissent is the point.

- **Q1 — Node target.** Standardize on Node **24** everywhere (§4.1), or
  standardize on **22** instead — the Dockerfile stays as-is and CI/dev move
  down to meet it? *Recommendation: 24 — it's what CI/dev already run,
  and §8 depends on its `node:sqlite` maturity.*
- **Q2 — Lint tool.** ESLint flat config (ecosystem standard, Next.js
  support) vs Biome (one fast binary, younger TSX rule coverage)?
  *Recommendation: ESLint — the Next integration and rule depth matter more
  here than raw speed.*
- **Q3 — ShellCheck gate.** Gate at `error` severity after the report-only
  baseline, or hold out for `warning` from day one? *Recommendation: error
  first, warning as a tracked burn-down — a day-one warning gate on 164
  legacy scripts will either stall or be rubber-stamped.*
- **Q4 — Parity scope & end-state.** Pairs in the order §6.2 proposes
  (manifest synthesis → ArgoCD → Flux)? And is parity-testing the end-state,
  or a bridge to a single implementation later? *Recommendation: that order;
  parity as the end-state for v1 of this plan, consolidation revisited with
  the fixtures as evidence.*
- **Q5 — Error envelope break.** §7 changes the authz denial body shape
  (absorbed into the envelope). Acceptable as a coordinated in-repo change,
  or must the authz shape be preserved verbatim for API stability?
  *Recommendation: accept the break — all consumers are in-repo and the
  authz API is one release old.*
- **Q6 — Task store technology.** `node:sqlite` (zero deps, experimental)
  vs a JSONL append file (boring, hand-rolled compaction) behind the same
  `taskStore` interface? *Recommendation: node:sqlite with the module
  containment described in §8.2.*
- **Q7 — Ink testing depth.** Parsing/dispatch + pure logic only, or also
  `ink-testing-library` render tests for the main views? *Recommendation:
  parsing + pure logic in this plan; render tests opportunistically after.*
- **Q8 — Releases.** Tags + hand-maintained CHANGELOG only, or also a
  release-drafter workflow? *Recommendation: tags + changelog now; drafter
  when the release cadence justifies it.*
- **Q9 — Dependabot posture.** Grouped weekly PRs with manual merge (CI
  gated), or auto-merge for patch-level once checks pass? *Recommendation:
  manual merge for the first month, then revisit auto-merge for patches.*
- **Q10 — Audit rotation priority.** Should `.vow/audit.log` rotation (§12)
  jump the queue into the main sequence (suggested slot: after PR 5)?
  *Recommendation: yes if any deployment is expected to run authz-enabled
  long-term; otherwise it can wait for WS9.*

---

*End of plan. Reviewers: answers to §16, plus any workstream-level dissent,
in review comments on this PR — implementation PRs follow the same
one-workstream-per-PR discipline as the authz rollout.*
