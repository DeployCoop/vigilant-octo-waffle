# Vigilant Octo Waffle - Custom Local Charts Directory Guide

Welcome to the local Helm charts directory for **Vigilant Octo Waffle**. This directory demonstrates how to organize and populate your own Helm charts so they are automatically discovered, validated, and managed by the platform.

---

## 1. How It Works

Vigilant Octo Waffle automatically scans the configured charts directory for any folder containing a valid `Chart.yaml` file.

When a chart is detected:
1. **Catalog Integration (`/apps`)**: It appears in the main Applications Catalog under the **"Custom & Local Charts"** category.
2. **Helm Management (`/helm`)**: It is indexed in the Helm Hub with built-in **Linting (`helm lint`)**, **Template Preview (`helm template`)**, **Values Inspection**, and **1-Click Deployment**.
3. **App Details (`/apps/<chart-id>`)**: You can inspect `Chart.yaml`, customize `values.yaml` with overrides, and deploy via Helm or GitOps.
4. **Environment Toggles (`.env.enabler`)**: An enabler flag (e.g. `SAMPLE_APP_ENABLED=true`) is registered automatically.

---

## 2. Setting the Charts Directory Path

You can point Vigilant Octo Waffle to **any path** on your system (relative or absolute).

### Option A: Via `.env` or `src/default.env`
Set the `THIS_CHARTS_DIR` variable:
```bash
# Relative to project root:
THIS_CHARTS_DIR="./charts"

# Or point directly to this example directory:
THIS_CHARTS_DIR="./example.charts"

# Or any absolute path on your host:
THIS_CHARTS_DIR="/opt/my-company-charts"
```

### Option B: Via Web UI
Navigate to **Helm Release Inspector (`/helm`)** -> **Local Charts** tab. Enter any directory path in the **"Active Charts Directory"** field and click **"Apply Directory"**. The system will validate the path, scan for charts, and persist the setting to `.env`.

---

## 3. Required Directory Structure

Each chart must be placed in its own subdirectory inside the charts directory:

```text
charts/ (or your custom THIS_CHARTS_DIR)
├── sample-app/                 # Chart directory name
│   ├── Chart.yaml              # REQUIRED: Chart metadata
│   ├── values.yaml             # REQUIRED: Default configuration values
│   ├── templates/              # REQUIRED: Kubernetes manifests
│   │   ├── _helpers.tpl        # Template helper definitions
│   │   ├── deployment.yaml     # Workload deployment
│   │   ├── service.yaml        # Service definition
│   │   ├── ingress.yaml        # Ingress routing & TLS
│   │   ├── configmap.yaml      # Configuration or static files
│   │   ├── serviceaccount.yaml # Service account
│   │   └── NOTES.txt           # Post-install notes
│   └── README.md               # Optional: Chart documentation
└── static-site/                # Additional charts...
    ├── Chart.yaml
    ├── values.yaml
    └── templates/
```

---

## 4. Minimum Required `Chart.yaml`

The `Chart.yaml` file defines how the chart shows up in the Vigilant Octo Waffle UI:

```yaml
apiVersion: v2
name: my-custom-app           # Display name & identifier in Vigilant Octo Waffle
version: 1.0.0               # SemVer version of the Helm chart
appVersion: "2.4.0"          # Version of the underlying application
description: "High-performance API microservice with Redis caching"
type: application            # "application" or "library"
keywords:                    # Displayed as tags in the UI
  - web
  - api
  - backend
home: "https://my-company.com" # Displayed as docs link
icon: "Ship"                 # Lucide icon name or URL to an image
maintainers:
  - name: "DevOps Team"
    email: "devops@example.com"
```

---

## 5. Integrating with Vigilant Octo Waffle Cluster Features

When authoring charts for Vigilant Octo Waffle, you can take advantage of cluster infrastructure:

### TLS Certificates (`cert-manager` & `mkcert`)
In your `templates/ingress.yaml`, use the cluster issuer annotation:
```yaml
annotations:
  cert-manager.io/cluster-issuer: {{ .Values.ingress.issuer | default "mkcert-issuer" }}
```

### Storage Classes
Use the cluster's default storage class (`local-path`, `openebs-hostpath`, or `openebs-lvmpv`):
```yaml
storageClassName: {{ .Values.storage.className | default "${THIS_STORAGECLASS}" }}
```

### Ingress Hostnames
Use the platform domain:
```yaml
rules:
  - host: {{ .Values.ingress.host | default (printf "%s.%s" .Chart.Name .Values.global.domain) }}
```

---

## 6. Testing Your Charts

You can test and lint your charts using the Helm CLI or directly in the Vigilant Octo Waffle Web UI:

```bash
# Lint the chart for syntax or schema errors:
helm lint ./example.charts/sample-app

# Render templates locally without deploying:
helm template sample-app ./example.charts/sample-app

# Install or upgrade into your cluster:
helm upgrade --install sample-app ./example.charts/sample-app --namespace default --create-namespace
```

---

## 7. Waffle Meta-Packages (`waffle.yaml`) Orchestration

While individual Helm charts package isolated microservices, modern datacenter environments require coordinating multiple charts into structured stages (storage engines, databases, queues, tenant apps).

The **Waffle Meta-Package Engine** allows you to place a `waffle.yaml` file directly in your charts directory to declaratively orchestrate multi-chart pipelines.

An example pipeline is included right in this directory: **[`example.charts/waffle.yaml`](./waffle.yaml)**.

### Anatomy of `waffle.yaml`

```yaml
apiVersion: waffle.dev/v1
kind: WafflePipeline
metadata:
  name: example-ecosystem-pipeline
  version: 1.0.0
  description: "Example multi-stage pipeline orchestrating sample-app and static-site charts"
  authors:
    - name: "Platform DevOps"
      email: "devops@example.com"
  tags:
    - example
    - sample-app

# Global settings applied across all steps unless overridden
settings:
  defaultNamespace: default
  defaultStorageClass: local-path
  defaultClusterIssuer: mkcert-issuer
  globalTimeout: 15m
  rollbackOnFailure: true

# Preflight host and cluster requirements
preflight:
  storage:
    requireStorageClass: local-path
    autoInstallOpenEBS: false
  ingress:
    requireController: nginx
  resources:
    minCpuCores: 2
    minMemoryGb: 4

# Kubernetes secrets injected automatically before deployment
keys:
  secrets:
    - name: example-app-secrets
      namespace: default
      literals:
        API_SECRET_KEY: "demo-secret-key-change-in-prod"
        SESSION_SALT: "randomized-salt-value"

# Container build specifications & GitOps integration
builds:
  registry: "localhost:5001"
  gitops:
    engine: "waffle" # "waffle", "argocd", or "flux"
    branch: "main"
    autoBuildOnPush: false
    webhookPath: "/api/gitops/webhook"
  targets:
    - name: sample-app
      context: ./sample-app
      image: sample-app/nginx
      tag: "1.25.0"

# Ordered deployment stages (sequential or parallel)
stages:
  - id: 00-foundation-config
    name: "Foundation & Secrets Configuration"
    mode: series      # Steps in this stage run sequentially
    steps:
      - id: sample-app-bootstrap
        name: "Sample App Pre-requisites"
        chart: ./sample-app
        namespace: default
        createNamespace: true
        wait: true
        timeout: 3m
        set:
          replicaCount: 1
          ingress.enabled: false
        healthCheck:
          type: podReady
          timeout: 2m

  - id: 10-application-services
    name: "Application Web Services"
    mode: parallel    # Steps in this stage run concurrently
    dependsOn:
      - 00-foundation-config
    steps:
      - id: sample-app-production
        name: "Production Sample App Service"
        chart: ./sample-app
        namespace: default
        wait: true
        timeout: 5m
        set:
          replicaCount: 2
          ingress.enabled: true
          ingress.host: "sample-app.local"
        healthCheck:
          type: http
          url: "http://sample-app.local/healthz"
          expectedStatus: 200
          timeout: 2m

      - id: static-docs-site
        name: "Static Documentation Site"
        chart: ./static-site
        namespace: default
        wait: true
        timeout: 3m
        set:
          replicaCount: 1
          ingress.enabled: true
          ingress.host: "docs.local"
        healthCheck:
          type: podReady
          timeout: 2m
```

### Running and Validating `waffle.yaml`

You can inspect, validate, and execute your `waffle.yaml` pipeline using the CLI, Ink TUI, or Web UI:

1. **Dry-Run / Lint the Pipeline**:
   ```bash
   ./up waffle:lint example.charts/waffle.yaml
   # Or run via orchestrator dry-run:
   ./up waffle:run example.charts/waffle.yaml --dry-run
   ```

2. **Execute the Multi-Chart Pipeline**:
   ```bash
   ./up waffle:run example.charts/waffle.yaml
   ```

3. **Interactive Terminal TUI (Ink)**:
   ```bash
   ./up ink
   # Select "Waffle Pipelines" from the main menu to view DAG visualization,
   # execution stages, and step progress.
   ```

4. **Web UI Dashboard (`/waffle`)**:
   Navigate to the **Waffle Meta-Packages** section in the web interface to view the live DAG canvas, inspect step parameters, review run history, and trigger runs with 1-click.

---

## 8. Included Examples in this Directory

1. **[`sample-app`](./sample-app)**: A complete, production-ready NGINX microservice with health probes, ingress TLS, custom configmap, and security context.
2. **[`static-site`](./static-site)**: A lightweight static HTML / documentation server demonstrating ConfigMap volume mounts.
3. **[`waffle.yaml`](./waffle.yaml)**: Complete multi-stage pipeline manifest demonstrating dependency DAGs, parallel stages, secrets provisioning, container build specs, and HTTP/Pod health probes.
