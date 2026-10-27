# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases are marked with annotated git tags (`vX.Y.Z`).

## [Unreleased]

### Added

- Repository improvements series (from `improvements_implementation.md`):
  ESLint flat config, ShellCheck and gitleaks CI jobs, audit log rotation,
  bash↔TypeScript parity contract tests (which fixed five real engine
  bugs), a unified API error envelope with structured logging, persistent
  task records via `node:sqlite`, the first Ink CLI test suite, and
  decomposition of the four largest files behind barrels/composition —
  landing as PRs #32–#57.
- Improvements Plan II (PR #86) and its WS1 least-privilege tightening
  (PR #87): a 12-character password floor, the `flux:bootstrap`
  permission split, query-token path restriction, and
  `VOW_AGY_SKIP_PERMISSIONS` defaulting off.
- Plan II WS5 (PR #97): hashed server-side sessions behind an httpOnly
  SameSite=Strict cookie (12h absolute TTL, browser stores nothing),
  `?token=` streams retired, `Grant.context` enforced server-side in
  `decide()`, and principal edits/token rotation revoking sessions.
- Plan II WS3+WS4 (PR #94): the shell test harness (`scripts/tests/run.sh`),
  ShellCheck warning budget, lint budgets, and binary-skip test semantics.
- CodeQL depth (PRs #84, #88): the analysis workflow, the
  security-and-quality query suite, the actions analysis, and SHA-pinned
  GitHub Actions.

### Changed

- Dependabot catch-all groups plus patch-only auto-merge (PR #89).
- Routine grouped dependency maintenance (PRs #90–#92, #98–#100).

### Fixed

- Dependabot auto-merge approval flow (PRs #95, #96): first scoped to
  the arm-only approval restriction, then restored to automated approval
  once the organization toggle allowed Actions approvals.

### Security

- Bug-sweep remediation (PR #83): shell injection, authz holes,
  executor lifecycle, and server_url parsing.
- CodeQL triage remediation, round 1 (PR #85): storage-route shell
  injection, .env escaping, scrypt passwords, SSRF confinement, and
  ReDoS rewrites.
- CodeQL triage remediation, round 2 (PR #93): enabler-name validation —
  86 alerts triaged, 1 fixed in code, the other 85 dismissed with
  documented reasons.

## [0.1.0] - 2026-10-04

The first tagged release: the authorization rollout, CI, and runtime
alignment, on top of the pre-existing cluster templating engine, web
control plane, and Ink TUI.

### Added

- **CASL authorization model** (plan: `authz_implementation.md`, PRs
  #22–#27): a 33-permission catalog with owner/admin/operator/viewer/
  webhook role bundles in the orchestrator; per-principal tokens and
  OIDC principals resolved against a YAML store at `.vow/authz.yaml`
  (hashed tokens, shown once, last-owner invariants protected); guards
  on every API route with a coverage meta-test; secret redaction split
  (`config:read` vs `secrets:read`); JSONL audit log at `.vow/audit.log`;
  Settings → Access admin UI with ability-gated controls; `vow authz`
  CLI (init/add/list/revoke/rotate/check); a dedicated
  `VOW_WEBHOOK_TOKEN` service credential for the ArgoCD webhook.
- **CI** (PR #28): GitHub Actions — orchestrator + web tests, web/ink
  typechecks, production build — with branch protection on `main`
  requiring both checks.
- **Runtime alignment** (PR #30): Node 24 everywhere — `.nvmrc`,
  `engines` in all packages, digest-pinned `node:24` Docker base with a
  CI gate that builds the image and asserts its Node version.
- **Dependabot** (PR #31): grouped weekly updates for npm, Docker, and
  GitHub Actions, manually merged.
- Planning documents: `authz_implementation.md` (PR #21) and
  `improvements_implementation.md` (PR #29).

[Unreleased]: https://github.com/DeployCoop/vigilant-octo-waffle/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DeployCoop/vigilant-octo-waffle/releases/tag/v0.1.0
