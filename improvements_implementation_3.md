# Vigilant Octo Waffle — Improvements Plan III: Finish the Surface, Pay the Type Debt

**Status:** Decisions taken 2026-10-21 — §11 answered with the recommended
defaults on all nine questions (Q1–Q9). Implementation in progress.
**Companion to:** `improvements_implementation.md` (Plan I, implemented) and
`improvements_implementation_2.md` (Plan II, implemented in full — PRs
#86–#97, completed 2026-10-19). This plan starts from main `01cf097`
(PR #100 merged; 0 open PRs, 0 open issues, 0 open CodeQL alerts).
**Method:** four parallel read-only audit slices (web, orchestrator,
platform/CI, cross-cutting) over the tree at `01cf097`; every load-bearing
claim below was re-verified against the code or the GitHub API before being
written into §2. Suspicion is labelled as suspicion wherever it appears.

---

## 1. Executive summary

Plan II closed the security arc: sessions, context grants, guardrails,
automerge. Plan III is about what that arc left visibly unfinished, and the
one real bug the sweep found in it:

- **The Access UI silently destroys WS5 grant context.** The principals
  editor's `Grant` type has no `context` field and its save handler rebuilds
  every grant as `{permission, scope}` — so any admin who edits a principal
  in the UI wipes the time/source/authMethod constraints that were set via
  CLI or API, with no warning. (§4.1 — fix first.)
- **WS5 shipped a backend with no operator surface.** Sessions cannot be
  listed or revoked anywhere (no endpoint, no UI, no CLI command); grant
  context cannot be viewed or edited in the UI at all. (§4.2–§4.4.)
- **The lint budgets turn out to be single-issue debts, and they are
  payable.** All 152 orchestrator warnings are one rule
  (`no-explicit-any`); 82% of the web budget is two rules. This is a
  burn-down with an end, not a swamp. (§6.)
- **The test signal has two holes with names:** the largest API routes
  (incl. the authz edit/rotate/init routes) have no behavior tests, and
  smoke.test.ts contains a provider block whose assertions pass whether or
  not the provider path works. (§5.)
- **The repo's 1,000-line rule exists nowhere in the repo** — and five
  files are over it, the largest at 1,901 lines. Codify it, then split the
  giants along seams that already exist. (§7.)
- **Platform residue:** seven curl-installed binaries with no checksum
  verification, CI testing helm v3.16.4 while the image ships v3.17.1,
  `@types/node` a major ahead of the runtime, a dead Tauri skeleton, no
  `.dockerignore`, a runner image running as root, and a versioning story
  (tag `v0.1.0` vs manifests `1.0.0`, zero GitHub Releases, a CHANGELOG
  silent since 2026-10-04) that contradicts itself. (§8, §9.)

Six workstreams, roughly 14 PRs, sequenced so the bug fix and the cheap
platform wins land first and the structural splits land last, behind the
improved tests.

## 2. Current state — verified evidence

### 2.1 The headline bug and the WS5 surface gaps

| # | Evidence | Source |
|---|----------|--------|
| E1 | UI `interface Grant` declares only `permission` + `scope`; `handleSaveEdit` rebuilds grants as `{permission, scope}` and PATCHes them — `context` is dropped on every UI save. Grant list render never displays context. | `apps/web/src/app/settings/access/page.tsx:18-21`, `:193-201`, ~`:468-476` (read directly) |
| E2 | Session routes expose only POST/DELETE (`/api/authz/session`); no list endpoint; `sessions` appears in the `/me` and principals routes 0 times; the Access page's only session trace is audit-log rendering. Only revocation path in the product is own-sign-out. | `apps/web/src/app/api/authz/session/route.ts:48,92`; grep over routes |
| E3 | Grant editor exposes permission + `scope.appId`/`scope.namespace` only; grep for `notBefore\|notAfter\|authMethod\|loopback` in the Access page: 0 hits. | `settings/access/page.tsx:511-560` |
| E4 | `authz-cli.ts` dispatch is init/add/list/revoke/rotate/check/help; the word `sessions` appears 0 times. Server-side `createSession`/`findSession`/`revokePrincipalSessions` exist (`authz.ts:712/737/773`) with no CLI consumer. | grep + read, verified |
| E5 | CLI `validateGrantContext()` (authz-cli.ts:194) hand-duplicates the zod `grantContextSchema` (authz.ts:221-233) and re-validates the authMethod enum a second time inline (:395-396). Whether the two already differ on edge cases (date parseability) is **suspicion** — not diffed line-by-line. | read |

### 2.2 Lint composition (measured with eslint `-f json` at `01cf097`)

| # | Evidence |
|---|----------|
| E6 | Orchestrator: exactly **152 warnings / 0 errors**, and **100% of them are `@typescript-eslint/no-explicit-any`** — 39 files; k8s.ts 25, antigravity/engine.ts 12, k3s-admin.ts 11, ingress.ts 11, waffle/runner.ts 10. Forms: 127× `: any`, 11× `as any`, 7× `Record<string, any>`. No bug-indicating rule fires at all. |
| E7 | Web: exactly **376 warnings / 0 errors** — `no-explicit-any` 167, `no-unused-vars` 140, `react-hooks/set-state-in-effect` 32, `react-hooks/static-components` 22, `react-hooks/exhaustive-deps` 13, `import/no-anonymous-default-export` 2. Top files: `cluster/useClusterPage.ts` 46, `docs/page.tsx` 25, `storage/page.tsx` 23. |
| E8 | Web server-side `any` slice is small and high-value: 24 across `app/api` + `lib`, incl. `authz/init/route.ts:96`, `k8s/logs/route.ts:36`, `antigravity/stream/route.ts:52,69`. |
| E9 | All 22 web `static-components` warnings are in one file: `docs/page.tsx` defines components in render (e.g. `CodeBlock` at :147 inside the page at :72) — remount/state-loss class, one-file fix. |
| E10 | All 13 `exhaustive-deps` warnings share one shape: an effect missing its fetch function (`antigravity/page.tsx:252`, `helm/page.tsx:121`, `pods/page.tsx:169`, `rollouts/page.tsx:125`, `terminal/page.tsx:65,114`, +7). Adding the fn to deps naively risks refetch loops (fns are unmemoized); correct fix is `useCallback`/restructure. Actual stale-data bugs per site: **suspicion**, pattern is usually benign. |
| E11 | `no-unused-vars` includes unfinished-work signals: `apiError` imported unused in 4 routes (`dns`, `namespaces`, `namespaces/sync`, `waffle/abort`) — those routes bypass the shared error envelope; `APP_CATALOG` unused in both apps routes; `fluxNs` assigned-unused at `flux/route.ts:56`. |
| E12 | All four TS packages declare `"@types/node": "^26.6.5"` while engines pin `>=24 <25`, `.nvmrc` is `24`, the Dockerfile base is digest-pinned node:24, and CI greps the image for `^v24\.`. Typecheck can accept Node 25/26-only APIs. No known instance — harm is **suspicion**, the mismatch is fact. |

### 2.3 Test signal

| # | Evidence |
|---|----------|
| E13 | **57 API routes, 7 colocated route tests.** `coverage.test.ts` enforces only that routes textually consult the authz layer. Largest untested: `api/cluster/k3s/route.ts` (716 lines), `api/authz/init/route.ts` (110, first-run bootstrap), `api/authz/principals/[id]/route.ts` + `[id]/rotate/route.ts`, `api/storage/route.ts` (223), `api/waffle/run/route.ts`, `api/tasks/run/route.ts`. |
| E14 | smoke.test.ts (918 lines, 53 tests = 22% of the orchestrator suite) calls the real provider stack at :484-620 (`getAntigravityEngineStatus`/`askAntigravity`/`streamAntigravity` against localhost endpoints + a real `which agy` probe). Two tests accept either engine and require only a non-empty response — the block passes via heuristic fallback even if the provider path is broken. Suite runs serially (`--test-concurrency=1`), so these probes sit on the critical path; 45s engine timeouts make stalls expensive (**suspicion** on wall-time share — not measured). |
| E15 | `binaryAvailable()` is copy-pasted verbatim into 3 test files (smoke:61, storage:19, tls:16); parity.test.ts uses a second, different skip mechanism (`skipOrFail`, `VOW_PARITY_REQUIRED`). Local green ≠ CI green on machines without helm/mkcert. |
| E16 | 7 of 12 `apps/web/src/lib` modules have no test: `ability.tsx` (the React auth provider — its pure core is tested, the provider is not), `webhook.ts` (client Argo poster holding a stored webhook token), `audio.ts`, `log.ts`, `clipboard.ts`, `notifications.ts`, `project.ts`. |
| E17 | `apps/githubio` has no `test` script and zero test files; CI's typecheck step names only web + ink (githubio is covered only implicitly via its `next build`). |
| E18 | The shell harness exercises exactly **1 of the 154** scripts in `src/` (`k3s_add_node.sh`, two functions). The other 153 have ShellCheck only, no behavioral tests. |
| E19 | 29 bare `catch {}` sites in orchestrator non-test src across 13 files, of 256 catch sites. Two are on correctness paths: runner.ts `verifyStepHealth` treats any kubectl error as "rollout status optional"; `ensureLocalRegistry` treats any curl error as "not deployed yet". The package has no logger (`console.*` 4× in 2 files) and only 2 Error subclasses. |

### 2.4 Structure

| # | Evidence |
|---|----------|
| E20 | The "1,000-line rule" is **not written anywhere in the repo**: grep for `max-lines`/`1000-line` across md/mjs/json/yml = 0 hits; no AGENTS.md; root eslint config has no `max-lines`; no CI gate. It has been applied by convention (execute.ts split, WS5) only. |
| E21 | Five source files exceed 1,000 lines (`wc -l`, excl. generated): `cluster/components/K3sOpsModal.tsx` **1901**, `antigravity/page.tsx` **1284**, `storage/page.tsx` **1283**, `docs/page.tsx` **1253**, `waffle/runner.ts` **1073**. Watchlist: `apps/page.tsx` 989, `helm/page.tsx` 946. Regrowth is proven: Plan I already decomposed the then-four largest files once (CHANGELOG [Unreleased]). |
| E22 | K3sOpsModal is the mechanical split: one presentational component, 19 tab panels, 64 onClick handlers, **0 useState and 0 fetch inside** — all state lives in `useClusterPage.ts` (840 lines, also web's worst lint file at 46 warnings). |
| E23 | storage/page.tsx splits by its 4 tabs (contiguous JSX seams at :560/:1029/:1091); 19 useState at page level to thread as props. antigravity/page.tsx is the hard one: 24 useState + 6 fetch/EventSource sites, streaming state intertwined with controls. |
| E24 | runner.ts is the WS6 split's unfinished remainder: one class, lines 72-1073; oversized methods `executeStep` ~230 lines, `executePipeline` ~176, `buildImages` ~135, `provisionSecrets` ~114; visible seams (secrets / images+registry / health). antigravity/engine.ts duplicates ask/stream provider dispatch (branches at :401/:442 vs :623/:712), near-identical `queryOllama`/`queryVllm` bodies, and 5 hand-rolled AbortController+setTimeout sites package-wide with differing timeouts (45s engine, 2s providers). |
| E25 | WaffleRunner bypasses the hardened executor entirely (0 imports of executor/ProcessManager): direct `spawn('docker', …)` (:516), `spawn('kubectl', ['apply','-f','-'])` (:648) — pipeline builds/applies don't get the timeout/kill-tree semantics the task executor is tested for. Separately, `antigravity/providers.ts:127` holds the package's only shell-string exec (`execSync('which agy 2>/dev/null')` — constant string, no injection surface, but off-pattern). |
| E26 | No root tsconfig and no `extends` anywhere: 4 hand-maintained configs, all `strict: true`; `forceConsistentCasingInFileNames` on in ink/orchestrator, off in web/githubio; **no** package sets `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, or `noImplicitOverride`. |

### 2.5 Platform, image, repo settings

| # | Evidence |
|---|----------|
| E27 | Seven curl-installed binaries with **no checksum verification**: CI installs gitleaks (ci.yml:26), yq v4.44.5 (:73), mkcert v1.4.4 (:80), shellcheck v0.10.0 (:172); the Dockerfile installs kubectl v1.32.2, kind v0.27.0, helm v3.17.1 (:18-34). All publish official checksums. Plan II SHA-pinned the *actions*; these are the unpinned remainder. |
| E28 | **Helm drift:** CI tests run helm **v3.16.4** (`ci.yml:62-64`, azure/setup-helm) while the shipped image carries **v3.17.1** (`Dockerfile:29`). The smoke tests exercise "the real helm" — not the version users get. |
| E29 | No `.dockerignore` anywhere; the runner stage does `COPY --from=builder /app ./` (full source + devDependencies, no prune, no Next standalone output) and the Dockerfile has **no `USER` directive** — the image ships the whole workspace and runs as root. Build context includes `.git/`, `.secrets/`, `node_modules/`. |
| E30 | Workflow hygiene: `timeout-minutes` appears in **no** workflow (default is 360 min/job); `dependabot-automerge.yml:21` is the only job on floating `ubuntu-latest` (the other 10 pin `ubuntu-24.04`) and the only workflow without a `concurrency:` block. |
| E31 | `desktop/` is a dead, non-buildable Tauri skeleton: only `Cargo.toml` + `tauri.conf.json`, no `src/`, no `build.rs`; the config references a nonexistent `icons/` dir and `frontendDist: ../apps/web/out`, which web never produces (no `output: 'export'`). Zero references in package.json, pnpm-workspace.yaml, workflows, or README; dependabot.yml has no cargo ecosystem. Last touched 2026-09-28, PR #18. |
| E32 | Root `.python-version` is tracked and contains the literal string `aider` — a pyenv environment name, not a version. |
| E33 | Branch protection otherwise matches the verified baseline exactly (7 contexts, strict, 1 review, conversation resolution, admins exempt — re-verified 2026-10-21), but: `dismiss_stale_reviews: false` (an approval survives later pushes), `delete_branch_on_merge: false`, no CODEOWNERS anywhere, and a stray unprotected branch `anothersetofeyea` (single "alignment" commit, 2026-04-01) still sits on the remote. |

### 2.6 Docs, versioning, local check story

| # | Evidence |
|---|----------|
| E34 | `CONTRIBUTING.md` says only **Tests & typecheck** and **Production build** must pass — main requires **seven** checks; its test table omits githubio and the Shell tests job. `ARCHITECTURE.md` never mentions ink or githubio (grep: 0 hits); `README.md:30-32` lists only web + orchestrator as the monorepo; README:214 still says `docker-compose` (v1). |
| E35 | Status drift in the plan docs themselves: `improvements_implementation.md:3` still says "Draft for review (2026-10-03)"; `improvements_implementation_2.md:3` still says "Implementation in progress". `ROADMAP.md:23` lists "Optional session cookies as an alternative to localStorage tokens" as future work — shipped in WS5/PR #97 (localStorage tokens removed entirely). |
| E36 | Versioning contradicts itself: exactly **1 tag** (`v0.1.0`) and **0 GitHub Releases**, while every manifest says `1.0.0` (root, web, ink, githubio, orchestrator; also desktop/Cargo.toml, tauri.conf.json). CHANGELOG declares SemVer + annotated-tag releases, but `[Unreleased]` still contains only the Plan I PR list and the last entry is `[0.1.0] - 2026-10-04` — nothing for PRs #83-#100, despite CONTRIBUTING mandating Unreleased entries. |
| E37 | Root package.json scripts (dev/build/start/ink/vow/test/lint/typecheck) never run the shell harness, ShellCheck, or the secrets scan — a developer can run every root script and still miss **3 of the 7 required checks** until CI. |

### 2.7 Checked and clean — do not re-propose

- **0** TODO/FIXME/HACK/XXX in non-test source.
- All four workflows already have top-level `permissions:` blocks; all
  setup-node workflows already use the pnpm cache; node/pnpm pinning
  otherwise agrees (.nvmrc `24` = engines `>=24 <25` = digest-pinned
  node:24 image; pnpm 11.24.0 from the single root `packageManager`).
- Branch protection, Dependabot alerts + security updates, and the seven
  required checks verified against the API on 2026-10-21 — no drift beyond
  E33's micro-items.
- No TS duplication between web and orchestrator for the suspected items:
  web imports authz types/constants from `@vow/orchestrator` (68 files);
  enabler validation and `isAllowedCustomEndpoint` are single-sourced.
- `.gitignore` is complete (`.vow/`, caches, `dist/`, `.next/`, `.env*`,
  `*secrets`).
- CI is fast (full run ≈ 3 min wall; longest job ShellCheck ≈ 2m51s) —
  further caching work is not worth a candidate.
- Zero Next.js `loading.tsx`/`error.tsx`/`not-found.tsx` anywhere in the
  app (28 page routes) — noted as a small WS4 item (§7.5), not a finding
  against anyone; for a localhost control plane it has simply never bitten.

## 3. Goals, non-goals, principles

**Goals.** (1) Fix the grant-context data-loss bug before anything else.
(2) Give WS5's backend the operator surface it shipped without.
(3) Convert the lint budgets from permanent ceilings into a paid-down debt
with a visible end. (4) Close the two named test-signal holes. (5) Make the
size rule real and bring the five giants under it. (6) Sweep the platform
residue (unpinned binaries, drift, dead code, image hygiene) in cheap,
mechanical PRs.

**Non-goals.** No new features beyond the WS5 operator surface. No
framework or data-fetching-library adoption (the `'use client'` everywhere
posture, 50 of 51 tsx files, is noted in E-adjacent evidence but is an
architectural decision for a localhost control plane — out of scope here).
No sliding session renewal (considered and deferred in WS5's D-defaults;
revisit only if it bites). No GHAS purchase — the two entitlement-gated
secret-scanning features remain the reviewer's billing call, untouched by
this plan.

**Principles.** Same as Plans I/II: evidence before scope; behavior-
preserving splits behind tests; budgets only shrink; every PR green on all
seven required checks before it is called done; anything this sandbox
cannot run is disclosed as unverified in its PR body.

## 4. WS1 — Finish the WS5 operator surface

### 4.1 Fix the Access UI's silent grant-context stripping (bug, E1)

The UI `Grant` type gains `context`; `handleSaveEdit` round-trips it
unchanged; the grant list displays it (e.g. `src=loopback until=2026-…`
in the CLI's existing rendering style). A regression test pins the
round-trip: a principal whose grants carry context, edited in the UI for
an unrelated field, keeps the context. This is a data-loss fix, not an
enhancement — it lands first, alone. Effort S, risk low.

### 4.2 Grant-context editor in the principals UI (E3)

Add context editing (notBefore/notAfter, source, authMethod) to the grant
editor, behind the same validation the API applies. Effort M, risk low.
Sequenced after 4.1 so the editor is built on the round-trip-safe type.

### 4.3 Session visibility and revocation (E2)

A list endpoint (`GET /api/authz/sessions` or per-principal on the
principals route — implementer's choice, one shape) returning id-hash
prefix, principal, created/expires, authMethod; Access page gains a
sessions view: a user can revoke their own other sessions, an admin can
revoke a principal's sessions. Server functions already exist
(`findSession`, `revokePrincipalSessions`); audit events already fire on
revoke. Effort M, risk low–medium (new authz-adjacent read surface —
gate it on the same permission that reads principals).

### 4.4 CLI session commands + single-source context validation (E4, E5)

`vow authz sessions [--principal <id>]` and `vow authz revoke-sessions
<id>` over the existing store functions, for CLI-only hosts where token
rotation is currently the only (blunt) session revocation. In the same
PR: export the grant-context validator from authz.ts (derived from the
zod schema) and delete the CLI's hand-rolled duplicate + double
validation. Effort S–M, risk low.

## 5. WS2 — Close the named test-signal holes

### 5.1 Behavior tests for the highest-risk untested routes (E13)

Tranche 1 (authz): `principals/[id]`, `principals/[id]/rotate`, `init` —
edit/rotation/bootstrap semantics incl. the WS5 revocation side effects.
Tranche 2 (blast radius): `cluster/k3s` (716 lines), `storage`,
`waffle/run`, `tasks/run`. Follow the existing route-test harness shape;
`coverage.test.ts` stays as the textual floor, not the ceiling. Effort L
total (M per tranche), risk low (additive).

### 5.2 Make the smoke provider block able to fail (E14)

Move smoke.test.ts's live-provider block (:484-620) into an opt-in
integration file gated like parity (`VOW_…_REQUIRED` semantics: run in
CI, explicit locally), and split the remaining pure-unit describes out of
the 918-line file by subject. The unit suite should assert provider
behavior against fakes, not accept either-engine non-empty responses.
Effort M, risk low.

### 5.3 Shared test helpers; one skip idiom (E15)

Extract `binaryAvailable` + friends into `__tests__/helpers`; migrate
smoke/storage/tls; align parity's `skipOrFail` naming/docs so local vs CI
expectations are stated in one place. Effort S, risk low.

### 5.4 Lib tests for the auth provider and webhook poster (E16)

`ability.tsx` (provider behavior around the tested core) and `webhook.ts`
(token handling, error paths). The other five untested lib modules are
small utilities — cover opportunistically, not as a tranche. Effort S–M,
risk low.

### 5.5 githubio test + typecheck parity (E17)

Add a `test` script (even a smoke-level suite) and name githubio in CI's
typecheck step alongside web + ink. Effort S, risk low.

### 5.6 Shell harness breadth (E18)

Extend `scripts/tests/run.sh` from 1 script to the highest-risk handful
in `src/` — the k3s join/server-URL family first (same shape as the
existing cases), then any script that builds URLs, parses node output, or
mutates system state. Target: the ~10 scripts whose failure modes have
bitten before, not all 154. Effort M, risk low.

### 5.7 Bare-catch audit (E19)

Classify all 29 bare catches as benign-probe vs failure-masking. The two
correctness-path sites in runner.ts (health, registry) get at minimum a
debug-level log hook via one tiny internal `debug()` helper (env-gated,
no logger framework). No behavior change beyond observability. Effort M,
risk low.

## 6. WS3 — Pay the type debt (budgets with an end)

The ratchet stays: budgets in package scripts only ever shrink, and each
tranche below lands with its budget reduction in the same PR.

### 6.1 Orchestrator `no-explicit-any` burn-down (E6)

One rule, 152 warnings, 39 files. Order: **k8s.ts first** (25 — the
`@kubernetes/client-node` response maps at :130-419 get the client's
generated types; the `as any` casts at :295/297 on health/sync status get
checked against the declared enums, since a cast there can hide values
outside them), then engine.ts (12), k3s-admin.ts (11), ingress.ts (11),
runner.ts (10), then the tail. Expected outcome: budget 152 → under 40,
with the residual `any`s individually justified or suppressed with a
reason comment. Effort M (k8s.ts S–M of it), risk low–medium — typing the
maps may surface latent undefined-handling; that surfacing is the point,
and 5.1/5.2's tests land first to catch it.

### 6.2 Web `any` + unused-vars burn-down (E7, E8, E11)

Server slice first: the 24 `any` in `app/api` + `lib`. Then the
unused-vars tranche as its own PR — deletions are mechanical, but the 4
envelope-bypass routes (E11) get a per-route decision: adopt the shared
`apiError` envelope or delete the import with a comment saying why not.
Target: web budget 376 → ~150 across WS3, with `set-state-in-effect`
handled opportunistically per Plan II's Q7 posture. Effort M, risk low.

### 6.3 React-hooks correctness tranche (E9, E10)

Two shapes only. (a) `docs/page.tsx`: hoist the 22 in-render component
definitions to module scope — S, do early, kills a whole warning class in
one file. (b) The 13 `exhaustive-deps` fetch-function effects: memoize
the fetch fns (`useCallback` with honest deps) or restructure to a
shared data hook if one emerges from 6.2 — explicitly *not* the naive
add-to-deps fix. Effort M, risk medium (data-loading behavior).

## 7. WS4 — Codify the size rule; split the giants

### 7.1 Write the rule down and gate it (E20)

State the 1,000-line source-file cap in CONTRIBUTING.md and add a CI step
(script + `wc -l` over apps/packages src, excluding tests and generated
trees) that reports violations. Enforcement level is decision **Q3**
(default: warn-only for one cycle, then required). Effort S, risk low.

### 7.2 K3sOpsModal.tsx by tab panel (E21, E22)

Extract the 19 panels into per-tab components under
`cluster/components/k3sops/`, threading the existing `ClusterPageState`
prop unchanged. The file is purely presentational (0 useState, 0 fetch),
so this is mechanical; pair it with a pass over `useClusterPage.ts`'s 46
warnings while the surface is open. Effort L, risk low–medium.

### 7.3 waffle/runner.ts along its seams (E21, E24)

Extract secrets (deriveSupabaseJwt/provisionSecrets/loadProjectEnvFiles),
image build + registry (buildImages/ensureLocalRegistry/
importImageToCluster), and health verification (verifyStepHealth) into
`waffle/` modules beside the WS6 siblings, leaving WaffleRunner as the
orchestrator of them. Coverage exists (waffle.test.ts, smoke). Effort L,
risk medium.

### 7.4 storage/page.tsx by tabs; antigravity/page.tsx last (E21, E23)

storage: four tab components, page-level state threaded as props —
effort M, risk low–medium. antigravity: extract provider tabs and the
endpoint drawer first, chat/stream last, and only after 5.2's provider
tests exist — effort L, risk medium–high; inclusion is decision **Q4**.

### 7.5 App-level error/loading boundaries (from §2.7)

One `app/error.tsx` + `app/loading.tsx` (and a `not-found.tsx`) so a page
render error degrades instead of white-screening the control plane.
Effort S, risk low.

## 8. WS5 — Platform & image hygiene (cheap, mechanical)

### 8.1 Checksum-verify the seven curl-installed binaries (E27)

Pin `sha256` alongside each version in ci.yml (gitleaks, yq, mkcert,
shellcheck) and the Dockerfile (kubectl, kind, helm); verify with
`sha256sum -c` before install. Dependabot does not track these — add a
comment at each pin naming the refresh procedure. Effort S, risk low.

### 8.2 One helm version, one source (E28)

Align CI to the shipped v3.17.1 (or extract both from one version file)
and leave a comment tying them together, so "the real helm" in tests is
the helm users run. Effort S, risk low.

### 8.3 `@types/node` back to the runtime major (E12)

`^26.6.5` → `^24` in all four packages + lockfile refresh **with the
repo-pinned pnpm** (the Axonwall lesson: verify frozen install in a
pristine copy with the pinned version, and diff the resolved set).
Effort S, risk low.

### 8.4 Dockerfile: context, pruning, non-root (E29)

Add `.dockerignore` (`.git`, `.secrets`, `node_modules`, build outputs);
prune the runner stage (`pnpm prune --prod` or Next standalone output —
implementer's choice, proven by the existing CI docker step booting the
image); add a non-root `USER`. Effort M, risk medium — the proof
obligation is the CI docker step plus a smoke of the pruned image.

### 8.5 Workflow hygiene bundle (E30)

`timeout-minutes` on every job (sized to observed runtimes: CI ≈ 3 min
wall, ShellCheck longest at ~3 min — generous multiples, not the 360
default); pin the automerge workflow to `ubuntu-24.04`; add its missing
`concurrency:` block. Effort S, risk low.

### 8.6 Delete the dead surface (E31, E32)

Remove `desktop/` (decision **Q5** — default delete: it cannot build,
references artifacts that don't exist, and has zero consumers) and the
tracked `.python-version` containing `aider`. Effort S, risk low.

### 8.7 Protection micro-items (E33)

Settings-only, via API, at the reviewer's word: enable
`dismiss_stale_reviews` and `delete_branch_on_merge`; add a CODEOWNERS
file (one line, the reviewer); delete the stray `anothersetofeyea`
branch. Bundled as decision **Q9**; none of it blocks any PR. Effort S,
risk low.

## 9. WS6 — Docs, versioning, and the local check story

### 9.1 Root `pnpm check` that mirrors CI (E37)

One root script that runs tests, typecheck, lint, the shell harness,
ShellCheck, and the secrets scan — everything a required check will
judge, runnable before push. Where a tool is absent locally (helm,
mkcert, shellcheck, gitleaks), it reports SKIPPED loudly rather than
silently passing. Effort S–M, risk low.

### 9.2 Truth-up the structural docs (E34)

CONTRIBUTING: the seven required checks, the full test table incl.
githubio + Shell tests, the §7.1 size rule. ARCHITECTURE: add ink and
githubio. README: full workspace list; `docker compose` everywhere.
Effort S, risk low.

### 9.3 Truth-up the status docs (E35)

Mark Plan I implemented and Plan II complete in their own headers (the
repo copies), and move ROADMAP's session-cookie line from future work to
shipped. Effort S, risk low.

### 9.4 A release story that agrees with itself (E36)

Pick the version source of truth (decision **Q6** — default: manifests'
`1.0.0` wins; tag `v1.0.0` at the merge that adopts this plan's first
release-worthy PR, publish the first GitHub Release from the tag), and
backfill CHANGELOG `[Unreleased]` for the October arc (PRs #83-#100:
bug sweep, Plan II, WS5, automerge) per CONTRIBUTING's own mandate.
Thereafter the changelog is updated in the PR that changes behavior, as
CONTRIBUTING already requires. Effort M, risk low.

### 9.5 Shared tsconfig base + a stricter-flag pilot (E26)

Extract a root `tsconfig.base.json` (strict + skipLibCheck +
forceConsistentCasingInFileNames), have all four packages extend it —
kills the casing drift. Then pilot `noUncheckedIndexedAccess` on the
orchestrator only, gated on a measured error count reported in the PR
(decision **Q7**); adopt, or record the count and defer with the number
known instead of guessed. Effort M, risk medium (pilot blast radius is
the unknown being measured).

## 10. Sequencing & PR slicing

Order (each PR standalone-green on all seven required checks; merges
remain the reviewer's call, one at a time):

1. **PR-1** §4.1 — grant-context round-trip fix + regression test (bug).
2. **PR-2** §8.1 + §8.2 + §8.5 — checksum pins, helm alignment, workflow
   hygiene (one platform quick-wins PR, three S items).
3. **PR-3** §8.3 — @types/node alignment (own PR: lockfile discipline).
4. **PR-4** §8.6 + §9.2 + §9.3 — dead-surface deletion + docs truth-up.
5. **PR-5** §4.4 — CLI session commands + validator single-sourcing.
6. **PR-6** §4.2 + §4.3 — context editor + session list/revoke surface.
7. **PR-7** §5.3 + §5.5 — test helpers, githubio parity.
8. **PR-8** §5.1 tranche 1 — authz route behavior tests.
9. **PR-9** §5.2 + §5.4 — smoke split, provider block gating, lib tests.
10. **PR-10** §5.1 tranche 2 + §5.6 — blast-radius route tests, shell
    harness breadth.
11. **PR-11** §6.3a + §6.2 — docs/page hoist; web server-slice burn-down
    + budget cut.
12. **PR-12** §6.1 — k8s.ts typing, then orchestrator tail + budget cut.
13. **PR-13** §6.3b — exhaustive-deps tranche (behind PR-9's tests).
14. **PR-14** §7.1 + §7.2 — size rule codified; K3sOpsModal split.
15. **PR-15** §7.3 + §5.7 — runner.ts split; bare-catch audit lands in
    the opened files.
16. **PR-16** §7.4 — storage split (antigravity per Q4).
17. **PR-17** §8.4 — Dockerfile pruning + non-root (behind PR-10).
18. **PR-18** §9.1 + §9.4 + §9.5 — root check script, release story,
    tsconfig base + pilot.

Runner-through-the-hardened-executor (E25) is deliberately **not** in
the sequence: it changes process-lifecycle behavior, and whether it is
worth it is decision **Q8**. If yes, it becomes a PR after PR-15, when
runner.ts is split and its tests are strongest.

Settings items (§8.7) are not PRs; they execute on the reviewer's word
at any point.

## 11. Decisions for the reviewer

Each question has a recommended default. "Take the defaults" adopts all.

- **Q1 — §4.1 fix scope.** Preserve + display context only, editor
  follows in §4.2? **Default: yes** — the data-loss fix should not wait
  on editor UI.
- **Q2 — §4.3 session revocation scope.** Admins can list/revoke any
  principal's sessions; users their own. **Default: both** (admin gated
  on the principals-read permission).
- **Q3 — §7.1 size-rule enforcement.** Warn-only in CI for one Plan III
  cycle, then promote to required once the five current violations are
  split or excepted. **Default: warn-first.**
- **Q4 — §7.4 antigravity/page.tsx.** Include the split in Plan III
  (last, behind the provider tests). **Default: include.** Alternative:
  defer it alone to a Plan IV.
- **Q5 — §8.6 `desktop/`.** Delete the dead Tauri skeleton. **Default:
  delete.** Alternative: keep and file it as a real project — that is a
  product decision, not hygiene.
- **Q6 — §9.4 version truth.** Manifests' `1.0.0` is the version; tag
  `v1.0.0` + first GitHub Release + CHANGELOG backfill. **Default:
  adopt 1.0.0.** Alternative: re-version manifests to continue the 0.x
  line from `v0.1.0`.
- **Q7 — §9.5 `noUncheckedIndexedAccess` pilot.** Pilot on the
  orchestrator, adopt if the error count is tractable, else record the
  count and defer. **Default: pilot.**
- **Q8 — E25 WaffleRunner executor.** Route WaffleRunner's spawns
  through the hardened ProcessManager in a dedicated PR after the
  runner split. **Default: include, sequenced last in WS4's wake.**
  Alternative: accept direct spawns as a documented exception.
- **Q9 — §8.7 protection micro-items.** Enable `dismiss_stale_reviews`
  + `delete_branch_on_merge`, add CODEOWNERS, delete the stray
  `anothersetofeyea` branch. **Default: all four.**
