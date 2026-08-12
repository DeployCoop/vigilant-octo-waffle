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
        ┌────────┴────────┐
        ▼                 ▼
   [init/ manifests]  [argo/ manifests]
        │                 │
        ▼                 ▼
  kubectl apply       ArgoCD App Create
```

### 1. `src/` (Utilities & Control Scripts)

This was the original directory for orchestration scripts. Many of the projects have a named script here (e.g., `src/supabase.sh`).

Notable files:
*   #### [util.bash](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/util.bash)
    This is the main library of functions, which includes `initializer`. It uses `envsubst` to feed `kubectl apply`:
    ```bash
    envsubst < ${f} | kubectl apply -f -
    ```
*   #### [argoRunner.sh](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/argoRunner.sh)
    This script unifies the application installations by templating and creating ArgoCD applications:
    ```bash
    envsubst < argo/${THIS_THING}/argocd.yaml | argocd app create --name ${THIS_THING} --grpc-web -f -
    ```
    For example, in [src/bao.sh](https://github.com/DeployCoop/vigilant-octo-waffle/blob/main/src/bao.sh), we initialize the raw manifests first and then run the ArgoCD application creation:
    ```bash
    initializer "${this_cwd}/init/bao"
    argoRunner "$THIS_THING"
    ```

### 2. `argo/` (ArgoCD Applications)

This is a directory of ArgoCD applications. Each directory is named after the intended application and contains the YAML file for Argo, and optionally a Helm values file.

### 3. `init/` (Raw Pre-App Manifests)

This directory contains Kubernetes YAML manifests that get applied directly to the cluster (such as an ingress, secret setup, or namespace preparation) before or during the application's Argo installation. The `src/util.bash`'s `initializer` function processes these with `envsubst` and applies them directly.
