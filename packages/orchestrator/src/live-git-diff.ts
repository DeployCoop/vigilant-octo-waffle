/**
 * Shared live-vs-desired diff engine (Batch C wiring, Phase 1).
 *
 * Drift compares git manifests against live cluster objects; rewind
 * compares a snapshot against live objects. Both are the same operation:
 * given desired objects and live objects, find what differs. This module
 * is that operation — pure functions, no cluster access, no filesystem,
 * no module state — so both studios (and any later one) share it.
 *
 * Comparison is desired-subset: only fields declared in the desired
 * object are compared. Live objects carry server-side defaults (strategy,
 * clusterIP, ...) that git never declares; comparing the whole live
 * object would flag every resource as drifted. Live-only fields are
 * therefore ignored, except for orphan detection (a live object with no
 * owner and no desired counterpart).
 *
 * Item ids are opaque handles of the form
 * `<prefix>:<app>:<kind>:<namespace>:<name>` — the `:` separators are
 * unambiguous (K8s names never contain `:`), so callers can recover the
 * app from an id without storing state. Drift keeps no resolved-ids set
 * anymore; reconcile / reverse-commit re-scan and look the id up.
 */

import { stringifyYaml } from './yaml.js';

export type K8sObject = Record<string, unknown> & {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    ownerReferences?: { name?: string; kind?: string }[];
    [key: string]: unknown;
  };
};

export interface DesiredObjectEntry {
  object: K8sObject;
  /** Application the object belongs to; embedded in item ids. */
  appName: string;
  /** Path of the git manifest the object was declared in, relative to the project root. */
  gitFilePath: string;
}

export type DriftKind =
  | 'REPLICA_COUNT_DRIFT'
  | 'ENV_VAR_DRIFT'
  | 'IMAGE_TAG_DRIFT'
  | 'RESOURCE_LIMIT_DRIFT'
  | 'ORPHANED_RESOURCE'
  // Generic fallback: the desired and live objects differ in a field no
  // narrower type covers. New drift shapes land here rather than being
  // forced into a wrong specific type or silently dropped.
  | 'SPEC_DRIFT';

export type DriftSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface DiffItem {
  id: string;
  resourceName: string;
  namespace: string;
  kind: string;
  driftType: DriftKind;
  gitFilePath: string;
  gitContent: string;
  liveContent: string;
  diffSummary: string;
  severity: DriftSeverity;
  driftDetectedAt: string;
}

export interface DiffOptions {
  /** Id prefix, e.g. 'drift' (default) or 'rewind'. */
  idPrefix?: string;
  /** Detection timestamp; defaults to now. */
  detectedAt?: string;
}

export interface OrphanOptions {
  /** Id prefix, e.g. 'drift' (default) or 'rewind'. */
  idPrefix?: string;
  /** Detection timestamp; defaults to now. */
  detectedAt?: string;
  /**
   * Attribute an orphaned live object to an app for its id and git file
   * path. Orphans belong to no desired object, so the caller decides:
   * drift attributes to the app owning the orphan's namespace (or the
   * namespace itself when no single app owns it). Must always return
   * an attribution — orphans are reported, never dropped.
   */
  attribute: (obj: K8sObject) => { appName: string; gitFilePath: string };
}

/** Live objects that are part of the cluster itself, not an app's drift. */
const CLUSTER_MANAGED_LIVE: ReadonlySet<string> = new Set([
  // The API server's own Service, present in every cluster's `default`
  // namespace. `kubectl get all` returns it, and it is never in git.
  'service/default/kubernetes',
]);

const LIVE_ONLY_METADATA_KEYS: ReadonlySet<string> = new Set([
  'uid',
  'resourceVersion',
  'creationTimestamp',
  'managedFields',
  'generation',
  'selfLink',
]);

const SYSTEM_ANNOTATIONS: ReadonlySet<string> = new Set([
  'kubectl.kubernetes.io/last-applied-configuration',
  'deployment.kubernetes.io/revision',
]);

export function objectKey(kind: string, namespace: string, name: string): string {
  return `${kind.toLowerCase()}/${namespace}/${name}`;
}

export function buildDiffId(
  prefix: string,
  appName: string,
  kind: string,
  namespace: string,
  name: string
): string {
  return `${prefix}:${appName}:${kind.toLowerCase()}:${namespace}:${name}`;
}

/** Recover the app segment from an id built by `buildDiffId`. */
export function appNameFromDiffId(id: string, prefix = 'drift'): string | null {
  const parts = id.split(':');
  if (parts.length !== 5 || parts[0] !== prefix) return null;
  return parts[1] || null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Recursively drop `creationTimestamp` keys (never desired state). */
function stripCreationTimestamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripCreationTimestamps);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'creationTimestamp') continue;
      out[k] = stripCreationTimestamps(v);
    }
    return out;
  }
  return value;
}

/**
 * A live object with its server-side-only fields removed, for comparison
 * and display. `status` is live-only; so are the metadata bookkeeping
 * fields and the two annotations kubectl/Argo manage themselves.
 */
export function normalizeForCompare(obj: K8sObject): K8sObject {
  const clone = deepClone(obj);
  delete clone.status;
  const meta = clone.metadata;
  if (isPlainObject(meta)) {
    for (const key of LIVE_ONLY_METADATA_KEYS) delete meta[key];
    const annotations = meta.annotations;
    if (isPlainObject(annotations)) {
      for (const key of Object.keys(annotations)) {
        if (SYSTEM_ANNOTATIONS.has(key)) delete annotations[key];
      }
      if (Object.keys(annotations).length === 0) delete meta.annotations;
    }
  }
  return stripCreationTimestamps(clone) as K8sObject;
}

export interface LeafDiff {
  /** Dotted leaf path, e.g. `spec.replicas` or `spec.template.spec.containers[web].image`. */
  path: string;
  gitValue: unknown;
  liveValue: unknown;
  missingInLive: boolean;
  /** Live carries an element git never declared (e.g. a hot-patched env var). */
  missingInGit: boolean;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
}

function isNameKeyedArray(value: unknown[]): boolean {
  return value.every(
    (el) => isPlainObject(el) && typeof el.name === 'string'
  );
}

/**
 * Walk the desired value; every leaf declared in git is compared with
 * the live value at the same path. Live-only leaves are ignored — with
 * one exception: live-only *elements* of an array git declares. The
 * server never invents a named env var, container, or port, so a live
 * element with no git counterpart is a real mutation (the hunt's
 * hot-patched `KC_LOG_LEVEL=DEBUG` case), not a server default. The
 * same holds for ordered-array elements past git's length. (Caveat: a
 * mesh sidecar injector adds a container the same way; on a meshed
 * cluster that reads as drift, which is at least visible, not silent.)
 * Name-keyed arrays (env vars, containers, ports, volumes) match by
 * `.name`, order-insensitive; other arrays compare by index.
 */
function collectDiffs(gitValue: unknown, liveValue: unknown, path: string, out: LeafDiff[]): void {
  if (liveValue === undefined) {
    out.push({ path, gitValue, liveValue: undefined, missingInLive: true, missingInGit: false });
    return;
  }
  if (Array.isArray(gitValue) && Array.isArray(liveValue)) {
    if (gitValue.length > 0 && isNameKeyedArray(gitValue) && isNameKeyedArray(liveValue)) {
      const liveByName = new Map(
        liveValue.map((el) => [(el as Record<string, unknown>).name as string, el])
      );
      const gitNames = new Set<string>();
      for (const el of gitValue) {
        const name = (el as Record<string, unknown>).name as string;
        gitNames.add(name);
        const match = liveByName.get(name);
        if (match === undefined) {
          out.push({ path: `${path}[${name}]`, gitValue: el, liveValue: undefined, missingInLive: true, missingInGit: false });
        } else {
          collectDiffs(el, match, `${path}[${name}]`, out);
        }
      }
      for (const el of liveValue) {
        const name = (el as Record<string, unknown>).name as string;
        if (!gitNames.has(name)) {
          out.push({ path: `${path}[${name}]`, gitValue: undefined, liveValue: el, missingInLive: false, missingInGit: true });
        }
      }
      return;
    }
    for (let i = 0; i < gitValue.length; i++) {
      collectDiffs(gitValue[i], liveValue[i], `${path}[${i}]`, out);
    }
    for (let i = gitValue.length; i < liveValue.length; i++) {
      out.push({ path: `${path}[${i}]`, gitValue: undefined, liveValue: liveValue[i], missingInLive: false, missingInGit: true });
    }
    return;
  }
  if (isPlainObject(gitValue) && isPlainObject(liveValue)) {
    for (const key of Object.keys(gitValue)) {
      collectDiffs(gitValue[key], liveValue[key], path ? `${path}.${key}` : key, out);
    }
    // Labels are user-controlled metadata: nothing in the cluster invents
    // a label key, so a live-only key inside a labels map is a real
    // hot-patch (e.g. a label added to a pod template), not a server
    // default. The top-level metadata.labels map is the exception — Helm
    // and ArgoCD add tooling labels there (app.kubernetes.io/managed-by,
    // argocd.argoproj.io/instance) — so it stays desired-subset like
    // every other object. Annotations get no carve-out: `kubectl rollout
    // restart` writes kubectl.kubernetes.io/restartedAt into the pod
    // template's annotations, which would read as drift on every restart.
    if (path !== 'metadata.labels' && path.endsWith('labels')) {
      for (const key of Object.keys(liveValue)) {
        if (!(key in gitValue)) {
          out.push({
            path: `${path}.${key}`,
            gitValue: undefined,
            liveValue: liveValue[key],
            missingInLive: false,
            missingInGit: true,
          });
        }
      }
    }
    return;
  }
  if (!deepEqual(gitValue, liveValue)) {
    out.push({ path, gitValue, liveValue, missingInLive: false, missingInGit: false });
  }
}

/**
 * The live object projected onto the desired object's shape: the same
 * fields git declares, with live values. Rendered next to the desired
 * object, the two panels line up field for field. Live-only array
 * elements (see `collectDiffs`) are appended, so a hot-patched env var
 * is visible in the live panel instead of only in the summary.
 */
function projectLive(desired: unknown, live: unknown, path = ''): unknown {
  if (live === undefined) return undefined;
  if (Array.isArray(desired) && Array.isArray(live)) {
    if (desired.length > 0 && isNameKeyedArray(desired) && isNameKeyedArray(live)) {
      const liveByName = new Map(
        live.map((el) => [(el as Record<string, unknown>).name as string, el])
      );
      const gitNames = new Set(
        desired.map((el) => (el as Record<string, unknown>).name as string)
      );
      const projected = desired
        .map((el) =>
          projectLive(el, liveByName.get((el as Record<string, unknown>).name as string), `${path}[${(el as Record<string, unknown>).name as string}]`)
        )
        .filter((v) => v !== undefined);
      for (const el of live) {
        if (!gitNames.has((el as Record<string, unknown>).name as string)) {
          projected.push(el);
        }
      }
      return projected;
    }
    const projected = desired
      .map((el, i) => projectLive(el, live[i], `${path}[${i}]`))
      .filter((v) => v !== undefined);
    for (let i = desired.length; i < live.length; i++) {
      projected.push(live[i]);
    }
    return projected;
  }
  if (isPlainObject(desired) && isPlainObject(live)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(desired)) {
      const projected = projectLive(desired[key], live[key], path ? `${path}.${key}` : key);
      if (projected !== undefined) out[key] = projected;
    }
    // Mirror the labels carve-out in collectDiffs: a live-only label in
    // a nested labels map is visible in the live panel, not only in the
    // summary.
    if (path !== 'metadata.labels' && path.endsWith('labels')) {
      for (const key of Object.keys(live)) {
        if (!(key in desired)) out[key] = live[key];
      }
    }
    return out;
  }
  return live;
}

function classifyDiffs(diffs: LeafDiff[]): DriftKind {
  const paths = diffs.map((d) => d.path);
  if (paths.some((p) => /replicas/i.test(p))) return 'REPLICA_COUNT_DRIFT';
  if (paths.some((p) => /\.image$/.test(p))) return 'IMAGE_TAG_DRIFT';
  if (paths.some((p) => /\.env\[/.test(p))) return 'ENV_VAR_DRIFT';
  if (paths.some((p) => /\.resources(\.|$)/.test(p))) return 'RESOURCE_LIMIT_DRIFT';
  return 'SPEC_DRIFT';
}

function severityFor(type: DriftKind, missingLive: boolean): DriftSeverity {
  if (missingLive) return 'HIGH';
  switch (type) {
    case 'RESOURCE_LIMIT_DRIFT':
      return 'HIGH';
    case 'ENV_VAR_DRIFT':
      return 'LOW';
    case 'ORPHANED_RESOURCE':
      return 'MEDIUM';
    default:
      return 'MEDIUM';
  }
}

function formatValue(value: unknown): string {
  if (value === undefined) return '(missing)';
  if (value === null) return 'null';
  if (typeof value === 'string') return value.length > 60 ? `${value.slice(0, 57)}…` : value;
  const rendered = JSON.stringify(value);
  if (rendered === undefined) return '(unrepresentable)';
  return rendered.length > 60 ? `${rendered.slice(0, 57)}…` : rendered;
}

function summarizeDiffs(diffs: LeafDiff[]): string {
  const shown = diffs
    .slice(0, 5)
    .map((d) => `${d.path}: Git (${formatValue(d.gitValue)}) ≠ Cluster (${formatValue(d.liveValue)})`);
  const extra = diffs.length > 5 ? ` (+${diffs.length - 5} more)` : '';
  return shown.join('; ') + extra;
}

/** Key a live object the same way `objectKey` does (for array inputs). */
function keyOf(obj: K8sObject): string {
  return objectKey(
    typeof obj.kind === 'string' ? obj.kind : '',
    typeof obj.metadata?.namespace === 'string' ? obj.metadata.namespace : '',
    typeof obj.metadata?.name === 'string' ? obj.metadata.name : ''
  );
}

function toLiveMap(live: Map<string, K8sObject> | K8sObject[]): Map<string, K8sObject> {
  return Array.isArray(live) ? new Map(live.map((o) => [keyOf(o), o])) : live;
}

/**
 * Compare desired objects against live objects. Items are returned only
 * for resources that actually differ; in-sync resources produce
 * nothing. Orphans are NOT reported here — see `findOrphanedLiveObjects`:
 * orphan detection must run once over the union of all desired objects,
 * or apps sharing a namespace would flag each other's objects.
 */
export function diffDesiredVsLive(
  desired: DesiredObjectEntry[],
  live: Map<string, K8sObject> | K8sObject[],
  opts: DiffOptions = {}
): DiffItem[] {
  const prefix = opts.idPrefix ?? 'drift';
  const detectedAt = opts.detectedAt ?? new Date().toISOString();
  const liveByKey = toLiveMap(live);
  const items: DiffItem[] = [];

  for (const entry of desired) {
    const obj = entry.object;
    const kind = typeof obj.kind === 'string' ? obj.kind : 'Unknown';
    const name = typeof obj.metadata?.name === 'string' ? obj.metadata.name : '';
    const namespace = typeof obj.metadata?.namespace === 'string' ? obj.metadata.namespace : '';
    if (!name) continue; // Cannot address it live; the caller filters these.
    const liveObj = liveByKey.get(objectKey(kind, namespace, name));
    const normalizedDesired = normalizeForCompare(obj);

    if (!liveObj) {
      items.push({
        id: buildDiffId(prefix, entry.appName, kind, namespace, name),
        resourceName: name,
        namespace,
        kind,
        driftType: 'SPEC_DRIFT',
        gitFilePath: entry.gitFilePath,
        gitContent: stringifyYaml(normalizedDesired),
        liveContent: '# not present in cluster',
        diffSummary: `${kind} ${name} is declared in Git but is not present in the cluster`,
        severity: 'HIGH',
        driftDetectedAt: detectedAt,
      });
      continue;
    }

    const normalizedLive = normalizeForCompare(liveObj);
    const diffs: LeafDiff[] = [];
    collectDiffs(normalizedDesired, normalizedLive, '', diffs);
    if (diffs.length === 0) continue;

    const driftType = classifyDiffs(diffs);
    items.push({
      id: buildDiffId(prefix, entry.appName, kind, namespace, name),
      resourceName: name,
      namespace,
      kind,
      driftType,
      gitFilePath: entry.gitFilePath,
      gitContent: stringifyYaml(normalizedDesired),
      liveContent: stringifyYaml(projectLive(normalizedDesired, normalizedLive) ?? {}),
      diffSummary: summarizeDiffs(diffs),
      severity: severityFor(driftType, false),
      driftDetectedAt: detectedAt,
    });
  }

  return items;
}

/**
 * Find live objects with no desired counterpart and no owner — resources
 * running in the cluster that git never declared. Call this once over
 * the union of all desired objects (see `diffDesiredVsLive`); per-app
 * calls would misattribute objects owned by another app in the same
 * namespace. Objects with owners (Pods owned by ReplicaSets, ...) and
 * cluster-managed objects (the `kubernetes` Service) are not orphans.
 */
export function findOrphanedLiveObjects(
  desiredKeys: ReadonlySet<string>,
  live: Map<string, K8sObject> | K8sObject[],
  opts: OrphanOptions
): DiffItem[] {
  const prefix = opts.idPrefix ?? 'drift';
  const detectedAt = opts.detectedAt ?? new Date().toISOString();
  const liveByKey = toLiveMap(live);
  const items: DiffItem[] = [];

  for (const [key, liveObj] of liveByKey) {
    if (desiredKeys.has(key) || CLUSTER_MANAGED_LIVE.has(key)) continue;
    const meta = liveObj.metadata;
    if (!isPlainObject(meta)) continue;
    const ownerReferences = meta.ownerReferences;
    if (Array.isArray(ownerReferences) && ownerReferences.length > 0) continue;
    const kind = typeof liveObj.kind === 'string' ? liveObj.kind : 'Unknown';
    const name = typeof meta.name === 'string' ? meta.name : '';
    const namespace = typeof meta.namespace === 'string' ? meta.namespace : '';
    if (!name) continue;
    const attribution = opts.attribute(liveObj);
    items.push({
      id: buildDiffId(prefix, attribution.appName, kind, namespace, name),
      resourceName: name,
      namespace,
      kind,
      driftType: 'ORPHANED_RESOURCE',
      gitFilePath: attribution.gitFilePath,
      gitContent: '# not declared in Git',
      liveContent: stringifyYaml(normalizeForCompare(liveObj)),
      diffSummary: `${kind} ${name} is running in the cluster but is not declared in Git`,
      severity: 'MEDIUM',
      driftDetectedAt: detectedAt,
    });
  }

  return items;
}

/**
 * A unified diff between two text contents (LCS-based, single hunk).
 * This is a content diff of the compared manifests — the patch a
 * reverse-commit shows the operator — not a `git apply`-ready file
 * patch: Helm-rendered objects have no source file, and the compared
 * content is the normalized object, not the raw file text. `applied`
 * is always false; nothing is committed by generating the patch.
 * Returns '' when the contents are identical.
 */
export function buildUnifiedDiff(gitFilePath: string, gitContent: string, liveContent: string): string {
  const toLines = (text: string): string[] => {
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    return lines;
  };
  const a = toLines(gitContent);
  const b = toLines(liveContent);

  // LCS dynamic program; snippets are small (tens of lines).
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  type Op = { type: ' ' | '-' | '+'; line: string };
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      ops.push({ type: ' ', line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: '-', line: a[i] });
      i++;
    } else {
      ops.push({ type: '+', line: b[j] });
      j++;
    }
  }
  while (i < m) {
    ops.push({ type: '-', line: a[i] });
    i++;
  }
  while (j < n) {
    ops.push({ type: '+', line: b[j] });
    j++;
  }

  if (ops.every((op) => op.type === ' ')) return '';
  // Orphaned items have no declaring file; label the header honestly.
  const label = gitFilePath || '(no git file)';
  const header =
    `--- a/${label}\n` +
    `+++ b/${label}\n` +
    `@@ -1,${m} +1,${n} @@\n`;
  return header + ops.map((op) => `${op.type}${op.line}`).join('\n') + '\n';
}
