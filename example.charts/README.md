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

## 7. Included Examples in this Directory

1. **[`sample-app`](file:///home/thoth/vigilant-octo-waffle/example.charts/sample-app)**: A complete, production-ready NGINX microservice with health probes, ingress TLS, custom configmap, and security context.
2. **[`static-site`](file:///home/thoth/vigilant-octo-waffle/example.charts/static-site)**: A lightweight static HTML / documentation server demonstrating ConfigMap volume mounts.
