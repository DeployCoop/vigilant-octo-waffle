import type { Metadata } from 'next';
import Link from 'next/link';
import { DocPager } from '../../../components/DocsNav';

export const metadata: Metadata = {
  title: 'Waffle Meta-Packages & Auto-Rebuilding',
};

export default function WafflePage() {
  return (
    <>
      <h1>Waffle Meta-Packages &amp; Auto-Rebuilding</h1>
      <p className="lede">
        Waffle Meta-Packages (<code>waffle.yaml</code>) orchestrate multi-tier
        cluster ecosystems — storage foundations, databases, and microservices.
        With the <b>Waffle Watcher</b>, your local cluster continuously tracks
        application repositories, synchronizes Helm chart templates, rebuilds
        container images, imports them into containerd, and triggers zero-downtime
        cluster rollouts on change.
      </p>

      <h2>The Problem: Rapid Iteration Across Multi-Repo Stacks</h2>
      <p>
        In modern microservice architectures, developers maintain distinct git
        repositories for web frontends, API gateways, background workers, and AI
        engines, while maintaining Kubernetes manifests in Helm charts.
      </p>
      <p>
        Traditionally, making a change in a local service repository required a
        tedious manual sequence:
      </p>
      <ol>
        <li>Commit code in the local service repository.</li>
        <li>Build the Docker image locally.</li>
        <li>Manually tag and push it or import it into the local K3s containerd runtime.</li>
        <li>Remember to copy any updated Helm chart templates into the central deployment directory.</li>
        <li>Execute <code>kubectl rollout restart</code> or update the Helm release.</li>
      </ol>
      <p>
        The <b>Waffle Watcher</b> (<code>WaffleWatcher</code>) automates this
        entire lifecycle into a single persistent daemon or single-pass CLI command.
      </p>

      <h2>How It Works: The Watch &amp; Rebuild Cycle</h2>
      <pre>
        <code>{`┌────────────────────────┐      ┌─────────────────────────┐
│  Target Repositories   │ ───► │   WaffleWatcher Daemon  │
│  (git commit / mtime)  │      │   - Polls every 5s      │
└────────────────────────┘      └────────────┬────────────┘
                                             │
                       ┌─────────────────────┴─────────────────────┐
                       ▼                                           ▼
         ┌───────────────────────────┐               ┌───────────────────────────┐
         │ 1. Chart Template Sync    │               │ 2. Container Image Build  │
         │ Copy <repo>/helm/* to     │               │ Run Docker build via      │
         │ central charts/<target>   │               │ WaffleRunner              │
         └───────────────────────────┘               └─────────────┬─────────────┘
                                                                   │
                                                                   ▼
                                                     ┌───────────────────────────┐
                                                     │ 3. Multi-Node Import      │
                                                     │ sudo k3s ctr images import│
                                                     │ to all cluster nodes      │
                                                     └─────────────┬─────────────┘
                                                                   │
                                                                   ▼
                                                     ┌───────────────────────────┐
                                                     │ 4. Cluster Rollout        │
                                                     │ kubectl rollout restart   │
                                                     │ deployment/<release>      │
                                                     └───────────────────────────┘`}</code>
      </pre>

      <h2>Waffle Watcher Capabilities</h2>
      <ul>
        <li>
          <b>Git SHA &amp; Working Tree Tracking:</b> Monitors each target&apos;s
          git HEAD SHA (<code>git rev-parse HEAD</code>) as well as uncommitted file
          modifications via filesystem modification timestamps (mtime).
        </li>
        <li>
          <b>Remote Branch Polling:</b> With <code>--fetch</code>, the watcher
          can run lightweight <code>git fetch --depth 1</code> to detect commits
          pushed to upstream remotes.
        </li>
        <li>
          <b>Automated Chart Template Synchronization:</b> Detects internal
          Helm chart definitions inside service repositories (such as{' '}
          <code>helm/</code> or <code>apps/saas/helm</code>) and synchronizes
          updated templates into the central <code>charts/</code> directory while
          carefully preserving cluster-specific <code>values.yaml</code> overrides.
        </li>
        <li>
          <b>Docker Build &amp; Containerd Multi-Node Import:</b> Uses the core{' '}
          <code>WaffleRunner.buildSingleTarget</code> engine to build images
          tagged with <code>localhost:5001/&lt;target&gt;:&lt;tag&gt;</code>,
          pushes to in-cluster registry when reachable, and streams the tarball
          directly into <code>containerd</code> on the control plane and across all
          worker nodes via <code>k3s ctr -n k8s.io images import -</code>.
        </li>
        <li>
          <b>Zero-Downtime Rollouts:</b> Resolves the active deployment in the
          target namespace and triggers{' '}
          <code>kubectl rollout restart deployment/&lt;release&gt;</code>, waiting
          for rolling readiness before reporting success.
        </li>
        <li>
          <b>Umbrella Chart Synchronization:</b> When <code>--umbrella</code> is
          enabled, updates the ecosystem umbrella chart dependencies (
          <code>helm dependency update ./ecosystem</code>) after child targets
          are rebuilt.
        </li>
      </ul>

      <h2>CLI Commands &amp; Options</h2>
      <p>
        The watcher is integrated into both the <code>vow</code> binary (see{' '}
        <Link href="/docs/cli">CLI &amp; the vow TUI</Link>) and the root{' '}
        <code>./up</code> script:
      </p>

      <pre>
        <code>{`# Run continuous watch daemon across all targets in charts/waffle.yaml
./up waffle:watch charts/waffle.yaml

# Run via the vow CLI
vow waffle watch charts/waffle.yaml

# Filter specific targets
vow waffle watch charts/waffle.yaml --targets web-app,api-gateway

# Single-pass inspection / pre-commit check (exits 0 after 1 pass)
vow waffle watch charts/waffle.yaml --once

# Dry-run mode: verify target paths, SHAs, and chart mappings without building
vow waffle watch charts/waffle.yaml --dry-run --once

# Adjust polling interval (in seconds, default: 5)
vow waffle watch charts/waffle.yaml --interval 10

# Rebuild images without triggering cluster pod rollouts
vow waffle watch charts/waffle.yaml --no-deploy

# Also trigger umbrella chart dependency rebuilds
vow waffle watch charts/waffle.yaml --umbrella`}</code>
      </pre>

      <h3>Command Line Flags</h3>
      <table>
        <thead>
          <tr>
            <th>Flag</th>
            <th>Type</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>--dry-run</code></td>
            <td>boolean</td>
            <td><code>false</code></td>
            <td>Simulate repository inspection and target matching without building images or restarting deployments.</td>
          </tr>
          <tr>
            <td><code>--interval &lt;sec&gt;</code></td>
            <td>number</td>
            <td><code>5</code></td>
            <td>Polling interval in seconds between check cycles.</td>
          </tr>
          <tr>
            <td><code>--once</code></td>
            <td>boolean</td>
            <td><code>false</code></td>
            <td>Execute a single scan across all targets and exit immediately.</td>
          </tr>
          <tr>
            <td><code>--targets &lt;list&gt;</code></td>
            <td>string</td>
            <td>all</td>
            <td>Comma-separated list of build target names to monitor (e.g. <code>web-app,api-gateway</code>).</td>
          </tr>
          <tr>
            <td><code>--fetch</code></td>
            <td>boolean</td>
            <td><code>false</code></td>
            <td>Perform <code>git fetch --depth 1</code> on tracked repositories to detect remote git commits.</td>
          </tr>
          <tr>
            <td><code>--no-deploy</code></td>
            <td>boolean</td>
            <td><code>false</code></td>
            <td>Skip <code>kubectl rollout restart</code> after container images are rebuilt and imported.</td>
          </tr>
          <tr>
            <td><code>--umbrella</code></td>
            <td>boolean</td>
            <td><code>false</code></td>
            <td>Rebuild umbrella chart dependencies (<code>helm dependency update ./ecosystem</code>) after child targets change.</td>
          </tr>
          <tr>
            <td><code>--env-file &lt;path&gt;</code></td>
            <td>string</td>
            <td>auto</td>
            <td>Load environment variables from a specified dotenv file (default: <code>.env.production</code> or <code>.env</code>).</td>
          </tr>
        </tbody>
      </table>

      <h2>Configuring Build Targets in <code>waffle.yaml</code></h2>
      <p>
        Targets are declared in the <code>builds.targets</code> section of your{' '}
        <code>waffle.yaml</code> manifest:
      </p>

      <pre>
        <code>{`apiVersion: waffle.dev/v1
kind: WafflePipeline
metadata:
  name: example-ecosystem
  version: 1.0.0

builds:
  registry: "localhost:5001"
  targets:
    - name: web-app
      context: ../web-app
      image: example/web
      tag: latest
      dockerfile: Dockerfile

    - name: api-gateway
      context: ../api-gateway
      image: example/gateway
      tag: latest
      dockerfile: apps/gateway/Dockerfile

stages:
  - id: 20-apps
    name: "Application Services"
    mode: parallel
    steps:
      - id: web-app
        name: "Web Application"
        chart: ./charts/web-app
        namespace: default
        releaseName: web-app`}</code>
      </pre>

      <h2>Build Target Mappings</h2>
      <p>
        The pipeline maps target build contexts and charts across your workspace:
      </p>

      <table>
        <thead>
          <tr>
            <th>Target Name</th>
            <th>Source Context</th>
            <th>Container Image</th>
            <th>Central Chart</th>
            <th>Repo Chart Path</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>web-app</code></td>
            <td><code>../web-app</code></td>
            <td><code>example/web:latest</code></td>
            <td><code>charts/web-app</code></td>
            <td><code>helm/web-app</code></td>
          </tr>
          <tr>
            <td><code>api-gateway</code></td>
            <td><code>../api-gateway</code></td>
            <td><code>example/gateway:latest</code></td>
            <td><code>charts/api-gateway</code></td>
            <td><code>helm/api-gateway</code></td>
          </tr>
          <tr>
            <td><code>data-worker</code></td>
            <td><code>../data-worker</code></td>
            <td><code>example/worker:latest</code></td>
            <td><code>charts/data-worker</code></td>
            <td><code>helm/data-worker</code></td>
          </tr>
        </tbody>
      </table>

      <h2>Programmatic Usage via the Orchestrator SDK</h2>
      <p>
        Node.js and TypeScript services can embed the <code>WaffleWatcher</code>{' '}
        directly from <code>@vow/orchestrator</code>:
      </p>

      <pre>
        <code>{`import { WaffleWatcher } from '@vow/orchestrator';

const watcher = new WaffleWatcher({
  projectRoot: process.cwd(),
  pipelinePath: '/root/charts/waffle.yaml',
  intervalMs: 5000,
  syncCharts: true,
  autoDeploy: true,
});

watcher.on('ready', ({ targetsCount }) => {
  console.log(\`Watching \${targetsCount} build targets...\`);
});

watcher.on('change_detected', ({ target, reason }) => {
  console.log(\`Change detected in \${target}: \${reason}\`);
});

watcher.on('chart_synced', ({ target, from, to }) => {
  console.log(\`Synchronized chart templates for \${target}: \${from} -> \${to}\`);
});

watcher.on('build_complete', ({ target, image, durationMs }) => {
  console.log(\`Successfully built and imported \${image} in \${durationMs}ms\`);
});

watcher.on('deploy_complete', ({ target, release, status }) => {
  console.log(\`Deployment \${release} rollout status: \${status}\`);
});

// Start background watch loop
watcher.start();`}</code>
      </pre>

      <div className="callout">
        <b>Tip:</b> In development, keep <code>./up waffle:watch</code> running
        in a dedicated terminal window. Whenever you save a file in any tracked
        sub-repository or edit a template in its <code>helm/</code> folder, the
        watcher will immediately rebuild the container, import it into the K3s
        cluster, and refresh your running pods within seconds.
      </div>

      <DocPager current="/docs/waffle" />
    </>
  );
}
