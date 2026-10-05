# @vow/githubio — project site & documentation

The static website for Vigilant Octo Waffle: a showcase of what the
project does, plus the online documentation. It is a Next.js app that
builds to a **fully static export** (`output: 'export'`) — no server, no
API routes.

## Develop

```bash
pnpm --filter @vow/githubio dev      # http://localhost:3000
pnpm --filter @vow/githubio build    # static export in apps/githubio/out
pnpm --filter @vow/githubio lint
pnpm --filter @vow/githubio typecheck
```

## Pages

- `/` — showcase: the TLS problem the project solves, feature grid, the
  three interfaces (web control plane, `vow` TUI, `./up`), the app
  catalog, and the security model.
- `/docs…` — documentation: getting started, configuration, GitOps,
  the web control plane, the CLI, authorization, and architecture.
  Content mirrors `README.md` and `ARCHITECTURE.md` at the repo root —
  when those change materially, update the matching page here.

## Deployment

`.github/workflows/githubio.yml` builds the export and deploys it to
GitHub Pages on pushes to `main` that touch `apps/githubio/**` (PRs get a
build-only check). A project Pages site is served from `/<repo-name>`, so
the deploy build sets `GITHUBIO_BASE_PATH=/vigilant-octo-waffle`, which
`next.config.ts` turns into the export's `basePath`/`assetPrefix`. Local
and PR builds leave it unset.

One-time setup: in the repository settings, set **Pages → Source** to
**GitHub Actions**.
