import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPager } from '../../../components/DocsNav';

export const metadata: Metadata = { title: 'Web control plane' };

export default function WebControlPlane() {
  return (
    <>
      <h1>Web control plane</h1>
      <p className="lede">
        A Next.js dashboard (App Router) over the same engine and the same{' '}
        <code>.env</code> as the CLI — run it with <code>pnpm dev</code> or{' '}
        <code>docker compose up -d</code>, at <code>127.0.0.1:3000</code>.
      </p>

      <h2>What&apos;s inside</h2>
      <table>
        <thead>
          <tr>
            <th>Area</th>
            <th>What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cluster</td>
            <td>
              Create/destroy KinD, K3d and K3s clusters; join K3s nodes with
              generated one-liners or SSH provisioning, with live logs.
            </td>
          </tr>
          <tr>
            <td>Apps</td>
            <td>
              The catalog: deploy, sync, inspect and switch GitOps runner per
              app; edit per-app overrides in the browser.
            </td>
          </tr>
          <tr>
            <td>Waffle</td>
            <td>
              A canvas for composing multi-app blueprints from sources, with
              run history and a live run terminal.
            </td>
          </tr>
          <tr>
            <td>Config Studio</td>
            <td>
              Edit <code>.env</code> and <code>.env.enabler</code> as a form;
              changes land in the same files the shell workflow reads.
            </td>
          </tr>
          <tr>
            <td>Operate</td>
            <td>
              Pods and logs, an exec terminal, rollouts, Helm, backups,
              storage (OpenEBS), networking, certificates, and a vault view.
            </td>
          </tr>
          <tr>
            <td>Observe</td>
            <td>
              Topology, traces, FinOps cost views, and a security posture
              page.
            </td>
          </tr>
          <tr>
            <td>Chaos &amp; data</td>
            <td>
              Chaos experiments and data queries for rehearsing failure —
              both behind the strictest authorization permissions.
            </td>
          </tr>
          <tr>
            <td>Access &amp; Audit</td>
            <td>
              Manage authorization: principals, tokens, grants, OIDC, and the
              audit log (<Link href="/docs/authorization">details</Link>).
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Tasks that survive a restart</h2>
      <p>
        Long operations (cluster builds, deploys, syncs) run as tracked tasks
        with streaming logs. Task <i>records</i> persist to SQLite at{' '}
        <code>.vow/state.db</code>, so history, status, and output survive a
        control-plane restart; rows a dead process left marked{' '}
        <code>running</code> are reconciled on next start. Live PTY sessions
        and streams are deliberately ephemeral — they hold OS resources that
        cannot outlive the process.
      </p>

      <h2>The security model, plainly</h2>
      <div className="callout">
        <b>Critical:</b> the control plane mounts the host Docker socket and
        your kubeconfig. Whoever can reach it can drive your machine. It
        binds <code>127.0.0.1</code> only — do not rebind it to{' '}
        <code>0.0.0.0</code> or expose it on a LAN without an authenticated
        reverse proxy in front.
      </div>
      <ul>
        <li>
          <b>Origin/CSRF middleware</b>: mutating <code>/api/*</code> routes
          reject non-local origins and mismatched Host/Origin headers with
          403.
        </li>
        <li>
          <b>Legacy shared token</b>: setting <code>VOW_API_TOKEN</code>{' '}
          requires a Bearer token on mutating routes. Once authorization is
          enabled it becomes a bootstrap-owner credential — migrate to
          per-principal tokens and unset it.
        </li>
        <li>
          <b>Webhook token</b>: <code>VOW_WEBHOOK_TOKEN</code> scopes a
          credential to the ArgoCD sync webhook only.
        </li>
        <li>
          <b>Executor allowlist</b>: commands run with <code>shell: false</code>{' '}
          against a fixed binary allowlist (<code>kubectl</code>,{' '}
          <code>helm</code>, <code>kind</code>, <code>k3d</code>,{' '}
          <code>k3s</code>, <code>argocd</code>, <code>flux</code>,{' '}
          <code>velero</code>, <code>docker</code>, <code>mkcert</code>,{' '}
          <code>ssh</code>) plus the repo&apos;s own scripts. Shell flags and
          traversal are blocked.
        </li>
        <li>
          <b>Authorization</b> (optional, off by default): per-principal
          permissions on every route, secret redaction, OIDC, and an audit
          log — see <Link href="/docs/authorization">Authorization</Link>.
        </li>
      </ul>

      <DocPager current="/docs/web-control-plane" />
    </>
  );
}
