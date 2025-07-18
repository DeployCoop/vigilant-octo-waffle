# Vigilant Octo Waffle 🐙

![Vigilant Octo Waffle](src/vigilantoctowaffle.png?raw=true "Vigilant Octo Waffle")

This project provides a **Kubernetes cluster setup** using [KinD](https://kind.sigs.k8s.io) or [K3s](https://k3s.io), pre-configured with [ArgoCD](https://argoproj.github.io/argocd/) and a suite of applications. It's ideal for testing, development, and demonstrating Kubernetes-based deployments with TLS, ingress, and secrets management.

---

## 🚀 Features

- **Local Kubernetes Cluster**: Spin up a KinD or K3s cluster with a single command.
- **ArgoCD Integration**: Automate application deployments using GitOps principles.
- **TLS with mkcert**: Generate trusted certificates for local development (e.g., `https://example.com`).
- **Multi-App Support**: Includes OpenLDAP, Harbor, Nextcloud, OpenProject, and more.
- **Customizable**: Use `.env` and `.env.enabler` to configure services and enable/disable components.

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
