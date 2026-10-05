import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPager } from '../../../components/DocsNav';

export const metadata: Metadata = { title: 'Getting started' };

export default function GettingStarted() {
  return (
    <>
      <h1>Getting started</h1>
      <p className="lede">
        From a fresh clone to a TLS-trusted cluster with apps reconciling —
        in four steps.
      </p>

      <h2>Requirements</h2>
      <ul>
        <li>Bash (with <code>tr</code>, <code>pwgen</code>, <code>openssl</code>) and Python 3</li>
        <li>Docker (with Compose) — KinD runs the cluster inside it</li>
        <li><code>kubectl</code>, the <code>argocd</code> CLI, and <code>yq</code> (the Go version)</li>
        <li><code>mkcert</code> for the local certificate authority</li>
        <li>KinD; K3s is optional, for the multi-node path</li>
        <li>Node.js 24 + pnpm 11 if you want the web control plane or the TUI</li>
      </ul>
      <div className="callout">
        <b>Budget your laptop:</b> enabling the whole catalog pulls ~11 GB of
        images, and a fully-loaded run uses roughly 25 GB of RAM with a
        browser open. Start with a few apps in{' '}
        <code>.env.enabler</code> and grow.
      </div>

      <h2>1. Configure</h2>
      <pre>
        <code>{`git clone https://github.com/DeployCoop/vigilant-octo-waffle.git
cd vigilant-octo-waffle
cp src/example.env .env          # domains, secrets, parameters
cp src/example.env.enabler .env.enabler   # which apps are on`}</code>
      </pre>
      <p>
        Defaults live in <code>src/default.env</code> (301 variables); anything
        you set in <code>.env</code> wins. See{' '}
        <Link href="/docs/configuration">Configuration</Link> for the variable model
        and the override system.
      </p>

      <h2>2. Names and trust</h2>
      <pre>
        <code>{`src/hostr.sh      # add example.com subdomains to /etc/hosts
mkcert -install   # trust the local CA in your browser`}</code>
      </pre>
      <p>
        Using public DNS instead of a hosts file?{' '}
        <code>src/host2bind.sh</code> generates BIND records and{' '}
        <code>src/host2cloudflare.sh</code> generates Cloudflare-compatible
        ones.
      </p>

      <h2>3. Build the cluster</h2>
      <pre>
        <code>{`./up`}</code>
      </pre>
      <p>That single command:</p>
      <ul>
        <li>deletes any existing waffle cluster,</li>
        <li>creates a fresh KinD or K3s cluster,</li>
        <li>deploys cert-manager, your GitOps runner, and the enabled apps,</li>
        <li>applies TLS certificates and ingress rules for every app.</li>
      </ul>
      <p>
        Afterwards, apps are reachable on their own trusted subdomains —{' '}
        <code>https://argocd.example.com</code>,{' '}
        <code>https://harbor.example.com</code>,{' '}
        <code>https://keycloak.example.com</code> — with credentials from your{' '}
        <code>.env</code>.
      </p>

      <h2>4. Open the control plane (optional)</h2>
      <pre>
        <code>{`pnpm install
pnpm dev        # or: docker compose up -d`}</code>
      </pre>
      <p>
        Visit <code>http://127.0.0.1:3000</code>. The dashboard and the shell
        workflow coexist: UI edits write the same <code>.env</code>, and
        cluster actions invoke the same tooling, so you can watch in the
        browser what you started in the terminal.
      </p>

      <h2>Teardown</h2>
      <pre>
        <code>{`./src/kindDown.sh`}</code>
      </pre>
      <p>
        Deletes the cluster and everything in it — including any data stored
        in-cluster. You have been warned, once, here.
      </p>

      <DocPager current="/docs/getting-started" />
    </>
  );
}
