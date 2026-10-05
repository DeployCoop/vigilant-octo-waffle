import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPager } from '../../components/DocsNav';

export const metadata: Metadata = { title: 'Documentation' };

export default function DocsOverview() {
  return (
    <>
      <h1>Documentation</h1>
      <p className="lede">
        Vigilant Octo Waffle builds production-like Kubernetes clusters on a
        local machine: real domains, real TLS, real GitOps — so the bugs
        that hide until production show up where you can fix them.
      </p>

      <h2>What you get</h2>
      <ul>
        <li>
          A <b>KinD</b> (Kubernetes in Docker) or <b>K3s</b> cluster, created
          by one command (<code>./up</code>), one web click, or one TUI
          action.
        </li>
        <li>
          <b>Trusted TLS everywhere</b>: a local mkcert CA signs certificates
          for subdomains of your chosen domain (default{' '}
          <code>example.com</code>), installed into your browser&apos;s trust
          store.
        </li>
        <li>
          <b>GitOps delivery</b> with ArgoCD, FluxCD, or both — switchable per
          deployment and per app.
        </li>
        <li>
          A catalog of <b>45+ applications</b> (Harbor, Nextcloud, Keycloak,
          OpenLDAP, Supabase, OpenBAO, OpenSearch, …) rendered from templates
          you configure in <code>.env</code>.
        </li>
        <li>
          A <b>web control plane</b>, a <b>terminal UI</b> (<code>vow</code>),
          and the original <b>bash workflow</b> — three interfaces over one
          configuration and one templating engine.
        </li>
      </ul>

      <h2>How it fits together</h2>
      <p>
        Everything is driven by variable substitution. Your{' '}
        <code>.env</code> (values, secrets, domain names) and{' '}
        <code>.env.enabler</code> (which apps are on) feed templates in{' '}
        <code>init/</code>, <code>argo/</code>, and <code>flux/</code>; the
        rendered manifests are applied directly or handed to your GitOps
        runner. Two engines perform the rendering — the original bash
        scripts in <code>src/</code> and the TypeScript orchestrator in{' '}
        <code>packages/orchestrator</code> — held to identical behavior by a
        parity test harness. See{' '}
        <Link href="/docs/architecture">Architecture</Link> for the full
        picture.
      </p>

      <h2>Where to go next</h2>
      <table>
        <tbody>
          <tr>
            <td>
              <Link href="/docs/getting-started">Getting started</Link>
            </td>
            <td>Requirements, install, first cluster, teardown.</td>
          </tr>
          <tr>
            <td>
              <Link href="/docs/configuration">Configuration</Link>
            </td>
            <td>
              <code>.env</code>, <code>THIS_*</code> variables, enabler
              toggles, and the override system.
            </td>
          </tr>
          <tr>
            <td>
              <Link href="/docs/gitops">GitOps</Link>
            </td>
            <td>ArgoCD &amp; FluxCD side by side, manifest synthesis.</td>
          </tr>
          <tr>
            <td>
              <Link href="/docs/web-control-plane">Web control plane</Link>
            </td>
            <td>What the dashboard does, and its security model.</td>
          </tr>
          <tr>
            <td>
              <Link href="/docs/cli">CLI &amp; the vow TUI</Link>
            </td>
            <td>
              <code>./up</code>, <code>vow</code> commands, K3s node joining.
            </td>
          </tr>
          <tr>
            <td>
              <Link href="/docs/authorization">Authorization</Link>
            </td>
            <td>Principals, roles, scoped grants, OIDC, and the audit log.</td>
          </tr>
        </tbody>
      </table>

      <div className="callout">
        <b>Honest scope:</b> Vigilant Octo Waffle is for local testing and
        development. It is deliberately powerful on your own machine — the
        control plane can drive Docker and your cluster — and it is not a
        production platform.
      </div>

      <DocPager current="/docs" />
    </>
  );
}
