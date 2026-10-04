# Bash ↔ TypeScript parity fixtures

The bash runners in `src/` and the TypeScript engine in
`packages/orchestrator` implement the same manifest-templating and
deployment behavior twice. The tests in `../parity.test.ts` run
**both** engines over each fixture project here and require canonical
agreement (YAML parsed, keys sorted recursively) plus a match against
the fixture's golden `expected.yaml`.

## Pairs covered

- **Pair 1 — ArgoCD manifest preparation** (`argo-*` fixtures):
  `ArgoManager.prepareAppManifest` vs `src/argoRunner.bash`.
- **Pair 2 — ArgoCD deploy invocation** (reuses `argo-drupal`): the
  `argocd app create` argument list from `ArgoManager.deployApp` vs
  the runner's, captured by the same stub on both sides (the `-f`
  path is normalized away; the file contents must also agree).
- **Pair 3 — Flux manifest preparation** (`flux-*` fixtures):
  `FluxManager.prepareAppManifest` vs `src/fluxRunner.bash`, covering
  native flux manifests and both argo→flux synthesis branches
  (HelmRelease and Kustomization).

## Layout

Each case directory holds:

- `case.json` — `{ app, description }`
- `project/` — the fixture project tree (`argo/<app>/argocd.yaml`,
  optional `.argo_overrides/`, `.env`). At test time it is copied to a
  temp dir and the repository's real `src/` is symlinked in, so both
  engines read the real `src/default.env` (the envsubst allowlist
  source and the TS config defaults) and the real bash runner scripts.
- `expected.yaml` — golden canonical output. Regenerate with
  `VOW_PARITY_UPDATE=1` (see below) and review the diff like code.

The bash side runs the real runner with stub `argocd`/`kubectl`
binaries on PATH that capture the manifest it would have applied —
the exact bytes the bash pipeline would deploy.

## Updating goldens

```sh
pnpm --filter @vow/orchestrator test:parity:update
```

(requires `yq` and `envsubst` on PATH; CI installs both and sets
`VOW_PARITY_REQUIRED=1` so a missing tool fails instead of skipping.)

## Divergence policy

Parity means *agreement*, not two goldens. If the engines disagree,
one of them is wrong: fix the engine (or the shared input), do not
split the fixture into per-engine expectations. The first cases landed
with two real bugs found this way:

1. **TS blanked literal `$` content.** `substituteVariables` replaced
   every unknown `$VAR` with an empty string, corrupting manifests
   that embed PHP (`$settings[...]`), shell snippets, or generated
   passwords containing `$XX` sequences. Fixed by the `preserveUnknown`
   option (envsubst-allowlist semantics) used by `ArgoManager` and
   `FluxManager` manifest preparation.
2. **Bash dropped one variable from the allowlist.**
   `src/default.env` defined `THIS_VELERO_DEFAULTED` without the
   quotes every other line has; the allowlist generator's parser
   requires the quoted `: "${VAR:=...}"` form, so the variable was
   silently never substituted by the bash pipeline. Fixed by quoting
   that line.

Pairs 2–3 added three more:

3. **TS dropped the deploy-time argocd flags.** `deployApp` omitted
   the runner's `$ARGOCD_CREATE_APP_EXTRA_ARGS` (default `--insecure`)
   and `--loglevel $THIS_ARGO_LOG_LEVEL`; against a self-signed local
   ArgoCD the dashboard deploy could fail TLS where the bash deploy
   succeeded. `deployApp` now builds the identical argv.
4. **Synthesized Flux manifests shipped a literal placeholder.**
   Both engines generated `interval: ${THIS_FLUX_INTERVAL:-5m}` /
   `branch: ${THIS_FLUX_BRANCH:-main}` text, but envsubst never
   expands parameter-expansion forms — so the bash pipeline applied
   manifests with that literal string where a duration/branch belongs.
   Both engines now resolve interval/branch at generation time from
   the project config (bash expands them in the heredoc; TS resolves
   in `synthesizeFluxFromArgo` via `prepareAppManifest`).
5. **TS dropped chart values containing duplicate keys.** Drupal's
   vendored values repeat a top-level key (`solr:`); the JS YAML
   parser rejects duplicates by default, the error was swallowed,
   and the HelmRelease shipped with `values: {}`. The synthesis
   parses now use `uniqueKeys: false` (yq's last-wins tolerance).

Known *intentional* asymmetry, encoded in `argo-edge`: the TS engine
supports `${VAR:-default}` expansion in its default mode, but GNU
envsubst never expands parameter-expansion forms in any mode — so in
manifest preparation (parity mode) those forms stay literal on both
engines. No repository manifest uses them.

Known uncovered edge: a `.flux_overrides` merge against a
**multi-document** native flux manifest — the TS merge path parses
single documents and throws, while `merge2yaml` (yq) streams. No
fixture covers it yet; treat as drift if it ever occurs in practice.

