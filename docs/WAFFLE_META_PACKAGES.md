# Waffle Meta-Packages: Declarative Multi-Chart Cluster Orchestration & OpenEBS Storage Fabric

## Executive Overview
**Waffle Meta-Packages** (`waffle.yaml`) provide the missing link between individual Helm charts and complete multi-tenant cluster ecosystems. 

While Helm excels at managing single microservices and applications, modern cloud and datacenter platforms require orchestrated multi-tier deployment sequences:
1. **Foundation Fabric**: Provisioning storage engines (OpenEBS Dynamic LocalPV), ingress controllers, and CRDs.
2. **Data & State Tiers**: Initializing databases (PostgreSQL, MongoDB, Cassandra), caches (Redis), and distributed object stores (SeaweedFS).
3. **Core Services**: Spreading platform APIs, token routers, and authentication daemons.
4. **Tenant Applications**: Launching customer workloads, SaaS tenants, and edge services with domain-based ingress routing.

Vigilant Octo Waffle's **Waffle Engine** reads a declarative `waffle.yaml` pipeline manifest, resolves dependencies across sequential and parallel execution stages, streams real-time ANSI telemetry and logs, verifies pod readiness probes, and standardizes persistent volume claims on OpenEBS.

---

## 1. Specification Reference: `waffle.dev/v1`

A canonical `waffle.yaml` file defines metadata, global cluster settings, pre-flight environment checks, and an ordered list of stages and steps:

```yaml
apiVersion: waffle.dev/v1
kind: WafflePipeline
metadata:
  name: my-datacenter-platform
  version: 1.0.0
  description: "Enterprise multi-tier platform with databases, storage, and web layers"
  authors:
    - name: "DevOps Core"
      email: "ops@example.com"
  tags:
    - datacenter
    - openebs
    - multi-tenant

settings:
  defaultNamespace: default
  defaultStorageClass: openebs-hostpath
  defaultClusterIssuer: letsencrypt-prod
  globalTimeout: 30m
  rollbackOnFailure: true

preflight:
  storage:
    requireStorageClass: openebs-hostpath
    autoInstallOpenEBS: true
  ingress:
    requireController: nginx
  resources:
    minCpuCores: 4
    minMemoryGb: 8

stages:
  - id: 00-storage-foundation
    name: "Distributed Storage Fabric"
    description: "Deploy OpenEBS Dynamic LocalPV hostpath provisioner"
    mode: series
    steps:
      - id: openebs
        name: "OpenEBS LocalPV Provisioner"
        chart: ./openebs
        namespace: openebs
        createNamespace: true
        wait: true
        timeout: 5m
        healthCheck:
          type: storageClass
          name: openebs-hostpath

  - id: 10-data-and-state
    name: "Data & Caching Tier"
    description: "Database and object storage engines"
    mode: parallel
    dependsOn: [00-storage-foundation]
    steps:
      - id: postgres
        name: "PostgreSQL StatefulSet"
        chart: ./postgres
        namespace: database
        set:
          persistence.storageClass: openebs-hostpath
          persistence.size: 20Gi
        healthCheck:
          type: podReady
          timeout: 5m

      - id: redis
        name: "Redis State Cache"
        chart: ./redis
        namespace: database
        set:
          persistence.storageClass: openebs-hostpath

  - id: 20-application-tenants
    name: "Customer Applications & Web Services"
    mode: parallel
    dependsOn: [10-data-and-state]
    steps:
      - id: web-portal
        name: "Production Web Portal"
        chart: ./web-portal
        namespace: web
        domain: portal.example.com
        set:
          ingress.host: portal.example.com
```

### 1.1 Field Reference

| Path | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `apiVersion` | `string` | `waffle.dev/v1` | Schema version identifier. |
| `kind` | `string` | `WafflePipeline` | Object kind. |
| `metadata.name` | `string` | *required* | Unique identifier of the pipeline package. |
| `settings.defaultNamespace` | `string` | `default` | Fallback namespace for steps omitting an explicit namespace. |
| `settings.defaultStorageClass`| `string` | `openebs-hostpath`| Default storage class injected into persistent volume claims. |
| `settings.rollbackOnFailure` | `boolean` | `true` | If true, halts pipeline execution upon any step failure. |
| `preflight.storage.autoInstallOpenEBS` | `boolean` | `true` | Automatically provisions OpenEBS if `openebs-hostpath` is missing. |
| `stages[].mode` | `'series' \| 'parallel'` | `'series'` | Sequential execution vs. concurrent parallel dispatch. |
| `stages[].dependsOn` | `string[]` | `[]` | List of prerequisite stage IDs that must complete first. |
| `steps[].chart` | `string` | *required* | Path to local chart folder (`./my-chart`) or repository chart name. |
| `steps[].domain` | `string` | `optional` | Target domain; automatically configures ingress routing. |
| `steps[].set` | `map` | `{}` | Helm `--set key=value` overrides. |
| `steps[].healthCheck.type` | `'podReady' \| 'storageClass' \| 'tcp' \| 'http'` | `'podReady'` | Verification strategy after Helm install. |

---

## 2. Storage Fabric Standardization: OpenEBS Dynamic LocalPV

All stateful workloads deployed via Waffle meta-packages standardize on **OpenEBS Dynamic LocalPV (`openebs-hostpath`)**.

### Why OpenEBS?
- **Raw NVMe/SSD Performance**: Bypasses distributed network overhead and kernel filesystem locks, granting near-bare-metal IOPS for databases (PostgreSQL, Cassandra, MongoDB) and streaming buffers (Kafka KRaft).
- **Dynamic Volume Provisioning**: Automatically provisions host directories when a PVC is created without manual PV creation.
- **`WaitForFirstConsumer` Binding**: Ensures pods and persistent volumes land on the exact same physical node where scheduled.

### Automatic Pre-flight Provisioning
When a Waffle pipeline requires `openebs-hostpath` (via `preflight.storage.requireStorageClass` or in any step's volume overrides), the Waffle Engine automatically checks:
```bash
kubectl get sc openebs-hostpath
```
If the StorageClass is absent, the Waffle Runner automatically provisions OpenEBS before executing Stage 0, either via a bundled `./openebs` chart or via `src/k3s_storage.sh install --engine openebs`.

---

## 3. Creating a Remote Waffle Git Repository

You can host and share your Waffle packages in standalone Git repositories (GitHub, GitLab, or self-hosted Gitea).

### 3.1 Recommended Repository Structure
```
my-waffle-repo/
├── waffle.yaml           # Master pipeline manifest
├── README.md             # Platform architecture runbook
├── charts/               # Local Helm charts
│   ├── openebs/
│   ├── database/
│   ├── api-server/
│   └── frontend/
└── values/               # Environment-specific overrides
    ├── staging.yaml
    └── production.yaml
```

### 3.2 Registering the Remote URL in Vigilant Octo Waffle

#### Via Web Studio UI:
1. Navigate to **Waffle Pipelines** (`/waffle`).
2. Click **Track Target** in the upper right.
3. Select **Remote Git Repo**.
4. Enter your Git Clone URL (e.g. `https://github.com/my-org/datacenter-waffle.git`).
5. Specify the target branch (`main`).
6. Click **Register Target**. Vigilant Octo Waffle will clone the repository, validate `waffle.yaml`, and display the live DAG canvas.

#### Via CLI:
```bash
# Register a local directory target
curl -X POST http://localhost:3000/api/waffle/sources \
  -H "Content-Type: application/json" \
  -d '{"type": "local", "pathOrUrl": "/path/to/charts", "name": "Local Charts"}'

# Register a remote Git repository
curl -X POST http://localhost:3000/api/waffle/sources \
  -H "Content-Type: application/json" \
  -d '{"type": "git", "pathOrUrl": "https://github.com/my-org/my-waffle.git", "branch": "main"}'
```

#### Syncing Upstream Changes:
Click the **Sync** button in the Web Studio or trigger:
```bash
curl -X POST http://localhost:3000/api/waffle/sync \
  -H "Content-Type: application/json" \
  -d '{"id": "waffle-target-id"}'
```

---

## 4. Pre-Packaged Community Blueprints

Vigilant Octo Waffle bundles 6 generic, open-source community blueprints ready to run out of the box:

### 1. NextJS Application + Supabase
- **Stage 0**: OpenEBS Dynamic LocalPV provisioner.
- **Stage 1**: Self-hosted Supabase with PostgreSQL 16 (`pgvector`), GoTrue authentication, and PostgREST API using `openebs-hostpath`.
- **Stage 2**: Next.js full-stack SSR application wired to Supabase Kong gateway with Ingress TLS.

### 2. Python Application + MongoDB
- **Stage 0**: OpenEBS LocalPV provisioner.
- **Stage 1**: Community MongoDB StatefulSet on persistent disk.
- **Stage 2**: FastAPI / Flask microservice with asynchronous connection pooling and health probes.

### 3. Jupyter Notebook + CassandraDB
- **Stage 0**: OpenEBS LocalPV storage fabric for high-speed commit logs.
- **Stage 1**: 3-node Apache Cassandra distributed NoSQL ring.
- **Stage 2**: GPU-ready JupyterLab data science environment pre-configured with `cassandra-driver`, pandas, and PyTorch.

### 4. kCTF Capture The Flag Setup
- **Stage 0**: OpenEBS storage fabric.
- **Stage 1**: Google kCTF infrastructure with `nsjail` kernel isolation, seccomp filters, and challenge health daemons.
- **Stage 2**: CTFd competition platform, team management, and dynamic scoreboard.
- **Stage 3**: Containerized challenge fleet (pwn, reverse engineering, web exploitation).

### 5. Zero-Trust Storage
- **Stage 0**: OpenEBS LocalPV provisioner.
- **Stage 1**: SeaweedFS distributed S3 object store with at-rest encryption.
- **Stage 2**: HashiCorp Vault secrets broker for dynamic short-lived token generation.
- **Stage 3**: Strict Zero-Trust Kubernetes NetworkPolicies enforcing default-deny ingress.

### 6. Home Lab Complete Setup
- **Stage 0**: OpenEBS LocalPV high-throughput video recording storage pool.
- **Stage 1**: Mosquitto MQTT message broker and Redis cache.
- **Stage 2**: Home Assistant Core for smart home device orchestration.
- **Stage 3**: Jellyfin media server and Frigate real-time AI vision NVR.
- **Stage 4**: Productivity suite: Nextcloud private cloud, OpenProject collaboration, and KitchenOwl meal planner.

---

## 5. Web Studio Operational Capabilities

The Web Studio (`/waffle`) offers complete operational control:
- **Interactive DAG Canvas**: Visualizes stage dependencies, parallel execution branches, and real-time step cards.
- **Live Elapsed Timers & Badges**: Tracks step durations down to the millisecond.
- **Floating Streaming Terminal Drawer**: Delivers unbuffered ANSI logs from Helm and kubectl via Server-Sent Events (`/api/waffle/stream`).
- **Dry-Run Simulation**: Renders templates and validates manifest syntaxes without modifying cluster state.
- **Victory Celebration**: Displays particle confetti upon 100% completion with direct clickable VIP domain links.
