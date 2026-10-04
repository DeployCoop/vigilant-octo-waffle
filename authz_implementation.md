# Authorization (AuthZ) Implementation Plan — CASL for Vigilant Octo Waffle

**Status:** Draft for review
**Scope:** Web control plane (`apps/web`) + orchestrator (`packages/orchestrator`)
**Goal:** Replace the single shared `VOW_API_TOKEN` gate with a Paperclip-style authorization system — named principals, roles, scoped permission grants, and a central `decide()` that returns explainable allow/deny reasons — using [CASL](https://casl.js.org/) (`@casl/ability`) as the evaluation engine.
**Based on:** `main` @ `a2ee4b2`

> **Reviewers:** please read through and answer the questions in the final section (§16) inline, directly in this document.

---

## 1. Current state (what exists today)

| Control | Where | Notes |
|---|---|---|
| Localhost-only binding | `docker-compose.yaml` (`127.0.0.1:3000`) | Network-level control; anyone who reaches port 3000 is effectively trusted. |
| CSRF / Origin guard | `apps/web/src/middleware.ts` | Mutating `/api/*` requests only; blocks non-local origins / Host mismatch with 403. |
| Optional shared token | `apps/web/src/middleware.ts` | If `VOW_API_TOKEN` is set, mutating routes require `Authorization: Bearer <token>` or `x-vow-token`. One token, all-or-nothing, no identity, no read protection (GET routes are never checked). |
| Command allowlist | `packages/orchestrator/src/executor.ts` (`ALLOWED_EXECUTABLES`, `shell: false`) | Defense-in-depth at execution time. **Unchanged by this plan.** |

Gaps this plan closes:

- No concept of *who* is calling — no per-user identity, roles, or least-privilege.
- GET routes (including sensitive reads like pod logs, config, security scans) have no auth check at all when the token is unset, and only the shared-token check when set.
- `POST /api/argo/webhook` is a mutating route with no credential of its own; it relies entirely on the network/origin posture.
- No audit trail of who did what.
- The dashboard UI cannot adapt to the caller — every visitor sees every control (deploy, exec console, secrets).

## 2. Design principles (borrowed from Paperclip)

1. **One central decision point.** Every authorization question goes through a single `decide()` (Paperclip: `authorizationService.decide`). No ad-hoc `if (role === ...)` scattered in routes.
2. **Actors are explicit.** Each request resolves to a *principal* (human or service) before any check runs.
3. **Permission keys, not roles, at the check site.** Routes ask for `apps:deploy`, never "is admin". Roles are just bundles of keys, assigned to principals.
4. **Grants can be scoped.** A grant is global by default; it can be narrowed by app, namespace, or cluster context (Paperclip's `tasks:assign_scope` is the model).
5. **Decisions return reasons.** `allow_explicit_grant`, `deny_scope`, etc. — returned in API errors and written to the audit log. Debugging authz should never require reading source.
6. **Fail closed, degrade never.** Unrecognized scope/policy data denies. A broken grants store denies (when authz is enabled).
7. **Opt-in activation, zero-config default preserved.** Today's local UX (no token, localhost, everything works) stays the default. Authz activates when configured — mirroring how `VOW_API_TOKEN` already activates the token gate.
8. **Authorization runs before body parsing** on guarded routes (Paperclip hardened this after real bugs): authenticate → authorize → parse/validate.

## 3. Architecture overview

```
Request
  │
  ├─ apps/web/src/middleware.ts         (unchanged duties: origin/CSRF, legacy token gate during migration)
  │
  ├─ apps/web/src/lib/authz.ts          NEW — per-route guard helpers (Node runtime, can read the store)
  │     resolvePrincipal(req) → Principal | null
  │     requirePermission(req, key, scope?) → Decision   (throws 401/403 with reason)
  │
  ├─ packages/orchestrator/src/authz.ts NEW — the engine (pure, unit-testable, no Next.js deps)
  │     loadAuthzStore(root)            reads + zod-validates .vow/authz.json
  │     buildAbility(principal)         CASL AbilityBuilder → MongoAbility from role defaults + grants
  │     decide(store, principal, key, target) → { allowed, reason }
  │     hashToken / verifyToken         sha256 + timingSafeEqual
  │
  └─ UI: GET /api/authz/me returns principal + CASL packed rules →
         apps/web AbilityContext gates buttons/pages with the same rules the API enforces.
```

**Why the guard lives in route handlers, not middleware:** Next.js middleware runs in the Edge runtime and cannot read the filesystem store (`.vow/authz.json`). The current middleware only reads `process.env`. Authorization therefore happens in a small helper called at the top of each route handler (Node runtime), before `req.json()`. Middleware keeps its existing origin/CSRF role.

**Why CASL:** abilities are built from data (role defaults + grant rows) at request time, so the grants file is the source of truth and CASL is just the evaluator — the same split as Paperclip's service. CASL conditions express scoped grants natively, and packed rules serialize to the browser so the UI enforces the identical rule set.

## 4. Data model

### 4.1 Store location and format

- Path: `<projectRoot>/.vow/authz.json` (new `.vow/` state dir; add to `.gitignore`, create with mode `0600`).
- Validated with **zod** (already an orchestrator dependency) on every load; invalid file → authz enabled + fail closed, with a loud server log.
- Tokens are **never stored in plaintext**: only `sha256` hashes. A token is shown exactly once, at creation time (CLI, §8).

```jsonc
{
  "version": 1,
  "principals": [
    {
      "id": "p_josh",
      "name": "Josh",
      "kind": "human",              // "human" | "service"
      "role": "admin",              // role = bundle of default keys (§4.3)
      "tokenHash": "sha256:9f2c…",  // omitted for principals that authenticate another way later (OIDC)
      "disabled": false,
      "grants": [                   // explicit grants, on top of role defaults
        { "permission": "apps:deploy", "scope": { "appId": "harbor" } },
        { "permission": "k8s:exec",    "scope": { "namespace": "monitoring" } }
      ],
      "revocations": ["secrets:read"]  // optional: subtract a role-default key
    },
    {
      "id": "svc_argocd_webhook",
      "name": "ArgoCD webhook",
      "kind": "service",
      "role": "webhook",
      "tokenHash": "sha256:41ab…",
      "grants": [{ "permission": "webhook:argo" }]
    }
  ]
}
```

### 4.2 Permission catalog

Keys are `<resource>:<verb>`, defined as a const tuple in `authz.ts` (single source of truth, exported for the UI editor). Mapped to the actual route tree:

| Key | Guards (routes) | Sensitivity |
|---|---|---|
| `apps:read` | GET `/api/apps`, `/api/apps/[id]`, `/api/argo`, `/api/argo/diff`, `/api/flux` | low |
| `apps:deploy` | POST `/api/apps`, `/api/apps/custom`, app enable/disable + deploy actions in `/api/apps/[id]` | high |
| `apps:override` | override writes via `/api/apps/[id]` (`.argo_overrides/`, `.flux_overrides/`) | high |
| `argo:sync` | POST `/api/argo` | medium |
| `flux:sync` | POST `/api/flux` | medium |
| `webhook:argo` | POST `/api/argo/webhook` (service principals only) | medium |
| `cluster:read` | GET `/api/cluster`, `/api/cluster/contexts`, `/api/topology`, `/api/traces`, `/api/finops`, `/api/health`* | low |
| `cluster:manage` | POST/DELETE `/api/cluster`, context switching in `/api/cluster/contexts` | **critical** |
| `cluster:nodes:join` | `/api/cluster/k3s`, `/api/cluster/nodes` (incl. SSH provisioning) | **critical** |
| `config:read` | GET `/api/config`, `/api/config/doctor`, `/api/waffle/sources`, `/api/profiles` (GET) | medium (config can embed secrets) |
| `config:update` | POST/PATCH `/api/config`, `/api/profiles` writes | high |
| `k8s:read` | `/api/k8s/pods`, `/api/k8s/metrics` | low |
| `k8s:logs:read` | `/api/k8s/logs` | medium (logs leak secrets) |
| `k8s:exec` | `/api/k8s/exec` | **critical** (pod exec ≈ host root via docker.sock adjacency) |
| `tasks:read` | GET `/api/tasks`, `/api/tasks/stream`, `/api/waffle`, `/api/waffle/stream` | low |
| `tasks:run` | `/api/tasks/run`, `/api/waffle/run`, `/api/waffle/abort`, `/api/waffle/sync`, `/api/antigravity` (+stream) | high (drives `./up`, cluster actions) |
| `data:query` | `/api/data/sql`, `/api/data/s3` | high |
| `remote:exec` | `/api/remote` (SSH to nodes) | **critical** |
| `secrets:read` | `/api/security` secret views, secret values in config responses | **critical** |
| `security:read` | GET `/api/security` (scan results, redacted) | medium |
| `backups:manage` | `/api/backups` | high |
| `chaos:run` | `/api/chaos` | high |
| `dns:update` | `/api/dns` | medium |
| `export:run` | `/api/export` | medium |
| `helm:manage` | `/api/helm` | high |
| `namespaces:manage` | `/api/namespaces`, `/api/namespaces/sync` | high |
| `network:manage` | `/api/network` | medium |
| `rollouts:manage` | `/api/rollouts` | medium |
| `storage:manage` | `/api/storage` | high |
| `builder:run` | `/api/builder` | medium |
| `ai:diagnose` | `/api/ai/diagnose` | low |
| `system:manage` | `/api/system` mutations | high |
| `users:manage_permissions` | future `/api/authz/*` admin routes (edit principals/grants) | **critical** |

\* `/api/health` GET stays unauthenticated even when authz is on (load-balancer/uptime checks); it returns no sensitive detail today — keep it that way.

Final per-method mapping for every handler is confirmed during PR 3 (§12) by reading each `route.ts`; the table above is the contract the mapping must satisfy.

### 4.3 Roles (default key bundles)

Mirrors Paperclip's role defaults (owner/admin ≈ everything, operator = operational subset, viewer = read-only):

| Role | Default keys |
|---|---|
| `owner` | `manage all` (CASL wildcard) — includes `users:manage_permissions`. The store refuses to disable/remove the last active owner (Paperclip does the same for last-owner demotion). |
| `admin` | Everything except `users:manage_permissions`. |
| `operator` | `apps:read`, `apps:deploy`, `argo:sync`, `flux:sync`, `cluster:read`, `config:read`, `k8s:read`, `k8s:logs:read`, `tasks:read`, `tasks:run`, `namespaces:manage`, `rollouts:manage`, `helm:manage`, `backups:manage`, `security:read`, plus read paths under `system:manage` resources. **Not:** `k8s:exec`, `remote:exec`, `secrets:read`, `config:update`, `cluster:manage`, `cluster:nodes:join`, `chaos:run`, `data:query`. |
| `viewer` | Read keys only: `apps:read`, `cluster:read`, `config:read`, `k8s:read`, `tasks:read`, `security:read`. |
| `webhook` | No defaults; grants only (used by service principals). |

### 4.4 Scoped grants

A grant without `scope` is global (Paperclip: company-wide). Scope fields (all optional, ANDed):

```ts
interface GrantScope {
  appId?: string;        // APP_CATALOG id, e.g. "harbor"
  namespace?: string;    // k8s namespace
  context?: string;      // kubeconfig context name (the VOW analogue of Paperclip's company boundary)
}
```

CASL encoding: each grant becomes a rule `can(permission, subject, conditions)` where scope fields become Mongo-style conditions matched against a target object the route supplies, e.g. `decide(..., 'apps:deploy', { kind: 'App', appId: 'harbor', namespace: 'harbor', context: 'kind-vow' })`. A scoped grant used with an unscoped check (route supplies no target) **denies with `deny_scope`** — routes for scoped keys must always pass a target. This mirrors Paperclip's rule that `tasks:assign_scope` requires a structured constraint.

## 5. The decision engine (`packages/orchestrator/src/authz.ts`)

```ts
export type DecisionReason =
  | 'allow_authz_disabled'      // no store / VOW_AUTHZ unset → today's behavior
  | 'allow_local_board'         // bootstrap only: store exists, zero principals, localhost request (§7)
  | 'allow_role_default'        // key came from the principal's role bundle
  | 'allow_explicit_grant'      // matched a grants[] entry
  | 'allow_owner'               // owner wildcard
  | 'deny_unauthenticated'      // authz on, no/unknown token
  | 'deny_disabled_principal'
  | 'deny_missing_grant'        // authenticated, but no role default or grant covers the key
  | 'deny_scope'                // a grant exists but its scope doesn't cover the target
  | 'deny_revoked'              // key subtracted via revocations[]
  | 'deny_store_invalid';       // store failed validation → fail closed

export interface Decision { allowed: boolean; reason: DecisionReason; principalId?: string }

export function decide(
  store: AuthzStore,
  principal: Principal | null,
  permission: PermissionKey,
  target?: AuthzTarget,
): Decision
```

Implementation notes:

- `buildAbility(principal)` uses `AbilityBuilder` + `createMongoAbility` from `@casl/ability`. Role defaults first, then grants, then revocations as `cannot` rules (order matters; document and test this).
- To produce *reasons* (CASL only answers boolean), `decide()` doesn't just call `ability.can(...)`: it walks the principal's role bundle, then grants, checking each layer so it can report *which* layer allowed or why none did. CASL remains the evaluator for the scope/condition matching inside each layer. (Alternative considered: single `ability.can` + post-hoc explanation pass. The layered walk is simpler to reason about and to test.)
- Token verification: `sha256(token)` compared against each principal's `tokenHash` with `crypto.timingSafeEqual`. Tokens are prefixed `vow_` + 32 random bytes, base64url — greppable in logs/leaks like GitHub PATs.
- Store loading is cached in-memory with mtime invalidation (routes are `force-dynamic`; avoid re-reading the file per request, but pick up edits without restart — the Config Studio editor writes through the same module).
- Pure functions, no I/O beyond the store loader → unit-testable with the existing `node --test` setup.

## 6. Web integration (`apps/web`)

### 6.1 Guard helper — `apps/web/src/lib/authz.ts`

```ts
import { loadAuthzStore, resolvePrincipal, decide } from '@vow/orchestrator';

export async function requirePermission(
  req: Request,
  permission: PermissionKey,
  target?: AuthzTarget,
): Promise<Principal>   // throws AuthzError(401|403, reason)
```

Plus a `withAuthz(handler, permission, targetFromReq?)` wrapper to keep route diffs to ~3 lines:

```ts
// apps/web/src/app/api/k8s/exec/route.ts (after)
export const POST = withAuthz('k8s:exec', (req, body) => ({ kind: 'Pod', namespace: body.namespace }),
  async (req, principal) => { /* existing body, unchanged */ });
```

Rules:

- Guard runs **before** `req.json()` wherever the target doesn't depend on the body. Where the target *does* depend on the body (e.g. exec namespace), parse only the minimal scope fields first, authorize, then proceed — and document the exception.
- Streaming routes (`tasks/stream`, `waffle/stream`, `antigravity/stream`) authorize before opening the stream; the decision is logged once at connect.
- Error shape matches existing routes: `{ error: string, reason: DecisionReason }` with 401 for `deny_unauthenticated`, 403 otherwise.

### 6.2 Middleware changes

- Keep origin/CSRF exactly as-is.
- Legacy `VOW_API_TOKEN` gate stays during migration (PR 2–3) and is then redefined: if set, it is treated as a bootstrap **owner** token (§7). Remove the dual-header logic once the store exists.
- Matcher unchanged (`/api/:path*`).

### 6.3 New API surface

| Route | Purpose | Guard |
|---|---|---|
| `GET /api/authz/me` | Current principal + packed CASL rules for UI gating | any authenticated principal |
| `GET /api/authz/principals` | List principals + grants (hashes never returned) | `users:manage_permissions` |
| `POST /api/authz/principals` | Create principal; returns plaintext token **once** | `users:manage_permissions` |
| `PATCH /api/authz/principals/[id]` | Replace role/grants/revocations, disable/enable (full-set replace, like Paperclip's role-and-grants route — no partial merges) | `users:manage_permissions` |
| `DELETE /api/authz/principals/[id]` | Remove principal (refuses last owner) | `users:manage_permissions` |
| `POST /api/authz/principals/[id]/rotate` | New token, old hash invalidated | `users:manage_permissions` |

## 7. Activation & migration

Authz is **enabled** when any of: `.vow/authz.json` exists, or `VOW_AUTHZ=on`. Otherwise behavior is byte-for-byte today's.

Migration path for existing `VOW_API_TOKEN` users:

1. On first boot with a token set and no store, the server logs a deprecation notice: the token now acts as an owner-equivalent bootstrap credential.
2. `pnpm vow authz init` (CLI, §8) creates the store, imports the env token's hash as the first `owner` principal ("bootstrap-owner"), and prints next steps.
3. **Bootstrap mode:** if a store exists but has zero principals, localhost requests are treated as implicit owner (`allow_local_board`) so you can never lock yourself out before creating the first principal — the same trick Paperclip uses for its local implicit board. As soon as one principal exists, bootstrap mode ends permanently.
4. README "Security Model" section is rewritten to document the new model and the migration.

## 8. CLI (`packages/orchestrator/src/authz-cli.ts` or `scripts/`)

Thin wrappers over the store module, run via `pnpm vow authz …` (wire into root `package.json` scripts):

- `authz init` — create store (+ optional `--import-env-token`).
- `authz add <name> --role operator` — prints the token once.
- `authz list`, `authz revoke <id>`, `authz rotate <id>`.
- `authz check <token> <permission> [--app harbor]` — dry-run `decide()` for debugging; prints the reason. (This is the "why was I denied?" tool.)

## 9. UI integration (`apps/web`)

- `GET /api/authz/me` → client builds a `MongoAbility` from packed rules; `AbilityContext` + a small `useCan(permission, target?)` hook.
- Gate high-impact controls first: pod **Exec** console, **Remote/SSH**, **SQL/S3 query**, **Chaos**, cluster delete / node-join, secret values, deploy buttons. Hidden vs disabled: hide when the principal could never have the key in this view; disable with a tooltip naming the missing key when context-dependent (scope).
- New **Settings → Access** page (Config Studio pattern): principal list, role picker, grant editor (permission multi-select + optional app/namespace/context scope), create/rotate/disable flows. All calls go to §6.3 routes.
- When authz is disabled, the page shows a single "Enable authorization" action that runs `init` server-side; the rest of the UI renders ungated (`allow_authz_disabled`).

## 10. Audit logging

- Every `decide()` for a **mutating** permission (and every deny, read or write) appends one JSON line to `<projectRoot>/.vow/audit.log`: `{ ts, principalId, permission, target, allowed, reason, route }`.
- Written from the web layer (the orchestrator module exposes `formatAuditEntry`; the caller owns I/O so the engine stays pure).
- Surfaced read-only in the Access page (last N entries) via `GET /api/authz/audit` (`users:manage_permissions`). Rotation/size caps: out of scope for phase 1; note as follow-up.

## 11. Testing plan

Orchestrator (`packages/orchestrator/src/__tests__/authz.test.ts`, runs under existing `node --test dist/__tests__/*.test.js`):

- Role bundles: each role's default keys match §4.3 exactly (snapshot the catalog so accidental widening fails CI).
- Grants: global grant allows; scoped grant allows matching target, denies non-matching with `deny_scope`; scoped grant + no target → `deny_scope`.
- Revocations beat role defaults and grants (`deny_revoked`) — rule-ordering regression test.
- Owner wildcard allows everything except when principal disabled.
- Last-owner protection in store mutations.
- Token hashing/verification: correct token passes, wrong token `deny_unauthenticated`, disabled principal `deny_disabled_principal`; timing-safe compare used.
- Store validation: malformed JSON / bad schema → `deny_store_invalid` (fail closed), never throws into a route.
- Bootstrap: empty store + localhost → `allow_local_board`; store with ≥1 principal → no implicit board.
- Catalog integrity: every permission key in the catalog is referenced by at least one role or is admin/webhook-only (guards against typos drifting between engine and routes).

Web:

- Guard helper unit tests (mock store): 401 vs 403 mapping, reason propagation, guard-before-body-parse ordering.
- Extend the placeholder `apps/web` test script with at least the guard tests (or document manual verification per route group if test infra is deferred — see Q7).
- Manual E2E checklist per PR: token-less local flow unchanged with authz off; with authz on — viewer can read but not deploy (403 + `deny_missing_grant` in response and audit log), operator scoped to `harbor` cannot deploy `nextcloud`, webhook service token can hit `/api/argo/webhook` and nothing else.

## 12. Rollout — PR breakdown

| PR | Scope | Behavior change |
|---|---|---|
| **PR 1 — Engine** | `@casl/ability` dep in orchestrator; `authz.ts` (types, catalog, roles, store load/validate, `decide()`, token utils); exports in `index.ts`; full unit tests (§11). | None. |
| **PR 2 — Guard + critical routes** | `apps/web/src/lib/authz.ts` (`requirePermission`/`withAuthz`), `/api/authz/me`; guards on critical keys only: `k8s:exec`, `remote:exec`, `data:query`, `secrets:read`, `cluster:manage`, `cluster:nodes:join`, `chaos:run`, webhook service token. CLI `init`/`add`/`list`. | Only when authz enabled. |
| **PR 3 — Full route coverage** | Guard every route per §4.2 mapping; `VOW_API_TOKEN` bootstrap-owner semantics + deprecation log; audit logging. | Only when authz enabled. |
| **PR 4 — UI** | Ability context + gating of high-impact controls; Settings → Access page (principals/grants editor, audit view) + `/api/authz/*` admin routes. | UI only; APIs from PR 3 already enforce. |
| **PR 5 — Docs & polish** | README security section rewrite, `ARCHITECTURE.md` authz section, `.env.example` notes, `.gitignore` for `.vow/`, ROADMAP entry. | None. |

Estimated effort: PR 1 ≈ 1 day, PR 2 ≈ 1 day, PR 3 ≈ 1–2 days (48 route files, mostly mechanical), PR 4 ≈ 2 days, PR 5 ≈ 0.5 day.

## 13. Security considerations

- **Hash-only token storage**, `0600` on `authz.json` and `audit.log`; `.vow/` gitignored and excluded from export bundles (`/api/export` must not ship it — add an explicit exclusion + test).
- **Fail closed** on any store error when enabled; fail *loud* in logs so a broken store is visible rather than silently open.
- The executor allowlist and `shell: false` stay untouched — authz decides *who may ask*, the allowlist decides *what may run*. Both must pass.
- GET routes becoming authenticated (when authz is on) is a **breaking change** for script users; mitigate with service principals + the `authz check` CLI, and call it out in release notes.
- Timing attacks: constant-time token compare; identical 401 body for unknown vs malformed tokens.
- Scope values (`appId`, `namespace`, `context`) are validated against live catalogs where cheap (APP_CATALOG for `appId`) at grant-write time, so a typo'd scope fails at creation, not silently at check time (`deny_scope` forever).

## 14. Alternatives considered

- **node-casbin:** file policies + RBAC-with-domains ≈ context scoping. Rejected as primary: boolean-only answers make Paperclip-style reasons a second system we'd build anyway, and dynamic per-principal grant editing (the Access UI) fights the policy-file model. Revisit if policies ever become static, GitOps-managed files.
- **Cerbos:** YAML policies are very on-brand for this repo, but the PDP is a separate process (or Hub-generated embedded bundles), which cuts against the local-first, single-container posture. Revisit if VOW grows a multi-instance deployment story.
- **Hand-rolled:** the catalog + roles are simple enough that a bespoke checker is ~150 lines — but scoped conditions, UI rule serialization, and future field-level rules are exactly what CASL already solves; hand-rolling re-invents it worse.

## 15. Relationship to Paperclip's model (reference)

| Paperclip | VOW equivalent |
|---|---|
| Company (tenant boundary) | Kubeconfig `context` scope on grants |
| Board user | Human principal |
| Agent JWT | Service principal (e.g. webhook, CI) |
| Instance admin | `owner` role |
| Local implicit board (`allow_local_board`) | Bootstrap mode (§7) |
| `principalPermissionGrants` rows | `grants[]` entries in `.vow/authz.json` |
| Permission keys (`tasks:assign`, …) | §4.2 catalog |
| `tasks:assign_scope` (scoped grant) | `scope` on any grant (§4.4) |
| `authorizationService.decide` + reason codes | `decide()` + `DecisionReason` (§5) |
| Protected-agent policies fail closed | Unknown scope/policy data fails closed (§2.6) |

---

## 16. Questions for Josh & reviewers — please answer inline

Write your answer under each question (edit this file in the PR). "No opinion / your call" is a valid answer.

### Q1. Browser token handling (phase 1)
Phase 1 assumes the dashboard stores the principal token in `localStorage` and sends it as a Bearer token, same as the CLI. Alternative: an httpOnly cookie session set via a login endpoint (better XSS posture, more moving parts).
**Which do you prefer for v1?**

**Answer:**
localStorage is fine

### Q2. Is `context` scoping worth it in v1?
VOW typically manages one cluster per install, so scoping grants by kubeconfig context may be dead weight in v1. The field costs little in the schema, but the UI and tests grow. **Keep context scoping in v1, or app/namespace only?**

**Answer:**
app/namespace only

### Q3. Store format: JSON or YAML?
The plan uses `.vow/authz.json` (easy zod validation, machine-written). This repo is YAML-native and humans may want to hand-edit grants. **JSON (machine-managed via UI/CLI only) or YAML (hand-editable, diff-friendly)?**

**Answer:**
yaml

### Q4. OIDC / Keycloak in scope?
The app catalog already ships Keycloak. Principals are modeled so an OIDC identity can map to a principal without a token hash. **Is OIDC login a v1 requirement, a planned v2, or explicitly out of scope?**

**Answer:**
OIDC is a v1 requirement

### Q5. Secret redaction split
Splitting `config:read` from `secrets:read` means principals without `secrets:read` must get redacted config/secret responses (Paperclip redacts peer agent config the same way). This touches `config.ts` / `secrets.ts` response shaping in PR 3. **Confirm the redaction list/behavior you want, or should `config:read` imply full config visibility in v1?**

**Answer:**
yes lets implement the redactions

### Q6. GET-route authentication
When authz is on, this plan authenticates reads too (today GETs are open). That is a breaking change for scripts/curl users who currently read freely with only the network posture protecting them. **Reads authenticated when authz is on — yes, or should reads stay open unless a `VOW_AUTHZ_PROTECT_READS` flag is set?**

**Answer:**
yes reads authenticate when authz is on

### Q7. Web test infrastructure
`apps/web` currently has a placeholder test script (`echo 'Web smoke tests: ok'`). PR 2 wants guard tests. **Add a real test runner (vitest) to `apps/web` as part of PR 2, or keep web verification manual for now?**

**Answer:**
add a real test runner to apps/web

### Q8. Role set — is `operator` split correctly?
The plan keeps `k8s:exec`, `remote:exec`, `secrets:read`, `config:update`, `cluster:manage`, `cluster:nodes:join`, `chaos:run`, and `data:query` out of the default `operator` bundle. **Any of those belong in operator by default for your team's workflow — or any operator key that should be removed?**

**Answer:**
lets stick with the recommendation here

### Q9. PR sequencing
The plan ships engine-first (PR 1) with zero behavior change, then critical routes, then full coverage. **Happy with that order, or should the webhook service token (arguably an open hole today) jump the queue as a standalone fix first?**

**Answer:**
yes lets begin with the webhook service token and test based around that to ensure we dont break it going forward
