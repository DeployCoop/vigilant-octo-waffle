# Contributing

## Development setup

- **Node 24** — the repo pins it in `.nvmrc` (`nvm use` picks it up) and in
  `engines` across all packages; CI and the shipped Docker image use the
  same version.
- **pnpm 11** — the exact version is pinned by the `packageManager` field in
  the root `package.json`. Install with `pnpm install --frozen-lockfile`.

## Running tests

Each package has its own suite; CI runs all of them.

| Package | Command |
| --- | --- |
| `packages/orchestrator` | `pnpm --filter @vow/orchestrator build && pnpm --filter @vow/orchestrator test` (compiles, then `node --test` on `dist`) |
| `apps/web` | `pnpm --filter @vow/web test` (vitest) and `pnpm --filter @vow/web typecheck` |
| `apps/ink` | `pnpm --filter @vow/ink build && pnpm --filter @vow/ink test` |

## CI and merging

- `main` is protected: pull requests are required, branches must be up to
  date, and the **Tests & typecheck** and **Production build** checks must
  pass. If a PR suddenly reports *no checks at all*, it has usually gone
  merge-conflicted — GitHub cannot build the test-merge commit, so rebase
  onto `main` first.
- New CI jobs start out **non-required** and are only promoted to required
  checks after they have run green on `main` at least once.
- Releases are annotated tags (`vX.Y.Z`) with notes kept in
  `CHANGELOG.md` (Keep-a-Changelog format) — add an entry under
  *Unreleased* with your change.

## A note on native dependencies (allowBuilds)

pnpm 11 refuses to install when a dependency's build script has no
recorded decision (`ERR_PNPM_IGNORED_BUILDS`). When you add a package
with a native build step, record it explicitly in `allowBuilds` in
`pnpm-workspace.yaml` — `true` if the build is needed (e.g. `esbuild`),
`false` if the package ships a prebuilt binding and the script is
unnecessary (e.g. `unrs-resolver`).

## Matrix

Join our [matrix](https://matrix.to/#/#vigilant-octo-waffle:matrix.org) to chat with us directly.

## Updating charts in the urban-disco repo

Visit the sister [repo urban-disco](https://github.com/DeployCoop/urban-disco), and help add additional charts and update old ones.

Then those values must be updated in the `argo` directory as well.

## useful regex

This one readies an env var for the defaults.env
```
s/^\(.*\)=\(.*\)/: "${\1:=\2}"/
```

prep a values.yaml to be embedded in argo.yaml:
```
'<,'>s/^/        /
```

change a storageClass line to use our variable:
```
s/\(storageClass:\).*/\1 "${THIS_STORAGECLASS}"
```

## Adding applications

Perhaps the easiest way to contribute is to add more applications.  

Here are the steps to add another helm chart:

1. Fetch and untar a chart e.g. `helm fetch --repo https://jp-gouin.github.io/helm-openldap/ openldap --untar`
1. Add the chart to [urban-disco](https://github.com/DeployCoop/urban-disco) or your own chart repo.
1. Create a directory with your apps name in the `argo` directory.  Take the values.yaml and place it here. e.g. [argo/bao](https://github.com/DeployCoop/vigilant-octo-waffle/tree/main/argo/bao)
1. Take the values.yaml from your chart and place it in the `argo/YOURAPP` directory. e.g. bao [argo/bao/values.yaml](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/argo/bao/values.yaml)
1. Add the argo yaml file `argocd.yaml`in the `argo/YOURAPP` directory. e.g. [argo/bao/argocd.yaml](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/argo/bao/argocd.yaml)
1. Add any more yaml like ingresses to the `init/YOURAPP` directory. e.g. [init/argo](https://github.com/DeployCoop/vigilant-octo-waffle/tree/main/init/bao)
1. Add host for your application to [src/hosts](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/hosts).
1. Add env vars to [src/default.env](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/default.env).
1. Add YOURAPP_ENABLED=true to [src/example.env.enabler](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/example.env.enabler) must match ${THIS_THING}_ENABLED as set in the `src/YOUR_APP.sh` script and you must convert all lower to upper case and replace all dashes with underscores and 
1. Create a script in `src` that installs your application. e.g. [src/bao.sh](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/bao.sh)
1. Add this script to [src/big_list](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/big_list)


### helper script [newApp.sh](./src/newApp.sh)
You can run the helper script [newApp.sh](./src/newApp.sh) e.g.

```
src/newApp.sh mynewapp
```

to automatically create:

[argo/${THIS_THING}](./argo/${THIS_THING})
[src/${THIS_THING}.sh](./src/${THIS_THING}.sh)

and add the necessary lines to:

[src/hosts](./src/hosts)
[src/example.env.enabler](./src/example.env.enabler)
[src/example.env.enabler](./src/example.env.enabler)
[src/big_list](./src/big_list)

replacing mynewapp in those files 

You will still need to perform these steps and inspect all new files.

1. Take the values.yaml from your chart and append it to the argocd.yaml in the `argo/YOURAPP` directory. e.g. bao [argo/bao/values.yaml](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/argo/bao/values.yaml)
1. Add any more yaml like ingresses to the `init/YOURAPP` directory. e.g. [init/bao](https://github.com/DeployCoop/vigilant-octo-waffle/tree/main/init/bao)
1. Add env vars to [src/default.env](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/default.env).
