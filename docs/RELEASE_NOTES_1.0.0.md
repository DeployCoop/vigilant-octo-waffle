<!-- DRAFT — prepared by Plan III PR-18. The v1.0.0 tag and the first GitHub
Release have NOT been created yet: creating them is a publication action
reserved for Josh's explicit tap. When he gives the word, run (from main,
after PR-18 merges):

  git tag -a v1.0.0 -m "v1.0.0"
  git push origin v1.0.0
  gh release create v1.0.0 --title "v1.0.0" --notes-file docs/RELEASE_NOTES_1.0.0.md

This comment is invisible in the rendered release notes. -->

# v1.0.0 — first stable release

Vigilant Octo Waffle 1.0.0 is the first release whose version matches the
manifests: every workspace package has carried `1.0.0` since early
development, while the only tag was v0.1.0 and no GitHub Release existed.
This release closes that gap. It is the local Kubernetes control plane —
KinD/K3s clusters templated from YAML, driven by ArgoCD/FluxCD, with a
Next.js web console and an Ink TUI — hardened through three improvement
plans.

## Authorization and sessions

- CASL authorization model: a 33-permission catalog with
  owner/admin/operator/viewer/webhook role bundles, per-principal tokens
  and OIDC principals resolved against a YAML store at `.vow/authz.yaml`
  (hashed tokens, shown once, last-owner invariants protected), guards on
  every API route, secret redaction split (`config:read` vs
  `secrets:read`), and a JSONL audit log at `.vow/audit.log`.
- Hashed server-side sessions behind an httpOnly SameSite=Strict cookie
  (12h absolute TTL; the browser stores nothing), `?token=` streams
  retired, `Grant.context` enforced server-side, and principal edits or
  token rotation revoking sessions.
- Settings → Access admin UI with ability-gated controls, including
  session listing and revocation, and the `vow authz` CLI
  (init/add/list/revoke/rotate/check, plus `sessions` and
  `revoke-sessions`).

## Security hardening

- Bug-sweep remediation: argv-only process execution, the k3s join-token
  leak, authz init takeover, executor lifecycle, and server_url parsing.
- Three CodeQL triage rounds to zero open alerts: storage-route shell
  injection, .env escaping, scrypt passwords, SSRF confinement, ReDoS
  rewrites, enabler-name validation, and the waffle build-path
  confinement plus git argument-injection guards.
- Supply-chain pins: SHA-pinned GitHub Actions, checksum-verified
  curl-installed binaries (kubectl, kind, helm, yq, mkcert, ShellCheck,
  gitleaks), a digest-pinned Node 24 Docker base, and Dependabot
  catch-all groups with patch-only auto-merge.
- A pruned, non-root Docker runner image (production-only dependencies,
  `USER node`), with a CI step that boots the image and proves it
  answers HTTP.

## Reliability and code health

- Bash↔TypeScript parity contract tests (which fixed five real engine
  bugs), a shell regression harness, ShellCheck and lint ratchets with
  budgets that only shrink, and a root `pnpm check` script that mirrors
  all seven required CI checks locally.
- The 1,000-line rule (warn-only in CI) and the splits it drove: the
  K3sOpsModal, waffle runner, storage page, and antigravity page, each
  split along its natural seams with byte-verbatim motion.
- A shared `tsconfig.base.json` across all four TypeScript packages.
  The `noUncheckedIndexedAccess` pilot on the orchestrator was measured
  (179 errors, dominated by possibly-undefined index reads) and
  deliberately deferred — recorded in the PR body, not forced with
  assertions.

## Compatibility

- Node 24 everywhere (`.nvmrc`, `engines`, digest-pinned Docker base).
- Localhost-only binding with origin/CSRF middleware and an optional
  shared `VOW_API_TOKEN`.
