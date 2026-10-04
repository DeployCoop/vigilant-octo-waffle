# Bash ↔ TypeScript parity fixtures

The bash runners in `src/` and the TypeScript engine in
`packages/orchestrator` implement the same manifest-templating
behavior twice. The tests in `../parity.test.ts` run **both** engines
over each fixture project here and require canonical agreement (YAML
parsed, keys sorted recursively) plus a match against the fixture's
golden `expected.yaml`.

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

The bash side runs the real `argoRunner` with a stub `argocd` binary
on PATH that captures the manifest it would have applied — the exact
bytes the bash pipeline would deploy.

## Updating goldens

```sh
cd packages/orchestrator
VOW_PARITY_UPDATE=1 node --test dist/__tests__/parity.test.js
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

Known *intentional* asymmetry, encoded in `argo-edge`: the TS engine
supports `${VAR:-default}` expansion in its default mode, but GNU
envsubst never expands parameter-expansion forms in any mode — so in
manifest preparation (parity mode) those forms stay literal on both
engines. No repository manifest uses them.
