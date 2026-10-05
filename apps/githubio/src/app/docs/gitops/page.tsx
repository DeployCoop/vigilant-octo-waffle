import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPager } from '../../../components/DocsNav';

export const metadata: Metadata = { title: 'GitOps: ArgoCD & FluxCD' };

export default function Gitops() {
  return (
    <>
      <h1>GitOps: ArgoCD &amp; FluxCD</h1>
      <p className="lede">
        Most local stacks pick one GitOps engine. The waffle runs either — or
        both at once — over the same application definitions, which makes it
        a unusually honest place to compare them or rehearse a migration.
      </p>

      <h2>Choosing the runner</h2>
      <pre>
        <code>{`# .env (or Config Studio in the web UI)
THIS_CD_RUNNER=argocd   # argocd | flux | both`}</code>
      </pre>
      <table>
        <thead>
          <tr>
            <th>Value</th>
            <th>What happens</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>argocd</code> (default)</td>
            <td>
              ArgoCD controllers are deployed; apps are provisioned as
              ArgoCD <code>Application</code> CRs from{' '}
              <code>argo/&lt;app&gt;/argocd.yaml</code>.
            </td>
          </tr>
          <tr>
            <td><code>flux</code></td>
            <td>
              FluxCD controllers are deployed into <code>flux-system</code>;
              apps are provisioned as <code>GitRepository</code> +{' '}
              <code>HelmRelease</code>/<code>Kustomization</code> resources.
            </td>
          </tr>
          <tr>
            <td><code>both</code></td>
            <td>
              Both engines run concurrently — hybrid setups and side-by-side
              migration testing.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>One definition, both engines</h2>
      <p>
        Applications are defined once, in <code>argo/</code>. If an app has a
        native <code>flux/&lt;app&gt;/flux.yaml</code> it is used as-is; if
        not, the runners <b>synthesize</b> equivalent Flux resources from the
        ArgoCD manifest at deploy time. You never maintain two copies of the
        same app definition, and an app added for ArgoCD works under Flux the
        same day.
      </p>
      <ul>
        <li>
          Bash: <code>src/cdRunner.bash &lt;app&gt;</code> dispatches to{' '}
          <code>argoRunner.bash</code> and/or <code>fluxRunner.bash</code>{' '}
          according to <code>THIS_CD_RUNNER</code> — including delegating
          transparently when only one is selected.
        </li>
        <li>
          TypeScript: <code>FluxManager</code> in the orchestrator mirrors{' '}
          <code>fluxRunner.bash</code> (<code>prepareAppManifest</code>,{' '}
          <code>synthesizeFluxFromArgo</code>, <code>deployApp</code>,{' '}
          <code>syncApp</code>), and <code>ArgoManager</code> mirrors{' '}
          <code>argoRunner.bash</code>. A bash↔TypeScript parity harness
          renders the same fixtures through both engines and diffs the
          output.
        </li>
        <li>
          Overrides apply per runner: <code>.argo_overrides/</code> for
          ArgoCD, <code>.flux_overrides/</code> for Flux — deep-merged before
          synthesis or apply.
        </li>
      </ul>

      <h2>From the web UI</h2>
      <p>
        The app detail page carries a runner switch: flip between ArgoCD and
        FluxCD views of the same app — manifest, overrides, and live sync
        commands included. <code>/api/flux</code> exposes controller health
        and reconciliation state, and{' '}
        <code>/api/apps/[id]?runner=argocd|flux</code> deploys through the
        selected engine.
      </p>

      <h2>Sync acceleration webhook</h2>
      <p>
        ArgoCD syncs can be triggered externally via{' '}
        <code>POST /api/argo/webhook</code>. Give it its own least-privilege
        credential with <code>VOW_WEBHOOK_TOKEN</code>, and CI or a git hook
        can poke a sync without holding a control-plane token; principals
        holding the <code>webhook:argo</code> permission can call it with
        their own token too. See{' '}
        <Link href="/docs/authorization">Authorization</Link>.
      </p>

      <DocPager current="/docs/gitops" />
    </>
  );
}
