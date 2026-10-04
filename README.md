# Vigilant Octo Waffle 🐙

![Vigilant Octo Waffle](src/vigilantoctowaffle.png?raw=true "Vigilant Octo Waffle")

Ever have a problem with TLS and your app in production that requires you to post an issue online with an open source project?

But then you don't want to post your production configs because you don't want to clean all the private data out?

So you try to replicate on your laptop with localhost, but TLS is not working so the issue no longer reveals itself.

Vigilant-Octo-Waffle to the rescue! Don't use localhost! Update the hosts file to include an example.com subdomain and test full TLS functionality without leaving your localhost laptop! Using mkcert in the background a local certificate authority is established and used to generate certificates for any domain you like, the CA is installed so that your local web browser trusts the certs so you can debug tricky TLS issues in your apps that others simply will not catch until they have their app behind TLS in production.

This project provides a **Kubernetes cluster setup** using [KinD](https://kind.sigs.k8s.io) or [K3s](https://k3s.io), pre-configured with [ArgoCD](https://argoproj.github.io/argocd/) and a suite of applications. It's ideal for testing, development, and demonstrating Kubernetes-based deployments with TLS, ingress, and secrets management.

---

## 🚀 Features

- **Next.js Web Control Plane**: Modern, responsive full-stack dashboard for managing clusters, services, and configs.
- **Local Kubernetes Cluster**: Spin up a KinD or K3s cluster with a single command or web click.
- **Dual GitOps CD Runners (ArgoCD & FluxCD)**: Full support for both [ArgoCD](https://argoproj.github.io/argocd/) and [FluxCD](https://fluxcd.io) (`THIS_CD_RUNNER:=argocd|flux|both`).
- **TLS with mkcert**: Generate trusted certificates for local development (e.g., `https://example.com`).
- **Multi-App Support**: Includes 45+ open-source applications (OpenLDAP, Harbor, Nextcloud, OpenProject, and more).
- **Customizable**: Use web Config Studio or `.env` and `.env.enabler` to configure services and toggles.

---

## 🌐 Next.js Web Application & Dashboard

Vigilant Octo Waffle is organized as a **pnpm monorepo** containing:
- `apps/web`: Next.js 15+ App Router dashboard with live streaming console, catalog, and cluster manager.
- `packages/orchestrator`: Core TypeScript engine for config parsing, templating, YAML merging, secret generation, and process execution.

### Quick Start with pnpm

```bash
# Install dependencies
pnpm install

# Start the Next.js development server
pnpm dev

# Or build and run for production
pnpm build
pnpm start
```

### Running with Docker Compose

```bash
# Build and run the control plane container
docker compose up -d
```

Visit **`http://127.0.0.1:3000`** to access the web control plane.

### 🛡️ Security Model & Host/Cluster Takeover Prevention

> [!CAUTION]
> **CRITICAL SECURITY REQUIREMENT — LOCALHOST ONLY BINDING (`127.0.0.1`)**:
> The web control plane mounts the host's Docker socket (`/var/run/docker.sock`), cluster credentials (`~/.kube:ro`), and generated secrets (`.secrets`).
> Because access to the Docker socket allows root-equivalent execution on the host, **`docker-compose.yaml` binds port 3000 strictly to `127.0.0.1:3000:3000`**.
>
> - **DO NOT** bind port 3000 to `0.0.0.0` or expose it across external, LAN, or untrusted networks.
> - **DO NOT** remove the `127.0.0.1:` host IP restriction without an authenticated reverse proxy (e.g. Traefik/Nginx with mTLS or OIDC).
> - Anyone able to reach port 3000 without network isolation could potentially control container lifecycles on the host.

- **Localhost & CSRF Origin Protection**: Mutating API endpoints (`POST`, `PUT`, `DELETE`, `PATCH` on `/api/*`) are protected by [`apps/web/src/middleware.ts`](file:///home/thoth/vigilant-octo-waffle/apps/web/src/middleware.ts). Non-local origins or mismatched `Host`/`Origin` headers are blocked with HTTP 403.
- **Optional API Token Guard**: Setting `VOW_API_TOKEN` in `.env` activates mandatory Bearer authentication (`Authorization: Bearer <token>` or `x-vow-token: <token>`) on all mutating routes (HTTP 401 on missing/invalid token).

- **Webhook Service Token**: Setting `VOW_WEBHOOK_TOKEN` in `.env` gives `POST /api/argo/webhook` (the ArgoCD sync accelerator) its own least-privilege credential (`Authorization: Bearer <token>` or `x-vow-webhook-token: <token>`, HTTP 401 on missing/invalid token). When set, the middleware defers that one path to the webhook token so external automation (CI, git hooks) can trigger syncs without the full control-plane token. Dashboard Instant Sync callers are prompted for the token once and remember it in the browser's local storage. When unset, the webhook route behaves as before.
- **Strict Command Allowlist & `shell: false`**: Arbitrary shell commands and subshell spawns (`shell: true`) are completely disabled in [`packages/orchestrator/src/executor.ts`](file:///home/thoth/vigilant-octo-waffle/packages/orchestrator/src/executor.ts). Only pre-approved binaries (`kubectl`, `helm`, `kind`, `k3d`, `k3s`, `argocd`, `flux`, `velero`, `docker`, `mkcert`, `echo`, `ssh`) and approved repository scripts (`./up`, `src/*.sh`) can execute. Shell evaluation flags (`-c`, `-s`) and directory traversal are blocked.
- **Safe Overrides**: App override mutations (`.argo_overrides/`, `.flux_overrides/`) are strictly validated against `APP_CATALOG` with path traversal guards.
- **In-Memory Process Management**: Tasks and log streams are tracked in-memory by `processManager`. Multi-instance or serverless runtimes require an external persistence adapter (e.g. Redis/PostgreSQL).

### 🔄 Coexistence with Bash Orchestration (`./up`)

The Next.js control plane does not replace the existing Bash workflow; it provides a visual management layer over the same configuration and tools:
- Configuration edits in the UI sync directly to `.env` and `.env.enabler`.
- Cluster actions trigger `./up`, `kind`, or `k3d` directly.
- Overrides written via the UI merge into `argo/<app>/argocd.yaml` via `.argo_overrides/<app>/argocd.yaml`, identical to the CLI behavior.
- Developers can freely use `./up` from the shell and monitor/manage through the Web UI simultaneously.

### ⚡ GitOps CD Runners: ArgoCD & FluxCD

Vigilant Octo Waffle supports both **ArgoCD** and **FluxCD** ([fluxcd.io](https://fluxcd.io)), with complete interoperability across CLI and web UI:

- **Configure Active Runner**: Set `THIS_CD_RUNNER` in `.env` (or via Config Studio in the Web UI):
  - `argocd` (default): Deploys ArgoCD controllers and provisions applications through `argoRunner.bash` / ArgoCD Application CRDs.
  - `flux`: Deploys FluxCD controllers into `flux-system` and provisions applications via `fluxRunner.bash` (`GitRepository` + `HelmRelease` / `Kustomization`).
  - `both`: Deploys both GitOps engines concurrently for hybrid or side-by-side migration testing.
- **Dynamic Manifest Synthesis**: Applications in `argo/` work automatically with FluxCD without requiring duplicate manifests. If no custom file is present in `flux/<app>/flux.yaml`, `fluxRunner.bash` and the web orchestrator dynamically synthesize equivalent Flux `GitRepository` and `HelmRelease`/`Kustomization` manifests.
- **App Overrides**: ArgoCD overrides are stored in `.argo_overrides/<app>/argocd.yaml`, and FluxCD overrides in `.flux_overrides/<app>/flux.yaml`.
- **CLI & Web Controls**: Use `src/cdRunner.bash <app>`, `src/fluxRunner.bash <app>`, or the web UI's app detail runner switch to deploy, inspect, and reconcile apps with either runner.

### 🌐 K3s Multi-Node Expansion & Node Joining

When running K3s (`THIS_K8S_TYPE="k3s"`), you can seamlessly expand your cluster across multiple machines, VMs, or edge devices:

- **Join Worker (Agent) Node**:
  ```bash
  # Print the single-line curl join command
  ./up k3s:add-node --role agent

  # Or save to a standalone script
  ./up k3s:add-node --role agent -o ./.secrets/k3s_join_agent.sh

  # Or remotely provision a target machine over SSH
  ./up k3s:add-node --role agent --ssh ubuntu@192.168.1.50 --node-name worker-1
  ```
- **Join HA Control-Plane (Server) Node**:
  ```bash
  ./up k3s:add-node --role server --ssh root@192.168.1.51 --node-name master-2
  ```
- **Web Control Plane GUI**:
  Navigate to `/cluster` on the web dashboard, click **"Join K3s Node"**, choose Worker vs Control-Plane, configure labels/taints, copy the generated curl one-liner, or run automated SSH provisioning with real-time log streaming.





## Apps

- **argocd
- **certmanager
- **drupal
- **FOSSBilling
- **harbor
- **kube-prometheus-stack
- **kubeshark
- **openbao
- **openebs
- **openldap
- **openproject
- **opensearch
- **opensearch-operator
- **nextcloud
- **supabase
- **example-nextjs-docker

## Storage

### OpenEBS

OpenEBS is quite mature at this point I have heavily tested the LVM provisioner, and am adding RWX support with NFS, ZFS support is planned as well.

#### LVMPV

https://github.com/openebs/lvm-localpv/blob/develop/docs/quickstart.md#setup

#### NFS

https://openebs.io/docs/Solutioning/read-write-many/nfspvc

## Ingress 

Adjustable $subdomain.$domain.$tld for each subdomain. With TLS using mkcert for local development and LetsEncrypt with real certs if you have an external static IP

```bash
󰰸 ❯ kgia
NAMESPACE    NAME                                      CLASS    HOSTS                      ADDRESS   PORTS     AGE
argocd       argocd-server-ingress                     nginx    argocd.example.com                   80, 443   26m
example      drupal-example                            nginx    drupal.example.com                   80, 443   24m
example      examplenc-collabora                       nginx    collabora.example.com                80, 443   24m
example      examplenc-nextcloud                       nginx    nextcloud.example.com                80, 443   24m
example      fossbilling                               nginx    fossbilling.example.com              80, 443   24m
example      goharbor-example-ingress                  nginx    harbor.example.com                   80, 443   24m
example      keycloak                                  nginx    keycloak.example.com                 80, 443   25m
example      kubeshark-ingress                         nginx    kubeshark.example.com                80, 443   24m
example      nextjs-docker-example-web                 nginx    nextjsdocker.example.com             80, 443   24m
example      openbao                                   nginx    bao.example.com                      80, 443   23m
example      openbao-ui                                nginx    baoui.example.com                    80, 443   24m
example      openproject-example                       nginx    openproject.example.com              80, 443   24m
example      opensearch-cluster-master                 nginx    opensearch.example.com               80, 443   24m
example      supabase-example-supabase-kong            nginx    supa.example.com                     80, 443   24m
monitoring   prometheus-grafana                        nginx    grafana.example.com                  80, 443   24m
monitoring   prometheus-kube-prometheus-alertmanager   nginx    alertmanager.example.com             80, 443   24m
monitoring   prometheus-kube-prometheus-prometheus     nginx    prometheus.example.com               80, 443   24m
```

---

## 🛠 Requirements

Ensure the following tools are installed:

- **Bash** (with `tr`, `pwgen`, `openssl`)
- **Python 3**
- **kubectl**
- **argocd CLI**
- **Docker** (with `docker-compose`)
- **mkcert**
- **KinD** (for Kubernetes-in-Docker)
- **yq** [yq-go](https://github.com/mikefarah/yq)
- **K3s** (optional)

You will need around 11 GB just to pull all the images and startup the cluster if you enable all the apps, it might be prudent to start with just a few.  
And my laptop is using about 25 GB of RAM with everything on and my browser open.

```bash
$ grep 'model name' /proc/cpuinfo |uniq
model name      : Intel(R) Core(TM) Ultra 5 125U

$ cat /proc/loadavg 
0.97 1.04 1.41 1/5915 941800

$ free -m
               total        used        free      shared  buff/cache   available
Mem:           47483       25126        2092        1231       22069       22356
Swap:          65535         407       65128
```


---

## 📁 Configuration

1. **Create `.env`**:
   ```bash
   cp src/example.env .env
   ```
   Edit the `.env` file to customize domain names, secrets, and other parameters.   
   There are many defaults in src/defaults.env, any that you want to change either set in your environment file beforehand or set them in a local .env file.

2. **Populate `/etc/hosts`**:
   ```bash
   src/hostr.sh
   ```
   This adds necessary hostnames (e.g., `example.com`) to your local hosts file.

3. **mkcert Setup**:
   ```bash
   mkcert -install
   ```
   This ensures your browser should then trust locally generated TLS certificates from certificate-manager within KinD.  
   The configuration of KinD and certificate-manager are completely automated from here on out.

   For further help on [mkcert](https://mkcert.org), check their [github](https://github.com/Lukasa/mkcert).

---

## Overrides

### argo

You can create an override for argo based applications like so:

```
mkdir .argo_overrides
cp -a argo/velero .argo_overrides/
```

Now you can edit `.argo_overrides/velero/argocd.yaml`, and the two yaml files will be merged with `yq` and applied.

### init

You can create an override for stuff in the init director like so:

```
mkdir .init_overrides
cp -a init/cluster .init_overrides/
```

Now you can edit `.init_overrides/cluster/namespace.yaml`, and the two yaml files will be merged with `yq` and applied.

### yq merge

You can completely override my argocd.yaml files and init files.  As I am using yq to merge the results, you can put as little or as much as you want in the override.

For example, you can configure a provider for velero

```
spec:
  source:
    helm:
      values: |
        configuration:
          backupStorageLocation:
          - name:
            provider: "${THIS_VELERO_PROVIDER}"
            bucket: "${THIS_VELERO_BUCKET}"
            default: "${THIS_VELERO_DEFAULTED}"
            accessMode: ReadWrite
            credential:
              name:
              key:
            config:
              s3ForcePathStyle: /testpath
              s3Url: s3.example.com
```

This will result in this merge:

```
yq e '. *+ load(".argo_overrides/velero/argocd.yaml")' argo/velero/argocd.yaml
metadata:
  name: velero-${THIS_NAMESPACE}
  namespace: argocd
spec:
  destination:
    namespace: velero
    server: https://kubernetes.default.svc
  project: default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - ServerSideApply=false
  source:
    path: velero
    repoURL: ${THIS_REPO_URL}
    targetRevision: HEAD
    helm:
      values: |
        configuration:
          backupStorageLocation:
          - name:
            provider: "${THIS_VELERO_PROVIDER}"
            bucket: "${THIS_VELERO_BUCKET}"
            default: "${THIS_VELERO_DEFAULTED}"
            accessMode: ReadWrite
            credential:
              name:
              key:
            config:
              s3ForcePathStyle: /testpath
              s3Url: s3.example.com
```

### caveats

Because of yq not handling it we cannot merge multiple yaml files into a single file with triple dashes

## 🚀 Usage

### Check your dns

if you populating /etc/hosts run the script:

```
src/hostr.sh
```

if you are using publicly available DNS you can generate bind compatible records:

```
src/host2bind.sh 1.2.3.4 1.2.3.5 1.2.3.6
```

if you are using cloudflare as DNS you can generate cf compatible records:

```
src/host2cloudflare.sh 1.2.3.4 1.2.3.5 1.2.3.6
```

### Start the Cluster

```bash
./up
```

This will:
- Delete any existing cluster.
- Create a new KinD/K3s cluster.
- Deploy ArgoCD, cert-manager, and configured applications.
- Apply TLS certificates and ingress rules.

for now and you should have a cluster like so:

**Example Output**:
```bash
urban-disco on  main on ☁️   (us-east-2) on ☁️    
󰰸 ❯ kgia
NAMESPACE   NAME                             CLASS   HOSTS                  ADDRESS   PORTS     AGE
argocd      argocd-server-ingress            nginx   argocd.example.com               80, 443   4h28m
example     goharbor-example-ingress         nginx   harbor.example.com               80, 443   4h27m
example     keycloak                         nginx   keycloak.example.com             80, 443   4h28m
example     openbao                          nginx   bao.example.com                  80, 443   4h27m
example     openbao-ui                       nginx   baoui.example.com                80, 443   4h27m
example     supabase-example-supabase-kong   nginx   supa.example.com                 80, 443   4h27m
urban-disco on  main on ☁️   (us-east-2) on ☁️    
󰰸 ❯ k get cert -A
NAMESPACE   NAME                          READY   SECRET                        AGE
argocd      argocd-example-tls            True    argocd-example-tls            4h28m
example     chart-bao-example.com-tls     True    chart-bao-example.com-tls     4h27m
example     chart-example-baoui-tls       True    chart-example-baoui-tls       4h27m
example     chart-example-keycloak-tls    True    chart-example-keycloak-tls    4h28m
example     harborishel1234018730248971   True    harborishel1234018730248971   4h27m
example     supatekro-ingress-tls         True    supatekro-ingress-tls         4h27m
```

### Access Applications

- **ArgoCD**: `https://argocd.example.com`
- **Harbor**: `https://harbor.example.com`
- **Keycloak**: `https://keycloak.example.com`

Log in using credentials from your `.env` file.

---

## 📦 Deploy to Local Harbor Registry

1. **Create a Project and User** in Harbor's UI.
2. **Push an Image**:
   ```bash
   docker login harbor.example.com
   docker push harbor.example.com/demo/mydockerthing:latest
   ```

---

## 🧹 Teardown

To delete the cluster and all resources:
```bash
./src/kindDown.sh
```

> ⚠️ Warning: This will remove all data stored in the cluster.

---

## 🛠 mkExample.env

You can regenerate the example.env if I have forgotten something:

```bash
src/mkExample.env
```

Feel free to submit a PR with the additions.

## 🛠 Enabling/Disabling Services

Edit `.env.enabler` to control which services are deployed:
```bash
cp src/example.env.enabler .env.enabler
```

Example:
```bash
BAO_ENABLED=true
NEXTCLOUD_ENABLED=false
```

> ⚠️ Service names in `.env.enabler` must match the format `${THIS_THING}_ENABLED` (uppercase, underscores).

---

## 📚 Documentation

- **Architecture**: [ARCHITECTURE.md](ARCHITECTURE.md)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)
- **Roadmap**: [ROADMAP.md](ROADMAP.md)

---

## 🤝 Contributing

- **Report Issues**: Open a GitHub issue for bugs or feature requests.
- **Add Applications**: Follow the [contributing guide](CONTRIBUTING.md) to add new apps.
- **Pull Requests**: All contributions are welcome!

---

## 📌 Notes

- This project is ideal for **local testing** and **development**. Do not use in production without review.
- For K3s, ensure your environment supports it (e.g., bare metal or VMs).
- TLS certificates are valid for local hosts only (e.g., `example.com`).

---

## 📞 Support

For questions or help, open an issue or join the community on Matrix (link in [CONTRIBUTING.md](CONTRIBUTING.md)).
