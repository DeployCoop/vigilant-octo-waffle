import type { Metadata } from 'next';
import { DocPager } from '../../../components/DocsNav';

export const metadata: Metadata = { title: 'Configuration' };

export default function Configuration() {
  return (
    <>
      <h1>Configuration</h1>
      <p className="lede">
        Two files drive everything: <code>.env</code> for values and{' '}
        <code>.env.enabler</code> for toggles. The web Config Studio edits the
        same files the shell reads.
      </p>

      <h2>Variables: THIS_*</h2>
      <p>
        Every template variable is named <code>THIS_*</code> —{' '}
        <code>THIS_DOMAIN</code>, <code>THIS_CD_RUNNER</code>,{' '}
        <code>THIS_K8S_TYPE</code>, <code>THIS_VELERO_BUCKET</code>, and so
        on. Resolution order is shell-like: your environment and{' '}
        <code>.env</code> override the 301 defaults in{' '}
        <code>src/default.env</code>, and defaults may reference other
        variables (they resolve to a fixpoint). Regenerate the example file
        any time with <code>src/mkExample.env</code>.
      </p>
      <pre>
        <code>{`# .env
THIS_DOMAIN=example.com
THIS_K8S_TYPE=kind            # or k3s
THIS_CD_RUNNER=argocd         # argocd | flux | both
THIS_NAMESPACE=example`}</code>
      </pre>

      <h2>Enabling services: .env.enabler</h2>
      <pre>
        <code>{`cp src/example.env.enabler .env.enabler

# .env.enabler
BAO_ENABLED=true
NEXTCLOUD_ENABLED=false`}</code>
      </pre>
      <p>
        Names must match the format <code>$&#123;THIS_THING&#125;_ENABLED</code>{' '}
        — uppercase, underscores. A disabled app is not rendered, not applied,
        and gets no ingress or certificate.
      </p>

      <h2>Overrides: change manifests without forking</h2>
      <p>
        Three override trees mirror the three template trees. Files you drop
        in are <b>deep-merged</b> over the shipped manifests with{' '}
        <code>yq</code> at render time, so an override carries only the keys
        you actually change:
      </p>
      <table>
        <thead>
          <tr>
            <th>Override dir</th>
            <th>Merges over</th>
            <th>Used by</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>.argo_overrides/&lt;app&gt;/argocd.yaml</code></td>
            <td><code>argo/&lt;app&gt;/argocd.yaml</code></td>
            <td>ArgoCD applications</td>
          </tr>
          <tr>
            <td><code>.flux_overrides/&lt;app&gt;/flux.yaml</code></td>
            <td><code>flux/&lt;app&gt;/flux.yaml</code></td>
            <td>FluxCD resources</td>
          </tr>
          <tr>
            <td><code>.init_overrides/…</code></td>
            <td><code>init/…</code></td>
            <td>Raw pre-app manifests</td>
          </tr>
        </tbody>
      </table>
      <pre>
        <code>{`mkdir -p .argo_overrides/velero
cp -a argo/velero/argocd.yaml .argo_overrides/velero/
# edit only what you mean to change, e.g.:
spec:
  source:
    helm:
      values: |
        configuration:
          backupStorageLocation:
          - provider: "\${THIS_VELERO_PROVIDER}"
            bucket: "\${THIS_VELERO_BUCKET}"`}</code>
      </pre>
      <p>
        The merge that runs is literally{' '}
        <code>
          yq e &apos;. *+ load(&quot;.argo_overrides/velero/argocd.yaml&quot;)&apos;
          argo/velero/argocd.yaml
        </code>
        , and the TypeScript engine performs the same merge — the parity
        harness keeps them identical. The web UI validates override writes
        against the app catalog and guards against path traversal.
      </p>
      <div className="callout">
        <b>Known caveat:</b> a multi-document YAML file (documents separated
        by <code>---</code>) cannot be merged this way — <code>yq</code>{' '}
        streams documents while the merge expects one. Keep overrides to a
        single document.
      </div>

      <h2>Templating semantics worth knowing</h2>
      <ul>
        <li>
          <b>Config resolution is shell-like</b>: when the engines resolve{' '}
          <code>.env</code> itself, unknown variables expand to defaults or
          empty, exactly like <code>envsubst</code>.
        </li>
        <li>
          <b>File rendering preserves literals</b>: when rendering app
          manifests, initializer manifests, cluster configs, and Helm values,
          a <code>$</code> that is not a known <code>THIS_*</code> variable
          is left untouched — so a PHP <code>$settings</code>, a token with a{' '}
          <code>$</code> in it, or the Go-template expressions inside
          OpenEBS&apos;s Alloy config survive rendering verbatim.
        </li>
        <li>
          <b>Secrets are generated, then kept</b>: per-app credentials are
          generated on first run into <code>.secrets/</code> and reused after
          that, so restarts don&apos;t rotate your passwords out from under
          your data.
        </li>
      </ul>

      <DocPager current="/docs/configuration" />
    </>
  );
}
