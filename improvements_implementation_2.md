# Vigilant Octo Waffle — Improvements Plan II: Least-Privilege Tightening & Guardrail Depth

**Status:** Complete — implemented in full (PRs #86–#97), completed
2026-10-19. §16 decisions were taken with the recommended defaults on
all eight questions (Q1–Q8). Followed by Improvements Plan III
(`improvements_implementation_3.md`).
**Companion to:** `improvements_implementation.md` (implemented, PR #29 and the WS
rollouts) and the October 2026 security arc — bug sweep (PR #83), required-check
promotion + scanning enablement (PR #84), and the CodeQL triage (PR #85).
**Reviewers:** please answer the questions in **§16** inline, the same way the
earlier plans were reviewed. Work begins from those answers.

---

## 1. Executive summary

The repository's security posture is now strong where it is measured: the
2026-10-14 bug sweep and the first CodeQL baseline (108 alerts) are both fully
remediated, branch protection requires all six checks, and secret scanning with
push protection is on. Nothing in this plan is firefighting either.

What remains is a different class of work — refinements *inside* the boundaries
that already exist:

1. **Least-privilege gaps in the authz model.** Three places grant more than
   they need: the antigravity engine runs the agy CLI with
   `--dangerously-skip-permissions` unconditionally, the shared auth path
   accepts bearer tokens in the URL query string on every route, and a
   `flux:sync` grant can also run a full Flux bootstrap. A fourth: the
   first-owner bootstrap still accepts a one-character password (storage was
   hardened to scrypt in PR #85; the floor itself was left as a product call).
2. **Platform guardrails not yet switched on.** Three GitHub security toggles
   sit disabled, Dependabot grouping doesn't cover the packages that actually
   flooded the queue in October, and CodeQL runs only its default query set
   over one language.
3. **The most fragile surface has no tests.** The 154 bash scripts under
   `src/` caused the #81 `server_url` regression cluster and were verified in
   both sweeps only by throwaway harnesses. ShellCheck warnings (70) and lint
   warnings (~530 across web and orchestrator) are unenforced, so both debts
   can only grow.
4. **Two authz v1 follow-ups are still open** — context-scoped grants and a
   session-cookie alternative to localStorage tokens. (The third, audit-log
   rotation, turned out to be already implemented; see §2.)

The plan is five workstreams (§4–§8), sequenced in §9. Everything is small;
the only item with real design weight is the session-cookie alternative
(§8.2), and it can be deferred without blocking the rest.

---

## 2. Current state — verified evidence

All figures measured against `main` at `8feac5f` on 2026-10-15, after PR #85
merged.

| Fact | Evidence |
| --- | --- |
| Branch protection | main requires all six checks (Tests & typecheck, Production build, Lint, ShellCheck, Secrets scan, Analyze (javascript-typescript)), strict up-to-date, 1 approving review, admins exempt |
| Code scanning | 0 open alerts (baseline 108 → 20 auto-fixed by PR #85, 90 dismissed with documented reasons, 2 successor alerts dismissed on the PR) |
| Secret scanning | Enabled with push protection; **validity checks: disabled · non-provider patterns: disabled** (repo `security_and_analysis`) |
| Dependabot security updates | **Disabled** (same payload) |
| Tests | Orchestrator 237 (6 added by PR #85) · web 102 (vitest) · ink 25; CI green on main |
| Lint | 0 errors everywhere; warnings: web 376, orchestrator ~152 (mostly `no-explicit-any` / `unused-vars` classes) |
| Shell surface | 154 scripts under `src/`; ShellCheck error-level clean, **70 warnings** (measured 2026-10-14, A/B vs main) |
| agy invocation | `packages/orchestrator/src/antigravity/engine.ts:480` and `:791` both build args starting with `'--dangerously-skip-permissions'` |
| Query-string tokens | `apps/web/src/lib/authz.ts:101` — `url.searchParams.get('token')` in the shared authorize path |
| EventSource consumers | `apps/web/src/app/pods/page.tsx`, `apps/web/src/app/terminal/page.tsx`, `apps/web/src/app/waffle/useWafflePage.tsx`, `apps/web/src/components/TerminalModal.tsx` |
| Flux route gating | `apps/web/src/app/api/flux/route.ts:63` — every action except `set-runner` requires only `flux:sync`; `bootstrap` is at `:80` |
| Principal tokens | Stored in `localStorage` (`apps/web/src/lib/ability-core.ts:112`, `PRINCIPAL_TOKEN_KEY`) — a considered v1 decision (§16 of the authz plan) |
| Audit log | `.vow/audit.log` **already rotates**: size cap (`VOW_AUDIT_MAX_BYTES`) + 3 generations, `apps/web/src/lib/authz.ts:199–222`, with tests. The v1 follow-up is done; it is not in this plan |

---

## 3. Goals, non-goals, principles

**Goals**

- Every standing grant and credential channel should be as narrow as the
  feature allows (least privilege inside the existing CASL model, not a new
  model).
- Platform guardrails that cost nothing to run should be on.
- Fragile surfaces (bash layer, generated config) should fail in CI before
  they fail on a cluster.
- Warning debt should be mechanically incapable of growing.

**Non-goals**

- No new features, no UI redesign, no authz model replacement.
- No change to the localhost-bound trust posture itself; this plan tightens
  what happens *inside* it.
- No forced migration of existing principal tokens or stored credentials
  (the scrypt rollout in PR #85 already established the prefix-dispatch
  pattern for gradual change).

**Principles**

- Default-off for anything that skips a permission prompt (the same rule
  applied to the paperclip fork's agy adapter).
- Fail closed, but never break the operator's own recovery path: any
  tightening that can lock the owner out ships with the local-board or CLI
  escape hatch intact and tested.
- Each workstream item is its own small PR with its own verification,
  following the #83–#85 pattern.

---

## 4. WS1 — Least-privilege tightening

### 4.1 Scope the agy `--dangerously-skip-permissions` flag

**Problem.** Both agy invocation sites (query and streaming) prepend
`--dangerously-skip-permissions` unconditionally. The copilot therefore runs
its tool calls with no approval step for every user of the feature, whether
or not the operator wants that. This is the adapter-wide default-flip the
paperclip fork rejected for the same tool.

**Proposal.** Gate the flag behind an explicit opt-in and pass no flag
otherwise:

- Setting: `VOW_AGY_SKIP_PERMISSIONS=1` in `.env` (config surface the
  operator already manages), surfaced read-only in the Antigravity status
  response so the UI can show when the copilot is running unprompted.
- Default: off. With the flag off, agy runs in its normal prompting mode;
  non-interactive contexts that cannot prompt will surface agy's error
  rather than silently escalating.
- Tests: arg-construction tests for both call sites, flag on and off.

**Size:** S. **Risk:** behavior change for copilot users who rely on
unprompted tool calls today — that is the point of §16 Q1/Q2.

### 4.2 Restrict query-string token acceptance

**Problem.** `authorizeRequest` accepts `?token=` on every route
(`apps/web/src/lib/authz.ts:101`). URLs are logged by servers and proxies,
kept in browser history, and leak via `Referer`; a bearer credential does
not belong there as a general mechanism. The acceptance exists because
`EventSource` cannot set headers — but only a handful of routes are consumed
that way (§2 lists the four client call sites).

**Proposal.**

1. Audit which routes the EventSource consumers actually hit (pods logs,
   terminal, waffle streams) and mark exactly those as query-token-eligible
   in the coverage test's route table.
2. Reject the query-string form everywhere else; the `Authorization` header remains the
   general path. Keep accepting the header on the eligible routes too, so
   nothing depends on the query form.
3. Extend the existing route-coverage test so the eligible set is explicit
   and any new route defaults to header-only.

**Size:** S–M. **Risk:** a stream consumer missed in the audit loses auth —
mitigated by the audit-first step and by keeping the local-board bypass
behavior unchanged.

### 4.3 Split Flux bootstrap from `flux:sync`

**Problem.** In `apps/web/src/app/api/flux/route.ts`, `bootstrap` (:80),
`reconcile` (:108), and `reconcile-all` (:94) all require only `flux:sync`
(:63). Bootstrapping installs Flux itself — cluster-level mutation of a
different order than reconciling an existing install — yet a principal
granted sync for day-to-day operations silently holds it.

**Proposal.** New `flux:bootstrap` permission for the `bootstrap` action
only; `reconcile`/`reconcile-all` stay on `flux:sync`. Add the permission to
the CASL model and role defaults (owner/admin hold it implicitly via their
existing wildcard-ish grants — verify per role), update the apps-page button
gating (`can('flux:bootstrap')` for the bootstrap action), and extend the
authz tests. Existing stored grants are unaffected; nobody loses `flux:sync`.

**Size:** S. **Decision:** §16 Q4 (separate permission vs requiring
`config:update` for bootstrap).

### 4.4 Minimum length for bootstrap passwords

**Problem.** PR #85 moved human-chosen passwords to scrypt, but both
bootstrap paths — the web init route and `vow authz init --password` — accept
any non-empty string. A one-character owner password behind a memory-hard
KDF is still a one-character password.

**Proposal.** Enforce a minimum of 12 characters at both entry points, with
the error surfaced before any store write. Generated tokens are unaffected.
No change to verification of existing stored credentials.

**Size:** S. **Decision:** §16 Q5 (the number).

---

## 5. WS2 — Platform & supply-chain guardrails

### 5.1 Enable the remaining GitHub security toggles

Verified disabled today (§2): secret-scanning **validity checks**,
secret-scanning **non-provider patterns**, and **Dependabot security
updates**. Validity checks in particular turn the existing gitleaks net
into verified-credential detection, and security updates make vulnerable
dependencies open PRs immediately instead of waiting for the Monday batch.

**Size:** XS. No decision needed unless you want one of them left off.

**Outcome (2026-10-15):** Dependabot security updates **enabled** via the
API. Validity checks and non-provider patterns **cannot be enabled via
the API on this repository** — three PATCH attempts silently left them
disabled, i.e. they are gated behind the GitHub Secret Protection /
Advanced Security entitlement for the DeployCoop org. Enabling them is a
billing/settings decision for the repo owner; the gitleaks CI job remains
the active secret-scanning net in the meantime.

### 5.2 Dependabot: widen the groups, revisit auto-merge

**Problem.** The npm groups cover `next`/`react` and tooling only. The
October flood — eslint, dotenv, postcss as separate PRs that had to be
consolidated by hand into PR #82 — came from packages outside every group.

**Proposal.**

- Add a catch-all group for the npm ecosystem so the weekly run produces
  one consolidated PR per ecosystem in the normal case (majors still
  excluded by the existing ignore rules).
- Revisit patch-level auto-merge, as the config's own header comment
  schedules ("revisit after the first month" — the config is from
  2026-10-03): enable auto-merge for patch-level grouped PRs; with the
  admin exemption they land once the six required checks are green, and
  minor/major updates keep the manual review gate.

**Size:** S. **Decision:** §16 Q6 (auto-merge scope).

### 5.3 CodeQL depth

- Switch the workflow's queries from the default suite to
  `security-and-quality` (adds maintainability/correctness queries whose
  findings arrive as non-blocking alerts until triaged).
- Add the `actions` language so the workflows themselves are analyzed.
- Pin third-party actions by full SHA (`actions/checkout`, 
  `github/codeql-action`) with Dependabot's github-actions ecosystem —
  already configured weekly — keeping them current. A required check should
  not ride on a mutable tag.

**Size:** S. Expect a fresh alert batch from the wider suite; triage it the
same way as PR #85 before promoting anything to required.

---

## 6. WS3 — Tests for the fragile surface

### 6.1 A permanent harness for the k3s shell scripts

**Problem.** The #81 `server_url` cluster (empty server file producing
`https://:6443`, bare IP:port double-appending the port, `ip route get`
field 7 yielding the uid `1000` as the node IP) shipped because the scripts
have no tests. In both the #83 sweep and the #85 triage, correctness was
established with throwaway harnesses in /tmp — stubbed `ip`/`curl` on PATH,
crafted `server_url` files — that were then discarded.

**Proposal.** Promote that harness pattern into the repo:

- `scripts/tests/` (or `src/tests/`) with a small runner that puts stub
  `ip`, `curl`, and `ssh` binaries on PATH and asserts on
  `k3s_add_node.sh --get-url` and the `install_k3s.sh` URL block across the
  case matrix that failed in #81: empty file, whitespace-only, bare IP,
  IP:port, trailing slash, CRLF, directly-connected route (uid trap),
  env override precedence.
- Wire it into CI as its own job; it needs no cluster and runs in seconds.
- Any future script that parses `ip route` output or a URL gets a case here
  before it merges.

**Size:** M (the case matrix is already designed; it needs productizing).

### 6.2 ShellCheck warning gate for touched scripts

**Problem.** ShellCheck is error-gated, with 70 warnings outstanding. New
warnings enter freely.

**Proposal.** CI fails a PR that *increases* the ShellCheck warning count
(baseline file committed alongside), while a burn-down of the existing 70
proceeds opportunistically — the #83 sweep removed 3 incidentally; the
classes are mostly SC2155/SC2034-style hygiene in scripts nobody has
touched since. A full one-shot cleanup is explicitly not proposed; several
warnings sit in install scripts where churn is riskier than the warning.

**Size:** S for the gate; burn-down unscoped.

---

## 7. WS4 — Lint ratchet & local test signal

### 7.1 Warning budgets that only shrink

**Proposal.** Add `--max-warnings <n>` to each package's CI lint step with
`n` set at today's counts (web 376, orchestrator 152, ink 13, githubio 1),
recorded in one place. Any PR that lowers a count lowers the budget in the
same PR. This converts a vague debt into a monotone ratchet without a
flag-day cleanup of ~530 warnings (predominantly `no-explicit-any`, which
in this codebase is often deliberate at system boundaries).

**Size:** S. **Decision:** §16 Q7 (ratchet vs scheduled burn-down).

### 7.2 Skip binary-dependent tests when the binary is absent

**Problem.** Three orchestrator tests (2 helm, 1 mkcert) hard-fail on any
machine without those binaries — including this sandbox — while CI installs
them and passes. A red local run therefore carries no information.

**Proposal.** Probe with the existing `commandExists` helper and `t.skip`
with a clear reason when the binary is missing; CI behavior unchanged (the
binaries are present, the tests run). Add a CI assertion that the skip
count for these suites is zero, so the skip can never silently swallow
them where they matter.

**Size:** S.

---

## 8. WS5 — Authz roadmap carry-overs

### 8.1 Context-scoped grants

Carried from the authz v1 follow-ups. Grants today scope by app/namespace;
the deferred item is scoping by *context* (e.g. a grant valid only for
read-class actions during a maintenance window, or only from the local
board). The CASL port's ability builder is the seam. This item is a design
sketch, not a specification: if it is wanted, it gets its own plan section
with the same §16 treatment before implementation.

**Size:** L (design-led). **Decision:** §16 Q8 covers whether to invest.

### 8.2 Session-cookie alternative to localStorage tokens

Carried from the authz v1 follow-ups, where localStorage was the accepted
v1 trade-off (token theft via XSS was mitigated by the app's own CSP
posture and the localhost boundary). An httpOnly, SameSite cookie session —
established by exchanging the principal token once — removes the token from
JS reach entirely. It touches the login flow, every `authorizeRequest`
consumer, the CLI's expectations, and the terminal/EventSource paths, so
it is the largest item in this plan. The PR #85 href-scheme fix reduced the
most plausible XSS vector into the page, which lowers the urgency but not
the structural benefit.

**Size:** L. **Decision:** §16 Q8 (do now, or defer again explicitly).

---

## 9. Sequencing & PR slicing

Suggested order — each step is an independent PR off current main, in the
#83–#85 style (verify locally, CI green, merge on review):

| Step | Item | Size | Depends on |
| --- | --- | --- | --- |
| 1 | §5.1 toggles (API only, no PR) | XS | — |
| 2 | §4.4 password floor | S | — |
| 3 | §4.3 `flux:bootstrap` split | S | — |
| 4 | §4.2 query-token restriction | S–M | audit inside the PR |
| 5 | §4.1 agy flag scoping | S | Q1/Q2 answers |
| 6 | §5.2 Dependabot groups + auto-merge | S | Q6 |
| 7 | §5.3 CodeQL depth + SHA pinning | S | a triage pass after |
| 8 | §6.1 shell-script harness in CI | M | — |
| 9 | §6.2 + §7.1 warning gates/ratchets | S | baselines from §2 |
| 10 | §7.2 binary-skip tests | S | — |
| 11 | §8.1 / §8.2 design follow-ups | L | Q8 |

Steps 1–4 are the highest value per line changed and can land in any order.

---

## 16. Decisions for the reviewer

Answer inline; work begins from these answers. A recommended default is
given for each — "take the defaults" is a complete answer.

**Answered 2026-10-15: the defaults were taken for Q1–Q8.** In short:
agy flag via env, default off, normal prompting mode (Q1/Q2); query-token
restricted to the audited stream routes (Q3); new `flux:bootstrap`
permission (Q4); 12-character password floor (Q5); patch-level Dependabot
auto-merge on, minor/major manual (Q6); warning ratchets (Q7); WS5
deferred explicitly (Q8).

- **Q1 — agy flag mechanism (§4.1).** Env setting (`VOW_AGY_SKIP_PERMISSIONS`)
  surfaced read-only in the status response.
  *Default: env setting, default off.*
- **Q2 — agy with the flag off (§4.1).** Run agy in its normal prompting
  mode and let non-interactive failures surface, or refuse to start copilot
  sessions that cannot prompt?
  *Default: normal prompting mode; surface the error.*
- **Q3 — Query-token scope (§4.2).** Restrict the query-string token form
  to the audited EventSource/stream routes only.
  *Default: restrict, header accepted everywhere including those routes.*
- **Q4 — Flux bootstrap (§4.3).** New `flux:bootstrap` permission, or
  require `config:update` for the bootstrap action?
  *Default: new `flux:bootstrap` permission (keeps role design coherent).*
- **Q5 — Password floor (§4.4).** Minimum length for bootstrap passwords
  on web init and CLI init.
  *Default: 12 characters.*
- **Q6 — Dependabot auto-merge (§5.2).** Enable auto-merge for patch-level
  grouped PRs (they land when the six required checks pass, under the admin
  exemption), keeping minor/major manual?
  *Default: yes for patch; no for minor/major.*
- **Q7 — Warning debt (§6.2, §7.1).** Ratchet budgets at today's counts, or
  schedule explicit burn-down work instead?
  *Default: ratchet; burn down opportunistically.*
- **Q8 — Roadmap items (§8).** Invest in context-scoped grants and/or the
  session-cookie alternative in this cycle, or defer both explicitly to a
  future plan?
  *Default: defer both; least-privilege tightening (§4) is this cycle's
  authz work.*

---

*Plan written 2026-10-15 against main `8feac5f`. All §2 figures were
measured from the live repository and the GitHub API on that date.*
