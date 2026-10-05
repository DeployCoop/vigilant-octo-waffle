import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPager } from '../../../components/DocsNav';

export const metadata: Metadata = { title: 'CLI & the vow TUI' };

export default function Cli() {
  return (
    <>
      <h1>CLI &amp; the vow TUI</h1>
      <p className="lede">
        Two command-line faces: <code>./up</code>, the original bash entry
        point, and <code>vow</code>, an Ink terminal UI + CLI (
        <code>apps/ink</code>) built on the same TypeScript orchestrator as
        the web control plane.
      </p>

      <h2>./up — the bash workflow</h2>
      <pre>
        <code>{`./up                        # build/rebuild the whole cluster
./up k3s:add-node --role agent                 # print a worker join one-liner
./up k3s:add-node --role agent -o ./.secrets/k3s_join_agent.sh
./up k3s:add-node --role server --ssh root@192.168.1.51 --node-name master-2
src/cdRunner.bash <app>     # deploy one app through the selected GitOps runner
./src/kindDown.sh           # teardown`}</code>
      </pre>
      <p>
        Under the hood are 164 scripts in <code>src/</code> — per-app
        installers plus shared machinery such as <code>util.bash</code> (the{' '}
        <code>initializer</code> that renders <code>init/</code> manifests),{' '}
        <code>cdRunner.bash</code>, and the two GitOps runners. The bash
        workflow and the web UI write the same files and can be used
        interchangeably against the same cluster.
      </p>

      <h2>vow — the terminal UI</h2>
      <pre>
        <code>{`pnpm vow            # launch the TUI (builds apps/ink first via pnpm ink)
vow up              # non-interactive commands work too
vow status
vow deploy <app>
vow authz init      # turn on authorization, mint the first owner`}</code>
      </pre>
      <ul>
        <li>
          Running <code>vow</code> with <code>-i</code>/<code>--interactive</code>{' '}
          anywhere on the line opens the full-screen TUI: cluster and app
          screens, task views, and the same operations the dashboard offers.
        </li>
        <li>
          Non-interactive subcommands script the engine directly — useful
          over SSH and in CI.
        </li>
        <li>
          <code>vow authz add|list|revoke|rotate|check</code> manages{' '}
          <Link href="/docs/authorization">authorization</Link> principals
          from the shell; a new principal&apos;s token is printed exactly
          once.
        </li>
      </ul>

      <h2>Growing a K3s cluster</h2>
      <p>
        With <code>THIS_K8S_TYPE=k3s</code>, nodes join across machines, VMs,
        or edge devices. Installation writes{' '}
        <code>.secrets/k3s_token</code> plus ready-to-run join scripts (
        <code>.secrets/k3s_join_agent.sh</code>,{' '}
        <code>.secrets/k3s_join_server.sh</code>). Use{' '}
        <code>./up k3s:add-node</code> (above), or the dashboard&apos;s{' '}
        <b>Join K3s Node</b> dialog on the cluster page — pick worker vs.
        control-plane, set labels/taints, then copy the curl one-liner or let
        it provision the target over SSH with streaming logs.
      </p>

      <h2>One engine, two implementations — kept honest</h2>
      <p>
        The orchestrator&apos;s managers (<code>ArgoManager</code>,{' '}
        <code>FluxManager</code>, the K3s and templating modules) are
        deliberate mirrors of the bash runners. A parity test harness renders
        fixture projects through both implementations and compares the
        output, so the TUI, the web app, and <code>./up</code> cannot quietly
        drift apart — when they disagree, CI goes red.
      </p>

      <DocPager current="/docs/cli" />
    </>
  );
}
