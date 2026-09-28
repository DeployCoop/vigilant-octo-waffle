# Architecture

Vigilant Octo Waffle provides a local Kubernetes-based development and testing environment designed to simulate production-like setups directly on a local laptop—especially for troubleshooting tricky TLS, ingress, and GitOps workflows.

## 🚀 Key Capabilities

1. **Local Multi-Service Cluster**: Uses **KinD (Kubernetes in Docker)** or **K3s** to run a full Kubernetes cluster locally.
2. **True TLS Localhost Testing**: Uses **`mkcert`** to establish a local Certificate Authority (CA) on your laptop. It automatically generates trusted local certificates for custom subdomains (e.g., `https://nextcloud.example.com`) by updating your local `/etc/hosts` file.
3. **GitOps with ArgoCD**: Automates the deployment of local applications using ArgoCD, aligning closely with production deployment practices.
4. **App Ecosystem**: Provides integration for a wide variety of self-hosted/cloud-native applications including OpenLDAP, Harbor, Nextcloud, OpenProject, Keycloak, Supabase, Drupal, OpenBAO, and more.
5. **Storage Provisioning**: Includes **OpenEBS** (tested with LVM local PVs and NFS-based RWX storage).

---

## 📁 Codebase Structure & Core Loop

Envsubst is the simple templating method that powers this repo. Most of the functionality comes from `envsubst` interpolating variables from `.env` (and `.env.enabler`) into the various files in the `argo` and `init` directories.

```
       [.env / .env.enabler]
                 │
                 ▼
          [envsubst template]
                 │
        ┌────────┼──────────────────────┐
        ▼        ▼                      ▼
   [init/]    [argo/ manifests]    [flux/ manifests]
        │        │                      │
        ▼        ▼                      ▼
  kubectl apply  ArgoCD App Create     FluxCD GitRepo / HelmRelease / Kustomization
```

### 1. `src/` (Utilities & Control Scripts)

This is the primary directory for core bash orchestration scripts. Many of the projects have a named script here (e.g., `src/supabase.sh`, `src/nextcloud.sh`, `src/bao.sh`).

Notable files:
*   #### [util.bash](src/util.bash)
    The central library of helper functions, which includes `initializer`. It uses `envsubst` to feed `kubectl apply`:
    ```bash
    envsubst < ${f} | kubectl apply -f -
    ```
*   #### [cdRunner.bash](src/cdRunner.bash)
    Unified CD orchestrator and multiplexer. Reads `THIS_CD_RUNNER` (`argocd`, `flux`, or `both`) and invokes `argoRunner` and/or `fluxRunner` accordingly:
    ```bash
    cdRunner "$THIS_THING"
    ```
*   #### [argoRunner.bash](src/argoRunner.bash)
    Templates and applies ArgoCD applications using `argocd app create`:
    ```bash
    envsubst < argo/${THIS_THING}/argocd.yaml | argocd app create --name ${THIS_THING} --grpc-web -f -
    ```
    If `THIS_CD_RUNNER` is set to `flux`, `argoRunner` transparently delegates to `fluxRunner`. If set to `both`, both runners are executed.
*   #### [fluxRunner.bash](src/fluxRunner.bash)
    Templates and applies FluxCD manifests (`GitRepository`, `HelmRelease`, `Kustomization`).
    - Uses `flux/${THIS_THING}/flux.yaml` when present.
    - Seamlessly synthesizes Flux resources directly from `argo/${THIS_THING}/argocd.yaml` if no native Flux manifest exists.
    - Deep-merges user overrides from `.flux_overrides/${THIS_THING}/flux.yaml`.
*   #### [flux.sh](src/flux.sh) & [installFluxCLI.sh](src/installFluxCLI.sh)
    Installs FluxCD controllers and prerequisites into the cluster (`flux-system` namespace) and optionally installs the `flux` CLI.

### 2. `argo/` (ArgoCD Applications)

Contains ArgoCD application manifests (`argocd.yaml`) and optional Helm value files. Each directory is named after the intended application.

### 3. `flux/` (FluxCD Applications)

Contains native FluxCD manifests (`flux.yaml`) declaring `GitRepository`, `HelmRelease`, or `Kustomization` CRDs for applications. If an app does not have a native manifest in `flux/`, the orchestrator and `fluxRunner.bash` automatically synthesize an equivalent Flux manifest from `argo/<app>/argocd.yaml`.

### 4. `init/` (Raw Pre-App Manifests)

Contains Kubernetes YAML manifests applied directly to the cluster (such as ingresses, namespaces, or secret setups) before application CD installation. The `initializer` function in `src/util.bash` processes these with `envsubst` and applies them directly.

### 5. Multi-CD Support in Next.js Control Plane (`@vow/orchestrator`)

The Next.js web application provides parity with the bash orchestration:
- **`FluxManager`**: TypeScript engine mirror of `fluxRunner.bash`. Supports `prepareAppManifest`, `synthesizeFluxFromArgo`, `deployApp`, and `syncApp`.
- **API Endpoints**: `/api/flux` exposes controller health, reconciliation, and status checks; `/api/apps/[id]` supports `runner=argocd|flux` queries and deployments.
- **Visual Runner Switching**: Interactive toggle on application detail pages to switch between ArgoCD and FluxCD views, manifests, overrides, and live sync commands.
