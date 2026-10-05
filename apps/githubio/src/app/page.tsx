import Image from 'next/image';
import Link from 'next/link';
import { asset } from '../lib/base-path';

const REPO = 'https://github.com/DeployCoop/vigilant-octo-waffle';

const FEATURES = [
  {
    icon: '☸️',
    title: 'Real clusters, not mocks',
    body: 'Spin up a KinD or K3s cluster with one command or one click — full Kubernetes with ingress, storage classes, and cert-manager, pre-wired and ready to break things on.',
  },
  {
    icon: '🔐',
    title: 'TLS that actually works locally',
    body: 'A local mkcert CA issues trusted certificates for real subdomains like https://nextcloud.example.com. The TLS bugs that only appear behind certificates in production show up on your laptop instead.',
  },
  {
    icon: '🔄',
    title: 'Dual GitOps: ArgoCD & FluxCD',
    body: 'Every app deploys through ArgoCD, FluxCD, or both at once (THIS_CD_RUNNER=argocd|flux|both). Flux manifests are synthesized from the ArgoCD ones when no native file exists — no duplicated YAML.',
  },
  {
    icon: '🧩',
    title: '45+ apps, one catalog',
    body: 'Harbor, Nextcloud, OpenProject, Keycloak, OpenLDAP, Supabase, Drupal, OpenBAO, OpenSearch and more — each a templated manifest set you can enable, disable, and override without forking the repo.',
  },
  {
    icon: '🖥️',
    title: 'Three ways to drive it',
    body: 'A Next.js web control plane with a live streaming console, the vow terminal UI for keyboard-first work, and the original ./up bash workflow. All three read and write the same .env — mix them freely.',
  },
  {
    icon: '🌐',
    title: 'K3s that outgrows the laptop',
    body: 'Join worker or HA control-plane nodes across machines with a generated curl one-liner or automated SSH provisioning, and store data on OpenEBS (LVM local PVs, NFS-backed RWX, ZFS planned).',
  },
];

const APPS = [
  'ArgoCD', 'cert-manager', 'Harbor', 'Keycloak', 'Nextcloud', 'OpenProject',
  'OpenLDAP', 'OpenBAO', 'OpenSearch', 'Supabase', 'Drupal', 'FOSSBilling',
  'kube-prometheus-stack', 'Kubeshark', 'OpenEBS', 'Velero', '…and 30+ more',
];

export default function Home() {
  return (
    <div className="wrap">
      <div className="hero">
        <Image
          className="logo"
          src={asset('/logo.png')}
          alt="Vigilant Octo Waffle logo"
          width={148}
          height={148}
          priority
        />
        <h1>
          Local Kubernetes,
          <br />
          <span className="gold">minus the localhost lies.</span>
        </h1>
        <p className="lede">
          Ever chased a bug that only appears behind TLS in production — and
          couldn&apos;t reproduce it because localhost has no real
          certificates, no real ingress, no real domains? Vigilant Octo
          Waffle is the rescue: a complete, TLS-trusted, GitOps-driven
          cluster on your own machine.
        </p>
        <div className="cta">
          <Link className="btn primary" href="/docs/getting-started">
            Get started →
          </Link>
          <Link className="btn" href="/docs">
            Read the docs
          </Link>
          <a className="btn" href={REPO}>
            Star on GitHub
          </a>
        </div>
        <div className="terminal" aria-label="Quick start terminal">
          <div className="bar">
            <span className="dot a" />
            <span className="dot" />
            <span className="dot" />
            <span style={{ marginLeft: '0.4rem' }}>waffle — quick start</span>
          </div>
          <pre>
            <code>
              <span className="prompt">$ </span>git clone {REPO}.git{'\n'}
              <span className="prompt">$ </span>cp src/example.env .env &amp;&amp;
              src/hostr.sh &amp;&amp; mkcert -install{'\n'}
              <span className="prompt">$ </span>./up{'\n'}
              <span className="out">
                {'  '}✓ KinD cluster up · ArgoCD syncing · certs trusted{'\n'}
                {'  '}→ https://argocd.example.com · https://harbor.example.com
              </span>
            </code>
          </pre>
        </div>
      </div>

      <section className="block">
        <h2>Why a waffle?</h2>
        <p className="sub">
          Because production-parity is the whole point. The grid of a waffle
          is a grid of clusters, apps, and certificates — every square a real
          component behaving the way it will in production, especially the
          parts localhost usually hides: TLS termination, ingress routing,
          secret handling, and GitOps reconciliation.
        </p>
        <div className="flow" aria-label="The core templating loop">
          <div className="node">
            <b>.env + .env.enabler</b>
            <span>domains, secrets, toggles — one source of truth</span>
          </div>
          <span className="arrow">→</span>
          <div className="node">
            <b>envsubst templates</b>
            <span>the bash and TypeScript engines render the same files</span>
          </div>
          <span className="arrow">→</span>
          <div className="node">
            <b>init/ · argo/ · flux/</b>
            <span>raw manifests, ArgoCD apps, FluxCD resources</span>
          </div>
          <span className="arrow">→</span>
          <div className="node">
            <b>Your cluster</b>
            <span> KinD or K3s, TLS everywhere, apps reconciled</span>
          </div>
        </div>
      </section>

      <section className="block">
        <h2>What it does</h2>
        <p className="sub">
          Everything below ships in the repo today — no vaporware section.
        </p>
        <div className="grid">
          {FEATURES.map((f) => (
            <div className="card" key={f.title}>
              <h3>
                <span className="ic">{f.icon}</span>
                {f.title}
              </h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <h2>Pick your interface</h2>
        <p className="sub">
          Three front ends, one configuration, zero drift — the web UI writes
          the same <code>.env</code> the CLI reads, and overrides merge the
          same way from all three.
        </p>
        <div className="split">
          <div className="panel">
            <h3>🌐 Web control plane</h3>
            <p>
              A Next.js dashboard at <code>127.0.0.1:3000</code> for the whole
              lifecycle:
            </p>
            <ul>
              <li>Cluster manager, app catalog and per-app deploy/sync</li>
              <li>Config Studio for <code>.env</code> and service toggles</li>
              <li>Waffle canvas: compose and run multi-app blueprints</li>
              <li>Pods, logs, exec terminal, rollouts, backups, chaos tools</li>
              <li>Topology, traces, FinOps, storage and network views</li>
              <li>Access &amp; Audit: principals, roles, OIDC, audit log</li>
            </ul>
          </div>
          <div className="panel">
            <h3>⌨️ vow, the terminal UI</h3>
            <p>
              An Ink-based TUI and CLI that shares the orchestrator engine
              with the web app:
            </p>
            <ul>
              <li>
                <code>vow up</code>, <code>vow status</code>,{' '}
                <code>vow deploy &lt;app&gt;</code> and friends
              </li>
              <li>
                <code>vow authz add|list|revoke|rotate|check</code> for
                authorization management
              </li>
              <li>Interactive screens for clusters, apps, and tasks</li>
              <li>Same allowlisted executor — no shell, ever</li>
            </ul>
          </div>
          <div className="panel">
            <h3>🐚 ./up, the original bash</h3>
            <p>The workflow the project started with, still first-class:</p>
            <ul>
              <li>
                <code>./up</code> builds the cluster end to end
              </li>
              <li>
                <code>src/cdRunner.bash &lt;app&gt;</code> deploys via either
                GitOps runner
              </li>
              <li>
                <code>./up k3s:add-node</code> grows a K3s cluster across
                machines
              </li>
              <li>164 scripts under <code>src/</code>, mirrored by the TypeScript engine with parity tests</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="block">
        <h2>The catalog</h2>
        <p className="sub">
          Enable what you need in <code>.env.enabler</code> — start small: a
          full catalog run wants ~11 GB of images and a healthy laptop.
        </p>
        <div className="chips">
          {APPS.map((app) => (
            <span className="chip" key={app}>
              {app}
            </span>
          ))}
        </div>
      </section>

      <section className="block">
        <h2>Security is a feature, not a footnote</h2>
        <p className="sub">
          A control plane that mounts the Docker socket is root-equivalent —
          so the waffle is honest about its boundaries and layers its
          defenses.
        </p>
        <div className="grid">
          <div className="card">
            <h3>Loopback-only by design</h3>
            <p>
              The control plane binds <code>127.0.0.1</code> only, with origin
              and CSRF checks on every mutating route. Exposing it beyond
              your machine without an authenticated proxy is a documented
              don&apos;t.
            </p>
          </div>
          <div className="card">
            <h3>No shell, allowlisted binaries</h3>
            <p>
              The executor runs with <code>shell: false</code> and a strict
              allowlist (kubectl, helm, kind, k3d, argocd, flux, …). Shell
              flags and path traversal are blocked, in both engines.
            </p>
          </div>
          <div className="card">
            <h3>Real authorization (optional)</h3>
            <p>
              Turn on CASL-based authz and every route checks one of 33
              permissions per principal: owner, admin, operator, viewer, and
              webhook roles; scoped grants and revocations; OIDC sign-in;
              secret redaction; and a JSONL audit log. Off by default —
              zero-config stays zero-config.
            </p>
          </div>
        </div>
        <div className="cta" style={{ marginTop: '1.8rem' }}>
          <Link className="btn primary" href="/docs/getting-started">
            Build your waffle →
          </Link>
          <Link className="btn" href="/docs/authorization">
            How authorization works
          </Link>
        </div>
      </section>
    </div>
  );
}
