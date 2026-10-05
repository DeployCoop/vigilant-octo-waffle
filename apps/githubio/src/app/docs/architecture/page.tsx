import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPager } from '../../../components/DocsNav';

export const metadata: Metadata = { title: 'Architecture' };

export default function Architecture() {
  return (
    <>
      <h1>Architecture</h1>
      <p className="lede">
        A pnpm monorepo around one idea: environment-driven templates,
        rendered identically by a bash engine and a TypeScript engine, into a
        local cluster that behaves like production.
      </p>

      <h2>The core loop</h2>
      <div className="flow">
        <div className="node">
          <b>.env / .env.enabler</b>
          <span>values, secrets, app toggles</span>
        </div>
        <span className="arrow">→</span>
        <div className="node">
          <b>envsubst rendering</b>
          <span>templates in init/, argo/, flux/</span>
        </div>
        <span className="arrow">→</span>
        <div className="node">
          <b>apply or hand to GitOps</b>
          <span>kubectl · ArgoCD Application · Flux resources</span>
        </div>
        <span className="arrow">→</span>
        <div className="node">
          <b>KinD / K3s cluster</b>
          <span>ingress + cert-manager issue real TLS</span>
        </div>
      </div>
      <p>
        That loop is the whole system. Everything else — the web control
        plane, the TUI, the authorization layer — is a way to drive it, watch
        it, or guard it.
      </p>

      <h2>Repository map</h2>
      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>src/</code></td>
            <td>
              164 bash scripts: per-app installers plus the shared library
              (<code>util.bash</code>), runners (<code>cdRunner</code>,{' '}
              <code>argoRunner</code>, <code>fluxRunner</code>), and cluster
              lifecycle (KinD, K3s, node joins).
            </td>
          </tr>
          <tr>
            <td><code>argo/ · flux/ · init/</code></td>
            <td>
              The templates: ArgoCD application manifests, native FluxCD
              manifests, and raw manifests applied before apps.
            </td>
          </tr>
          <tr>
            <td><code>packages/orchestrator</code></td>
            <td>
              The TypeScript engine: config resolution, templating and YAML
              merge, secret generation, the allowlisted process executor,
              cluster/app/GitOps managers, the authz engine, and the{' '}
              <code>vow authz</code> CLI core.
            </td>
          </tr>
          <tr>
            <td><code>apps/web</code></td>
            <td>
              The Next.js control plane: dashboard, 56 API route groups, task
              streaming, and the authorization guards and admin surface.
            </td>
          </tr>
          <tr>
            <td><code>apps/ink</code></td>
            <td>
              The <code>vow</code> terminal UI and CLI (Ink + commander) over
              the orchestrator.
            </td>
          </tr>
          <tr>
            <td><code>apps/githubio</code></td>
            <td>This site: a static Next.js export, deployed to GitHub Pages.</td>
          </tr>
          <tr>
            <td><code>.vow/</code> (per project, gitignored)</td>
            <td>
              Runtime state: <code>authz.yaml</code>, <code>audit.log</code>,
              and the SQLite task store <code>state.db</code>.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Two engines, one behavior</h2>
      <p>
        The orchestrator&apos;s managers are hand-maintained mirrors of the
        bash runners — <code>FluxManager</code> ↔{' '}
        <code>fluxRunner.bash</code>, <code>ArgoManager</code> ↔{' '}
        <code>argoRunner.bash</code>, and so on. A parity harness renders
        fixture projects (including overrides and generated secrets) through
        both implementations and diffs the rendered output; the harness has
        caught real divergences in the past, which is why it runs in CI with{' '}
        <code>VOW_PARITY_REQUIRED=1</code>. One documented edge remains:
        multi-document YAML overrides merge differently (the TS merge is
        single-document; <code>yq</code> streams).
      </p>

      <h2>The executor</h2>
      <p>
        Every command the engines run goes through one executor with{' '}
        <code>shell: false</code> and a binary allowlist. Tasks are tracked by
        a process manager that streams logs to the web UI and TUI, and
        persists task records to SQLite (<code>.vow/state.db</code>, WAL,
        mode <code>0600</code>) — see{' '}
        <Link href="/docs/web-control-plane">Web control plane</Link>.
      </p>

      <h2>Authorization components</h2>
      <ul>
        <li>
          <b>Engine</b> (<code>packages/orchestrator/src/authz.ts</code>):
          the 33-key permission catalog, role bundles, the YAML store
          loader/saver, CASL ability construction, a central{' '}
          <code>decide()</code> returning machine-readable reasons, and the
          last-active-owner invariant.
        </li>
        <li>
          <b>Web guards</b> (<code>apps/web/src/lib/authz.ts</code>): every
          API route resolves a principal and runs <code>decide()</code>; a
          coverage test fails CI if a route ever ships unguarded. Redaction
          masks secrets for callers without <code>secrets:read</code>.
        </li>
        <li>
          <b>OIDC</b>: Bearer ID tokens verified against the issuer&apos;s
          JWKS (<code>jose</code>), mapped to principals by subject.
        </li>
        <li>
          <b>Dashboard gating</b>: the client rebuilds the caller&apos;s
          CASL ability from <code>/api/authz/me</code> to hide controls the
          API would deny anyway — a UX mirror only; the API re-decides every
          request.
        </li>
      </ul>
      <p>
        The full design record lives in the repository as{' '}
        <code>ARCHITECTURE.md</code> and <code>authz_implementation.md</code>;
        the roadmap (<code>ROADMAP.md</code>) tracks what&apos;s next,
        including OpenBAO-backed secrets and kubeconfig-context grant
        scoping.
      </p>

      <DocPager current="/docs/architecture" />
    </>
  );
}
