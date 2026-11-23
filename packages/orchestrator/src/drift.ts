/**
 * Drift detection, wired to real systems (Batch C, Phase 1).
 *
 * The scan compares git manifests against live cluster objects and
 * reports real drift — nothing here is seeded or hardcoded. The scan is
 * stateless: no resolved-ids set, no in-memory store. Reconcile and
 * reverse-commit re-scan and look the drift id up, so they always act
 * on current state.
 *
 * How the scan works:
 * 1. Probe the cluster (cached `getTelemetry()`). Not connected → throw
 *    `ClusterUnavailableError` (the web maps it to 503
 *    `cluster_unavailable`). Never an empty "all in sync" report.
 * 2. Enumerate ArgoCD applications from the live cluster
 *    (`getArgoApplications()`).
 * 3. For each app, resolve its git manifest from the project root
 *    (`argo/<dir>/argocd.yaml` via `ArgoManager.prepareAppManifest`,
 *    `flux/<dir>/flux.yaml` via `FluxManager.prepareAppManifest`).
 *    The live application name and the local dir name are often
 *    different (dir `nextcloud`, CR name `examplenc`; dir
 *    `ar80-mosquitto`, path `charts/mosquitto`), so the match is by
 *    `spec.source.path` first, live name second.
 * 4. Load the desired objects: plain-YAML manifests are parsed
 *    directly; a Helm chart directory is rendered with `helm template`
 *    (plus the Application's inline helm values, if any).
 * 5. Fetch each desired object live (`kubectl get -o json`) and list
 *    each app namespace (`kubectl get all -o json`) for orphaned
 *    resources, then diff with the shared `live-git-diff` engine.
 *
 * Reconcile syncs the app through the real GitOps controller
 * (`ArgoManager.syncApp` / `FluxManager.syncApp`) and reports the real
 * outcome. Reverse-commit returns a real unified diff of the git vs
 * live content plus the project repo's real HEAD SHA — and never commits
 * anything (`applied` is always false).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseYaml, parseYamlDocuments, stringifyYaml } from './yaml.js';
import { K8sClient, type ArgoAppStatus } from './k8s.js';
import { ClusterUnavailableError } from './errors.js';
import { ArgoManager } from './argocd.js';
import { FluxManager } from './flux.js';
import {
  processManager,
  type CommandWaitResult,
  type RunCommandOptions,
  type TaskRun,
} from './executor.js';
import { getWaffleExecutionEnv } from './waffle/shared.js';
import { assertK8sObjectName } from './exec-argv.js';
import { requireFound } from './studio-store.js';
import { findProjectRoot, loadProjectConfig } from './config.js';
import {
  diffDesiredVsLive,
  findOrphanedLiveObjects,
  buildUnifiedDiff,
  appNameFromDiffId,
  objectKey,
  type DiffItem,
  type K8sObject,
  type DesiredObjectEntry,
} from './live-git-diff.js';

export type DriftItem = DiffItem;

export interface DriftReport {
  totalScanned: number;
  inSyncCount: number;
  driftedCount: number;
  complianceScore: number;
  items: DriftItem[];
}

export interface ReverseCommitResult {
  success: boolean;
  /** Unified diff of the git content vs the live content. */
  patch: string;
  /** Project repo HEAD the patch was generated against, or null when it cannot be determined. */
  commitSha: string | null;
  /** Resources the patch covers (one, for a single drift item). */
  appliedResourceCount: number;
  /** Always false: generating a patch never commits anything. */
  applied: boolean;
  /** Present on failure (unknown drift id). */
  message?: string;
}

/** Injectable collaborators (ebpf-style deps seam): tests stub the cluster, the commands, and the sync. */
export interface DriftDeps {
  projectRoot?: string;
  k8sClient?: Pick<K8sClient, 'getTelemetry' | 'getArgoApplications'>;
  runCommand?: (
    command: string,
    args: string[],
    options: RunCommandOptions
  ) => Promise<CommandWaitResult>;
  syncApp?: (
    engine: 'argocd' | 'flux',
    appName: string,
    namespace: string
  ) => Promise<{ code: number | null }>;
  gitHeadSha?: () => Promise<string | null>;
}

/** Kinds the API server treats as cluster-scoped: `kubectl get` takes no `-n` for them. */
const CLUSTER_SCOPED_KINDS: ReadonlySet<string> = new Set([
  'namespace',
  'clusterrole',
  'clusterrolebinding',
  'customresourcedefinition',
  'storageclass',
  'persistentvolume',
  'clusterissuer',
  'node',
  'mutatingwebhookconfiguration',
  'validatingwebhookconfiguration',
  'apiservice',
]);

function isClusterScoped(kind: string): boolean {
  return CLUSTER_SCOPED_KINDS.has(kind.toLowerCase());
}

/** Resolve `relPath` under `baseDir`; null when it escapes the base (path traversal). */
function resolveWithinBase(baseDir: string, relPath: string): string | null {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, relPath);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) return null;
  return resolved;
}

function isNotFound(stderr: string): boolean {
  return stderr.includes('NotFound');
}

function isK8sObject(value: unknown): value is K8sObject {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as K8sObject;
  return (
    typeof obj.kind === 'string' &&
    obj.kind.length > 0 &&
    typeof obj.metadata?.name === 'string' &&
    obj.metadata.name.length > 0
  );
}

/** Flatten a `List` document into its items; any other document is itself. */
function flattenLists(doc: unknown): unknown[] {
  if (isK8sObject(doc) && doc.kind === 'List' && Array.isArray(doc.items)) {
    return doc.items;
  }
  return [doc];
}

/** A `kustomization.yaml` is a local build file, not a workload object. */
function isKustomizationFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  return base === 'kustomization.yaml' || base === 'kustomization.yml';
}

/** Recursively collect `*.yaml` / `*.yml` files, sorted for determinism. */
function walkYamlFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkYamlFiles(full));
    } else if (entry.isFile() && /\.ya?ml$/i.test(entry.name) && !isKustomizationFile(full)) {
      out.push(full);
    }
  }
  return out;
}

/** Objects Helm renders for install hooks run once and disappear; they are not drift. */
function isHelmHook(obj: K8sObject): boolean {
  const annotations = obj.metadata?.annotations;
  return typeof annotations === 'object' && annotations !== null && 'helm.sh/hook' in annotations;
}

function collectDesiredEntries(
  docs: unknown[],
  appName: string,
  gitFilePath: string
): DesiredObjectEntry[] {
  const entries: DesiredObjectEntry[] = [];
  for (const doc of docs) {
    for (const obj of flattenLists(doc)) {
      if (isK8sObject(obj) && !isHelmHook(obj)) {
        entries.push({ object: obj, appName, gitFilePath });
      }
    }
  }
  return entries;
}

interface ApplicationRef {
  name?: string;
  sourcePath?: string;
  namespace?: string;
  /** Inline helm values from the Application CR, as a YAML string. */
  helmValues?: string;
}

function readApplicationRef(templatedYaml: string): ApplicationRef | null {
  let doc: Record<string, unknown>;
  try {
    doc = parseYaml<Record<string, unknown>>(templatedYaml);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== 'object') return null;
  const metadata = (doc.metadata ?? {}) as Record<string, unknown>;
  const spec = (doc.spec ?? {}) as Record<string, unknown>;
  const source = (spec.source ?? {}) as Record<string, unknown>;
  const destination = (spec.destination ?? {}) as Record<string, unknown>;
  const helm = (source.helm ?? {}) as Record<string, unknown>;
  let helmValues: string | undefined;
  if (typeof helm.values === 'string' && helm.values.trim()) {
    helmValues = helm.values;
  } else if (helm.valuesObject !== undefined && helm.valuesObject !== null) {
    helmValues = stringifyYaml(helm.valuesObject);
  }
  return {
    name: typeof metadata.name === 'string' ? metadata.name : undefined,
    sourcePath: typeof source.path === 'string' ? source.path : undefined,
    namespace: typeof destination.namespace === 'string' ? destination.namespace : undefined,
    helmValues,
  };
}

function readFluxRef(templatedYaml: string): ApplicationRef | null {
  let docs: unknown[];
  try {
    docs = parseYamlDocuments<unknown>(templatedYaml);
  } catch {
    return null;
  }
  for (const doc of docs) {
    if (!isK8sObject(doc)) continue;
    if (doc.kind === 'HelmRelease') {
      const spec = (doc.spec ?? {}) as Record<string, unknown>;
      const chart = (spec.chart ?? {}) as Record<string, unknown>;
      const chartSpec = (chart.spec ?? {}) as Record<string, unknown>;
      return {
        name: doc.metadata?.name,
        sourcePath: typeof chartSpec.chart === 'string' ? chartSpec.chart : undefined,
        namespace:
          typeof spec.targetNamespace === 'string'
            ? spec.targetNamespace
            : doc.metadata?.namespace,
        helmValues:
          spec.values !== undefined && spec.values !== null
            ? stringifyYaml(spec.values)
            : undefined,
      };
    }
    if (doc.kind === 'Kustomization') {
      const spec = (doc.spec ?? {}) as Record<string, unknown>;
      return {
        name: doc.metadata?.name,
        sourcePath: typeof spec.path === 'string' ? spec.path : undefined,
        namespace:
          typeof spec.targetNamespace === 'string'
            ? spec.targetNamespace
            : doc.metadata?.namespace,
      };
    }
  }
  return null;
}

interface ResolvedAppManifest {
  /** Live Argo application name (what `argocd app sync` takes). */
  appName: string;
  /** Local `argo/` or `flux/` dir the manifest came from. */
  dirName: string;
  engine: 'argocd' | 'flux';
  /** Resolved, templated source path in the project repo. */
  sourcePath: string;
  /** Resolved, templated destination namespace. */
  namespace: string;
  helmValues?: string;
}

function tryArgoDir(
  dirName: string,
  liveName: string,
  projectRoot: string
): ResolvedAppManifest | null {
  let prepared: { templatedYaml: string };
  try {
    prepared = new ArgoManager(projectRoot).prepareAppManifest(dirName);
  } catch {
    return null;
  }
  const ref = readApplicationRef(prepared.templatedYaml);
  if (!ref || !ref.sourcePath) return null;
  return {
    appName: liveName,
    dirName,
    engine: 'argocd',
    sourcePath: ref.sourcePath,
    namespace: ref.namespace ?? 'default',
    helmValues: ref.helmValues,
  };
}

function tryFluxDir(
  dirName: string,
  liveName: string,
  projectRoot: string
): ResolvedAppManifest | null {
  let prepared: { templatedYaml: string };
  try {
    prepared = new FluxManager(projectRoot).prepareAppManifest(dirName);
  } catch {
    return null;
  }
  const ref = readFluxRef(prepared.templatedYaml);
  if (!ref || !ref.sourcePath) return null;
  return {
    appName: liveName,
    dirName,
    engine: 'flux',
    sourcePath: ref.sourcePath,
    namespace: ref.namespace ?? 'default',
    helmValues: ref.helmValues,
  };
}

function listManifestDirs(projectRoot: string, subdir: string): string[] {
  const dir = path.join(projectRoot, subdir);
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/**
 * Find the local git manifest for a live Argo application. Fast path:
 * the local dir is named after the live application. Slow path: match by
 * `spec.source.path` (the live `targetPath`) — dir names and CR names
 * are templated and routinely differ from the live name.
 */
function resolveAppManifest(app: ArgoAppStatus, projectRoot: string): ResolvedAppManifest | null {
  const direct = tryArgoDir(app.name, app.name, projectRoot) ?? tryFluxDir(app.name, app.name, projectRoot);
  if (direct) return direct;
  for (const dir of listManifestDirs(projectRoot, 'argo')) {
    const resolved = tryArgoDir(dir, app.name, projectRoot);
    if (resolved && (resolved.sourcePath === app.targetPath || dir === app.name)) return resolved;
  }
  for (const dir of listManifestDirs(projectRoot, 'flux')) {
    const resolved = tryFluxDir(dir, app.name, projectRoot);
    if (resolved && (resolved.sourcePath === app.targetPath || dir === app.name)) return resolved;
  }
  return null;
}

async function loadHelmDesired(
  resolved: ResolvedAppManifest,
  chartPath: string,
  projectRoot: string,
  run: NonNullable<DriftDeps['runCommand']>
): Promise<DesiredObjectEntry[]> {
  const args = ['template', resolved.appName, chartPath, '--namespace', resolved.namespace];
  if (resolved.helmValues) {
    const cacheDir = path.join(projectRoot, '.vow-cache', 'drift');
    fs.mkdirSync(cacheDir, { recursive: true });
    const valuesFile = path.join(cacheDir, `${resolved.appName}-values.yaml`);
    fs.writeFileSync(valuesFile, resolved.helmValues, 'utf-8');
    args.push('-f', valuesFile);
  }
  const res = await run('helm', args, { cwd: projectRoot, env: getWaffleExecutionEnv() });
  if (res.code !== 0) {
    throw new Error(`helm template failed for ${resolved.appName} (exit code ${res.code})`);
  }
  const docs = parseYamlDocuments<unknown>(res.stdout);
  return collectDesiredEntries(docs, resolved.appName, resolved.sourcePath);
}

/**
 * Load the desired objects for one app from the project repo. Returns
 * null when the source path cannot be resolved locally — the app is
 * unscannable from git and is skipped, never fabricated.
 */
async function loadDesiredObjects(
  resolved: ResolvedAppManifest,
  projectRoot: string,
  run: NonNullable<DriftDeps['runCommand']>
): Promise<DesiredObjectEntry[] | null> {
  if (!resolved.sourcePath) return null;
  const absPath = resolveWithinBase(projectRoot, resolved.sourcePath);
  if (!absPath || !fs.existsSync(absPath)) return null;
  if (fs.statSync(absPath).isDirectory()) {
    if (fs.existsSync(path.join(absPath, 'Chart.yaml'))) {
      return loadHelmDesired(resolved, absPath, projectRoot, run);
    }
    const entries: DesiredObjectEntry[] = [];
    for (const file of walkYamlFiles(absPath)) {
      const docs = parseYamlDocuments<unknown>(fs.readFileSync(file, 'utf-8'));
      entries.push(
        ...collectDesiredEntries(docs, resolved.appName, path.relative(projectRoot, file))
      );
    }
    return entries;
  }
  const docs = parseYamlDocuments<unknown>(fs.readFileSync(absPath, 'utf-8'));
  return collectDesiredEntries(docs, resolved.appName, resolved.sourcePath);
}

async function awaitTaskRun(task: TaskRun): Promise<number | null> {
  if (task.status !== 'running') return task.exitCode ?? null;
  const code = await new Promise<number | null>((resolve) => {
    task.emitter.once('close', (c: number | null) => resolve(c));
  });
  return code ?? task.exitCode ?? null;
}

async function defaultSyncApp(
  engine: 'argocd' | 'flux',
  appName: string,
  namespace: string,
  projectRoot: string
): Promise<{ code: number | null }> {
  if (engine === 'flux') {
    const task = new FluxManager(projectRoot).syncApp(appName, namespace);
    return { code: await awaitTaskRun(task) };
  }
  const task = new ArgoManager(projectRoot).syncApp(appName);
  return { code: await awaitTaskRun(task) };
}

async function defaultGitHeadSha(
  projectRoot: string,
  run: NonNullable<DriftDeps['runCommand']>
): Promise<string | null> {
  const res = await run('git', ['rev-parse', 'HEAD'], { cwd: projectRoot });
  if (res.code !== 0) return null;
  const sha = res.stdout.trim();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

export async function scanClusterDrift(deps: DriftDeps = {}): Promise<DriftReport> {
  const projectRoot = deps.projectRoot ?? findProjectRoot();
  const k8s = deps.k8sClient ?? new K8sClient();
  const telemetry = await k8s.getTelemetry();
  if (!telemetry.isConnected) {
    throw new ClusterUnavailableError();
  }
  const { installed, applications } = await k8s.getArgoApplications();
  if (!installed || applications.length === 0) {
    return { totalScanned: 0, inSyncCount: 0, driftedCount: 0, complianceScore: 100, items: [] };
  }
  const run =
    deps.runCommand ??
    ((command: string, args: string[], options: RunCommandOptions) =>
      processManager.runCommandAndWait(command, args, options));

  // Pass 1 — load every app's desired objects. Orphan detection runs
  // once over the union below: per-app calls would flag another app's
  // objects as orphaned whenever two apps share a namespace.
  const desired: DesiredObjectEntry[] = [];
  const appsByNamespace = new Map<string, ResolvedAppManifest[]>();
  for (const app of applications) {
    if (!app.name) continue;
    const resolved = resolveAppManifest(app, projectRoot);
    if (!resolved) continue; // No git manifest locally: unscannable, skipped.
    const entries = await loadDesiredObjects(resolved, projectRoot, run);
    if (!entries || entries.length === 0) continue;
    const withNs = entries.map((entry) => {
      const obj = entry.object;
      if (
        obj.metadata &&
        !obj.metadata.namespace &&
        !isClusterScoped(typeof obj.kind === 'string' ? obj.kind : '')
      ) {
        // Fill in the app destination namespace where the manifest omits
        // it (helm template output usually carries no namespace): the
        // engine keys objects by kind/namespace/name, so live and
        // desired must agree on it.
        return {
          ...entry,
          object: { ...obj, metadata: { ...obj.metadata, namespace: resolved.namespace } },
        };
      }
      return entry;
    });
    desired.push(...withNs);
    const list = appsByNamespace.get(resolved.namespace) ?? [];
    list.push(resolved);
    appsByNamespace.set(resolved.namespace, list);
  }

  // Pass 2 — fetch live state for every desired object, plus everything
  // actually running in the apps' namespaces (for orphan detection).
  const liveByKey = new Map<string, K8sObject>();
  const namespaces = new Set<string>();
  for (const entry of desired) {
    const obj = entry.object;
    const kind = obj.kind as string;
    const name = obj.metadata?.name as string;
    const namespace = (obj.metadata?.namespace as string | undefined) ?? 'default';
    namespaces.add(namespace);
    const args = isClusterScoped(kind)
      ? ['get', kind.toLowerCase(), name, '-o', 'json']
      : ['get', kind.toLowerCase(), name, '-n', namespace, '-o', 'json'];
    const res = await run('kubectl', args, {
      cwd: projectRoot,
      env: getWaffleExecutionEnv(),
    });
    if (res.code === 0) {
      try {
        liveByKey.set(objectKey(kind, namespace, name), JSON.parse(res.stdout) as K8sObject);
      } catch {
        throw new Error(
          `kubectl returned unparseable JSON for ${kind}/${name} in ${namespace}`
        );
      }
    } else if (!isNotFound(res.stderr)) {
      // A real kubectl failure (not a missing object) surfaces; only
      // NotFound means "absent", which the engine reports as drift.
      throw new Error(
        `Failed to read live state for ${kind}/${name} in ${namespace} (kubectl exit code ${res.code})`
      );
    }
  }
  const desiredKeys = new Set(
    desired.map((entry) =>
      objectKey(
        entry.object.kind as string,
        (entry.object.metadata?.namespace as string | undefined) ?? 'default',
        entry.object.metadata?.name as string
      )
    )
  );
  for (const namespace of namespaces) {
    const res = await run('kubectl', ['get', 'all', '-n', namespace, '-o', 'json'], {
      cwd: projectRoot,
      env: getWaffleExecutionEnv(),
    });
    if (res.code !== 0) {
      throw new Error(
        `Failed to list live resources in ${namespace} (kubectl exit code ${res.code})`
      );
    }
    let parsed: { items?: K8sObject[] };
    try {
      parsed = JSON.parse(res.stdout) as { items?: K8sObject[] };
    } catch {
      throw new Error(`kubectl returned unparseable JSON for namespace ${namespace}`);
    }
    for (const obj of parsed.items ?? []) {
      if (!isK8sObject(obj)) continue;
      const key = objectKey(
        obj.kind as string,
        (obj.metadata?.namespace as string | undefined) ?? namespace,
        obj.metadata?.name as string
      );
      // Individual gets are authoritative for desired objects: an object
      // whose own `kubectl get` 404'd stays missing even if a concurrent
      // `get all` still lists it (delete/create race). `get all` only
      // contributes objects the scan never asked for individually — the
      // orphan candidates.
      if (desiredKeys.has(key) || liveByKey.has(key)) continue;
      liveByKey.set(key, obj);
    }
  }

  // Pass 3 — one diff over the union, then one global orphan pass.
  const items: DriftItem[] = diffDesiredVsLive(desired, liveByKey);
  const orphans = findOrphanedLiveObjects(desiredKeys, liveByKey, {
    attribute: (obj) => {
      const namespace = (obj.metadata?.namespace as string | undefined) ?? '';
      const owners = appsByNamespace.get(namespace) ?? [];
      if (owners.length === 1) {
        return { appName: owners[0].appName, gitFilePath: owners[0].sourcePath };
      }
      // No single owning app (or none): attribute to the namespace
      // itself. Reconcile refuses orphans anyway; reverse-commit works.
      return { appName: namespace || 'unknown', gitFilePath: '' };
    },
  });
  items.push(...orphans);

  const compared = desired.length;
  const orphanedCount = orphans.length;
  const totalScanned = compared + orphanedCount;
  const inSyncCount = compared - (items.length - orphanedCount);
  const driftedCount = items.length;
  const complianceScore =
    totalScanned === 0 ? 100 : Math.round((inSyncCount / totalScanned) * 100);

  return { totalScanned, inSyncCount, driftedCount, complianceScore, items };
}

export async function reconcileClusterFromGit(
  driftId: string,
  deps: DriftDeps = {}
): Promise<{ success: boolean; message: string }> {
  const report = await scanClusterDrift(deps);
  const item = requireFound(report.items, (i) => i.id === driftId);
  if (!item) {
    return { success: false, message: `Drift ${driftId} not found.` };
  }
  if (item.driftType === 'ORPHANED_RESOURCE') {
    // Syncing an app cannot remove an object git never declared (the
    // GitOps controller only manages objects it previously applied).
    // Adopt it with reverse-commit, or delete the live object directly.
    return {
      success: false,
      message: `Orphaned resource ${item.resourceName} cannot be reconciled by syncing: it is not declared in Git. Adopt it with reverse-commit or delete it from the cluster.`,
    };
  }
  const appName = appNameFromDiffId(driftId, 'drift');
  if (!appName) {
    return { success: false, message: `Drift ${driftId} not found.` };
  }
  // The app name comes from the scanned item's id, which the scan built
  // from the live Argo application name — but it still passes through
  // the validator before reaching any command line.
  assertK8sObjectName(appName, 'application name');
  const projectRoot = deps.projectRoot ?? findProjectRoot();
  const engine =
    loadProjectConfig(projectRoot).cluster.cdRunner === 'flux' ? 'flux' : 'argocd';
  const sync =
    deps.syncApp ?? ((e, a, n) => defaultSyncApp(e, a, n, projectRoot));
  const result = await sync(engine, appName, item.namespace);
  if (result.code === 0) {
    return {
      success: true,
      message:
        `Reconciled from Git: ${engine === 'flux' ? 'Flux' : 'ArgoCD'} sync requested for ` +
        `${appName}; live mutations for ${driftId} will be reverted by the GitOps controller.`,
    };
  }
  return {
    success: false,
    message: `Reconcile sync failed for ${appName} (exit code ${result.code}).`,
  };
}

export async function generateReverseCommitPatch(
  driftId: string,
  deps: DriftDeps = {}
): Promise<ReverseCommitResult> {
  const report = await scanClusterDrift(deps);
  const item = requireFound(report.items, (i) => i.id === driftId);
  if (!item) {
    return {
      success: false,
      patch: '',
      commitSha: null,
      appliedResourceCount: 0,
      applied: false,
      message: `Drift ${driftId} not found.`,
    };
  }
  const patch = buildUnifiedDiff(item.gitFilePath, item.gitContent, item.liveContent);
  const projectRoot = deps.projectRoot ?? findProjectRoot();
  const commitSha = await (deps.gitHeadSha ??
    (() =>
      defaultGitHeadSha(
        projectRoot,
        deps.runCommand ??
          ((command: string, args: string[], options: RunCommandOptions) =>
            processManager.runCommandAndWait(command, args, options))
      )))();
  return {
    success: true,
    patch,
    commitSha,
    appliedResourceCount: 1,
    applied: false,
  };
}
