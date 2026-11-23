# Multica

Multica is an AI-native task-management platform: issues, docs, and chat where
AI agents are first-class assignees, not bolt-ons. Each person runs the
`multica` CLI and an agent daemon on their own machine; the daemon detects
installed agent CLIs (Claude Code, Antigravity, Codex, OpenCode, Hermes, Pi,
and others) and executes tasks when agents are assigned work.

## What VOW deploys

The published Helm chart (`oci://ghcr.io/multica-ai/charts/multica`,
pinned to chart version **0.11.1** — released chart versions strip the
leading `v` from the Git tag) in `argo/multica/argocd.yaml`:

- `multica-backend` — Go REST API + WebSocket server
- `multica-frontend` — Next.js standalone server
- `multica-postgres` — bundled `pgvector/pgvector:pg17` with a 10 Gi PVC
  (the backend runs its own migrations on startup; a cold start can sit
  `Running` but not `Ready` for a few minutes)
- a 5 Gi uploads PVC for the backend (used only when no S3 bucket is
  configured)

Live doc co-editing is **not shipped**: the 0.11.1 chart has no collab
service and no `featureFlags` values, so there is nothing to enable here.
If a later chart release adds it, that is a separate decision.

## Before deploying: the secret

The chart does **not** manage its Secret — it reads one by name. VOW
creates it as a pre-step: `deployCatalogApp` applies
`init/pre-multica/secret.yaml` before the ArgoCD Application, and the
values come from `src/default.env`:

- `THIS_MULTICA_JWT_SECRET` / `THIS_MULTICA_POSTGRES_PASSWORD` — generated
  at cluster setup (`$(< /dev/random …)` in `default.env`, evaluated by
  the shell; the operator's `.env` carries the real values into the web
  deploy path). Never commit real values.
- `THIS_MULTICA_RESEND_API_KEY` / `THIS_MULTICA_GOOGLE_CLIENT_SECRET` /
  `THIS_MULTICA_CLOUDFRONT_PRIVATE_KEY` — empty by default; fill in only
  if the operator configures that integration.

If the Secret is missing or the two required keys are empty, the backend
cannot start — that is a fail-closed upstream requirement, not a VOW bug.
To rotate or add a key later without redeploying, patch the Secret
(`kubectl -n ${THIS_NAMESPACE} patch secret multica-secrets …`) and
restart the backend.

`MULTICA_DEV_VERIFICATION_CODE` is deliberately **not** provisioned: a
fixed dev verification code would let anyone who knows an email address
log in. Do not set it on a reachable instance.

## Hosts

Two Ingresses, both TLS via the cluster issuer (`multica-tls`):

- Web UI: `https://${THIS_MULTICA_HOST}.${THIS_DOMAIN}`
- API: `https://api.${THIS_MULTICA_HOST}.${THIS_DOMAIN}`

(`THIS_MULTICA_HOST` defaults to `multica` in `src/default.env`.)

## Logging in

- **Recommended:** set `THIS_MULTICA_RESEND_API_KEY` so real verification
  codes are emailed.
- **Without email:** the verification code is printed to the backend pod
  logs (`kubectl -n ${THIS_NAMESPACE} logs deploy/multica-backend |
  grep "Verification code"`).
- Signup is left at the chart default (`allowSignup: true`). Locking it
  down is an operator decision, not something VOW changes silently: set
  `backend.config.disableWorkspaceCreation: true` (bootstrap the first
  workspace first, then flip it so users can only join by invitation) or
  `backend.config.workspaceCreationAllowedEmails` to an allowlist, via an
  Argo override.

## Telemetry

Multica's first-party anonymous deployment telemetry is **off** in the
VOW values (`backend.config.doNotTrack: "1"`). VOW is localhost-only;
nothing phones home.

## The agent daemon (out of scope for the cluster deploy)

The daemon runs on the operator's own machine, not in the cluster. After
the server is up, on each machine that should run agents:

```
multica setup self-host \
  --server-url https://api.${THIS_MULTICA_HOST}.${THIS_DOMAIN} \
  --app-url https://${THIS_MULTICA_HOST}.${THIS_DOMAIN}
```

That machine needs the same DNS/hosts entries for the two hosts, the
`multica` CLI, and at least one agent CLI on `PATH`. VOW deploys the
control plane only.

## Teardown

```
helm -n ${THIS_NAMESPACE} uninstall multica   # keeps PVCs and the Secret
kubectl delete namespace ${THIS_NAMESPACE}    # wipes everything (only if
                                              # the namespace holds nothing else)
```
