import type { Metadata } from 'next';
import { DocPager } from '../../../components/DocsNav';

export const metadata: Metadata = { title: 'Authorization' };

export default function Authorization() {
  return (
    <>
      <h1>Authorization</h1>
      <p className="lede">
        An optional, off-by-default authorization model — modeled on
        Paperclip and enforced with CASL — for when more than one person or
        service touches the control plane.
      </p>

      <h2>Turning it on</h2>
      <pre>
        <code>{`vow authz init        # or Settings → Access & Audit → Enable authorization`}</code>
      </pre>
      <p>
        This creates <code>.vow/authz.yaml</code> (mode <code>0600</code>,
        gitignored) and a first <b>owner</b> principal whose token is shown{' '}
        <b>once</b>. Setting <code>VOW_AUTHZ=on</code> also activates the
        system. Until the first principal exists, loopback requests act as a{' '}
        <i>local board</i> with full access so you can provision that owner —
        bootstrap ends the moment a principal exists. A malformed store
        fails closed: every guarded route denies.
      </p>

      <h2>Principals, tokens, roles</h2>
      <ul>
        <li>
          Each human or service is a <b>principal</b> with a{' '}
          <code>vow_…</code> token. Only the token&apos;s SHA-256 hash is
          stored; plaintext appears once, at creation or rotation. The
          dashboard keeps your token in the browser&apos;s{' '}
          <code>localStorage</code> and attaches it to API calls.
        </li>
        <li>
          Every API route checks a permission from a <b>33-key catalog</b>{' '}
          (<code>apps:deploy</code>, <code>k8s:exec</code>,{' '}
          <code>cluster:manage</code>, <code>data:query</code>, …) — reads
          included, when authz is on.
        </li>
        <li>
          Per-principal <b>grants</b> add permissions, optionally scoped to
          one app and/or namespace; <b>revocations</b> subtract them.
        </li>
      </ul>
      <table>
        <thead>
          <tr>
            <th>Role</th>
            <th>Bundle</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>owner</code></td>
            <td>
              Everything, including <code>users:manage_permissions</code>.
              The store always keeps at least one active owner — the last one
              cannot be removed or disabled.
            </td>
          </tr>
          <tr>
            <td><code>admin</code></td>
            <td>Everything except principal management.</td>
          </tr>
          <tr>
            <td><code>operator</code></td>
            <td>
              Day-to-day operations: deploys, syncs, tasks, rollouts, helm,
              backups, and reads including pod logs — but no exec, no secret
              reads, no config writes, no cluster lifecycle, chaos, or data
              queries by default. Grant those scoped, e.g.{' '}
              <code>k8s:exec</code> in a single namespace.
            </td>
          </tr>
          <tr>
            <td><code>viewer</code></td>
            <td>
              Read-only core status (apps, cluster, config, pods, tasks,
              security). Pod logs are excluded — they routinely leak secrets.
            </td>
          </tr>
          <tr>
            <td><code>webhook</code></td>
            <td>
              No defaults; pair with an explicit <code>webhook:argo</code>{' '}
              grant for sync automation.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Redaction</h2>
      <p>
        Config-bearing responses (<code>/api/config</code>, profiles, the
        doctor) are <b>redacted</b> for callers without{' '}
        <code>secrets:read</code>: secret values are masked before the
        response leaves the server, so a viewer can see the shape of the
        configuration without seeing its credentials.
      </p>

      <h2>OIDC sign-in</h2>
      <pre>
        <code>{`VOW_OIDC_ISSUER=https://keycloak.example.com/realms/waffle
VOW_OIDC_CLIENT_ID=vow-control-plane`}</code>
      </pre>
      <p>
        With an issuer and client id set, ID tokens from any OIDC provider
        (the catalog&apos;s Keycloak works) are verified against the
        issuer&apos;s JWKS and mapped to principals by subject. A verified
        identity with no matching principal is denied (
        <code>deny_unknown_principal</code>) until an owner provisions it.
      </p>

      <h2>Audit</h2>
      <p>
        Every mutating decision and every denial appends one JSON line to{' '}
        <code>.vow/audit.log</code> — timestamp, principal, permission,
        target, outcome, and the machine-readable reason (
        <code>allow_role_default</code>, <code>deny_scope</code>,{' '}
        <code>deny_revoked</code>, …). The log rotates at 5 MiB (
        <code>VOW_AUDIT_MAX_BYTES</code>) keeping three generations, and is
        readable in <b>Access &amp; Audit</b> or via{' '}
        <code>GET /api/authz/audit</code> (owners only).
      </p>

      <h2>Managing principals</h2>
      <pre>
        <code>{`vow authz add --name ci --role webhook --grant webhook:argo
vow authz list
vow authz rotate --name ci     # new token shown once; old one dies
vow authz revoke --name ci
vow authz check --name ci --permission apps:deploy --app nextcloud`}</code>
      </pre>
      <p>
        The same operations are available in the dashboard under{' '}
        <b>Settings → Access &amp; Audit</b>, which is also where the
        bundled permission matrix for each role can be reviewed before you
        change it.
      </p>

      <DocPager current="/docs/authorization" />
    </>
  );
}
