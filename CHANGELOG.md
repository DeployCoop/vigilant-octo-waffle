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
