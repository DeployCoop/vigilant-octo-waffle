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

---

## 📁 Configuration

1. **Create `.env`**:
   ```bash
   cp src/example.env .env
   ```
   Edit the `.env` file to customize domain names, secrets, and other parameters.

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

For questions or help, open an issue or join the community on Discord (link in [CONTRIBUTING.md](CONTRIBUTING.md)).
