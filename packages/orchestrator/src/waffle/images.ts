/**
 * Waffle image builds: build-target validation (CodeQL round-3 guards),
 * docker build/push, the in-cluster local registry, and containerd import
 * (Plan III §7.3 split of waffle/runner.ts). Behavior-preserving file
 * motion only — WaffleRunner delegates to these functions with its log
 * sink; the guards are re-exported from runner.ts as before.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pipeExecs, isIpAddressLiteral } from '../exec-argv.js';
import { processManager, assertCommandSuccess } from '../executor.js';
import { getWaffleExecutionEnv, errMessage, debug, type WaffleLogFn } from './shared.js';
import { type WaffleGitSource, type WafflePipeline, type WaffleBuildTarget } from './schema.js';

/**
 * Q8: registry liveness probe over Node fetch, not curl — curl is not
 * in the executor allowlist and must not be added for a probe. A
 * non-2xx response or a fetch failure (timeout, refused) reads as
 * "not reachable", exactly like curl -f failing before.
 */
async function isRegistryReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * CodeQL round 3 (js/path-injection): blueprint-supplied paths must stay
 * inside the directory they are resolved against. Mirrors the confinement
 * check in executor.ts (validateCommand): resolve, then require the result
 * to be the base itself or strictly beneath it.
 */
/**
 * realpath of a path that may not exist yet: resolve the nearest
 * existing ancestor, then re-append the remaining segments. A symlink
 * component anywhere in the existing prefix is resolved through, so
 * the result reflects where the filesystem would actually land.
 * Non-ENOENT failures (ELOOP, EACCES, …) fail closed by throwing.
 */
function realpathWithAncestor(p: string): string {
  const suffix: string[] = [];
  let cur = p;
  for (;;) {
    try {
      const real = fs.realpathSync(cur);
      return suffix.length > 0 ? path.join(real, ...suffix) : real;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      const parent = path.dirname(cur);
      if (parent === cur) throw err;
      suffix.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

export function resolvePathWithinBase(
  baseDir: string,
  relPath: string,
  targetName: string,
  field: string
): string {
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, relPath);
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error(
      `Build target "${targetName}": ${field} path "${relPath}" resolves outside its base directory (${resolvedBase})`
    );
  }
  // Symlink confinement (bug-hunt Batch A7): the lexical check above
  // only sees the spelling of the path. A symlink inside the base
  // pointing outside (git preserves symlinks, so a cloned blueprint can
  // carry one) would pass it while docker/git/bash follow it outside.
  // Resolve both sides through the filesystem and re-check containment.
  // The lexical path is still what is returned, preserving caller
  // behavior for the in-bounds case.
  const realBase = realpathWithAncestor(resolvedBase);
  const realResolved = realpathWithAncestor(resolved);
  if (realResolved !== realBase && !realResolved.startsWith(realBase + path.sep)) {
    throw new Error(
      `Build target "${targetName}": ${field} path "${relPath}" resolves outside its base directory (${resolvedBase})`
    );
  }
  return resolved;
}

/**
 * CodeQL round 3 (js/shell-command-constructed-from-input): execution is
 * argv-form, so there is no shell to inject into — but git parses any argv
 * element beginning with '-' as an option wherever a repo/ref is expected
 * (clone's -c / --upload-pack class). Reject such blueprint values outright.
 */
export function assertSafeGitValue(targetName: string, field: string, value: string): void {
  if (value.startsWith('-')) {
    throw new Error(
      `Build target "${targetName}": git ${field} "${value}" must not begin with '-' (it would be parsed as a git option)`
    );
  }
}

/**
 * Builds container images defined in pipeline.builds
 */
export async function buildImages(
  pipeline: WafflePipeline,
  baseDir: string,
  log: WaffleLogFn,
  dryRun?: boolean
): Promise<void> {
  if (!pipeline.builds?.targets || pipeline.builds.targets.length === 0) {
    return;
  }
  const registry = pipeline.builds.registry || 'localhost:5001';
  log(`[BUILDS] Starting builds for ${pipeline.builds.targets.length} target(s) using registry "${registry}"...`);

  if (dryRun) {
    for (const target of pipeline.builds.targets) {
      const fullTag = `${registry}/${target.image}:${target.tag || 'latest'}`;
      const gitInfo = target.git ? ` (git: ${typeof target.git === 'string' ? target.git : target.git.repo})` : '';
      log(`[BUILDS] [DRY-RUN] Target "${target.name}" -> ${fullTag} (context: ${target.context})${gitInfo} simulated.`);
    }
    return;
  }

  const failedTargets: string[] = [];
  await ensureLocalRegistry(registry, log, baseDir);

  for (const target of pipeline.builds.targets) {
    try {
      await buildSingleTarget(target, baseDir, registry, log, dryRun);
    } catch {
      failedTargets.push(target.name);
    }
  }

  if (failedTargets.length > 0) {
    throw new Error(`Image build/import failed for target(s): ${failedTargets.join(', ')}`);
  }
}

/**
 * Builds, tags, pushes, and cluster-imports a single container image target
 */
export async function buildSingleTarget(
  target: WaffleBuildTarget,
  baseDir: string,
  registry: string,
  log: WaffleLogFn,
  dryRun?: boolean
): Promise<void> {
  const fullTag = `${registry}/${target.image}:${target.tag || 'latest'}`;
  // Validate every blueprint-supplied path and git value before any
  // subprocess runs (CodeQL round 3): paths must stay inside the project
  // directory, and git repos/refs must not look like git options.
  const contextPath = resolvePathWithinBase(baseDir, target.context, target.name, 'context');
  const gitConfig: WaffleGitSource | undefined = target.git
    ? typeof target.git === 'string'
      ? { repo: target.git }
      : target.git
    : undefined;
  let cloneDir = contextPath;
  if (gitConfig) {
    assertSafeGitValue(target.name, 'repo', gitConfig.repo);
    if (gitConfig.branch) assertSafeGitValue(target.name, 'branch', gitConfig.branch);
    if (gitConfig.commit) assertSafeGitValue(target.name, 'commit', gitConfig.commit);
    if (gitConfig.tag) assertSafeGitValue(target.name, 'tag', gitConfig.tag);
    if (gitConfig.dir) {
      cloneDir = resolvePathWithinBase(baseDir, gitConfig.dir, target.name, 'git dir');
    }
  }

  if (dryRun) {
    const gitInfo = target.git ? ` (git: ${typeof target.git === 'string' ? target.git : target.git.repo})` : '';
    log(`[BUILDS] [DRY-RUN] Target "${target.name}" -> ${fullTag} (context: ${target.context})${gitInfo} simulated.`);
    return;
  }

  await ensureLocalRegistry(registry, log, baseDir);

  // 1. Auto-clone or pull from Git if target.git is defined
  if (gitConfig) {
    try {
      const hasGit = fs.existsSync(path.join(cloneDir, '.git'));
      const isEmpty = !fs.existsSync(cloneDir) || fs.readdirSync(cloneDir).length === 0;

      if (isEmpty) {
        let repoUrl = gitConfig.repo;
        // Convert git@github.com:org/repo.git to https://github.com/org/repo.git if SSH key is absent
        if (repoUrl.startsWith('git@github.com:')) {
          repoUrl = repoUrl.replace('git@github.com:', 'https://github.com/');
        }

        log(`[BUILDS] Target "${target.name}": Cloning repository from ${repoUrl}...`);
        fs.mkdirSync(path.dirname(cloneDir), { recursive: true });

        const cloneArgs = ['clone'];
        if (gitConfig.branch) cloneArgs.push('-b', gitConfig.branch);
        if (gitConfig.depth && !gitConfig.commit) cloneArgs.push('--depth', String(gitConfig.depth));
        if (gitConfig.submodules) cloneArgs.push('--recurse-submodules');
        // '--' ends option parsing: the repo and directory are positional
        // from here on, whatever they look like (defense in depth behind
        // the assertSafeGitValue check above).
        // Q8: git runs through the task executor (validator + task log)
        // instead of execFileAsync, which bypassed both. Failure labels
        // stay static — the repo URL must not land in error text, where
        // it could carry embedded credentials into the logs.
        cloneArgs.push('--', repoUrl, cloneDir);
        const clone = await processManager.runCommandAndWait('git', cloneArgs, { cwd: baseDir });
        assertCommandSuccess(clone, 'git clone');

        if (gitConfig.commit) {
          const checkout = await processManager.runCommandAndWait(
            'git',
            ['-C', cloneDir, 'checkout', gitConfig.commit],
            { cwd: baseDir }
          );
          assertCommandSuccess(checkout, 'git checkout');
        } else if (gitConfig.tag) {
          const checkout = await processManager.runCommandAndWait(
            'git',
            ['-C', cloneDir, 'checkout', `tags/${gitConfig.tag}`],
            { cwd: baseDir }
          );
          assertCommandSuccess(checkout, 'git checkout');
        }
        log(`[BUILDS] Target "${target.name}": Repository successfully cloned into ${cloneDir}.`);
      } else if (hasGit) {
        log(`[BUILDS] Target "${target.name}": Existing repository detected at ${cloneDir}; fetching updates...`);
        const fetchTags = await processManager.runCommandAndWait(
          'git',
          ['-C', cloneDir, 'fetch', '--tags'],
          { cwd: baseDir }
        );
        if (fetchTags.code !== 0) {
          debug(
            `buildSingleTarget "${target.name}": git fetch --tags failed: ${fetchTags.stderr.trim() || `exit code ${fetchTags.code}`}`
          );
        }
        if (gitConfig.branch) {
          const checkoutBranch = await processManager.runCommandAndWait(
            'git',
            ['-C', cloneDir, 'checkout', gitConfig.branch],
            { cwd: baseDir }
          );
          if (checkoutBranch.code !== 0) {
            debug(
              `buildSingleTarget "${target.name}": git checkout ${gitConfig.branch} failed: ${checkoutBranch.stderr.trim() || `exit code ${checkoutBranch.code}`}`
            );
          }
          const pull = await processManager.runCommandAndWait(
            'git',
            ['-C', cloneDir, 'pull', 'origin', gitConfig.branch],
            { cwd: baseDir }
          );
          if (pull.code !== 0) {
            debug(
              `buildSingleTarget "${target.name}": git pull origin ${gitConfig.branch} failed: ${pull.stderr.trim() || `exit code ${pull.code}`}`
            );
          }
        } else if (gitConfig.commit) {
          const checkoutCommit = await processManager.runCommandAndWait(
            'git',
            ['-C', cloneDir, 'checkout', gitConfig.commit],
            { cwd: baseDir }
          );
          if (checkoutCommit.code !== 0) {
            debug(
              `buildSingleTarget "${target.name}": git checkout ${gitConfig.commit} failed: ${checkoutCommit.stderr.trim() || `exit code ${checkoutCommit.code}`}`
            );
          }
        } else if (gitConfig.tag) {
          const checkoutTag = await processManager.runCommandAndWait(
            'git',
            ['-C', cloneDir, 'checkout', `tags/${gitConfig.tag}`],
            { cwd: baseDir }
          );
          assertCommandSuccess(checkoutTag, 'git checkout');
        }
      }
    } catch (gitErr) {
      log(`[BUILDS] Warning: Git operation for target "${target.name}" failed: ${errMessage(gitErr)}`);
    }
  }

  const dockerfilePath = target.dockerfile
    ? resolvePathWithinBase(contextPath, target.dockerfile, target.name, 'dockerfile')
    : path.join(contextPath, 'Dockerfile');

  log(`[BUILDS] Building target "${target.name}" -> ${fullTag}...`);
  try {
    const buildArgs = ['build', '-t', fullTag];
    if (target.dockerfile) {
      buildArgs.push('-f', dockerfilePath);
    }
    buildArgs.push(contextPath);

    // Q8: docker build runs through the task executor (validator +
    // task log). Build output still streams live via onLog, as the raw
    // spawn's data handlers did before.
    const buildResult = await processManager.runCommandAndWait('docker', buildArgs, {
      cwd: baseDir,
      onLog: (entry) => {
        if (entry.type !== 'stdout' && entry.type !== 'stderr') return;
        const lines = entry.message.split('\n').filter((l: string) => l.trim().length > 0);
        for (const line of lines) {
          log(`[DOCKER] [${target.name}] ${line}`);
        }
      },
    });
    assertCommandSuccess(buildResult, 'docker build');

    // Push to the in-cluster/local registry when it is reachable (best effort; the
    // containerd import below is what guarantees the cluster can run the image).
    log(`[BUILDS] Pushing image ${fullTag}...`);
    const pushResult = await processManager.runCommandAndWait(
      'docker',
      ['push', '--tls-verify=false', fullTag],
      { cwd: baseDir }
    );
    if (pushResult.code !== 0) {
      const retryResult = await processManager.runCommandAndWait('docker', ['push', fullTag], {
        cwd: baseDir,
      });
      if (retryResult.code !== 0) {
        log(
          `[BUILDS] Notice: Registry push to "${registry}" skipped or unavailable: ${(retryResult.stderr.trim() || `exit code ${retryResult.code}`).split('\n')[0]}`
        );
      }
    }

    // MANDATORY: make the image available to every cluster node's containerd.
    await importImageToCluster(target, fullTag, log, baseDir);

    log(`[BUILDS] Target "${target.name}" successfully built and published.`);
  } catch (err) {
    log(`[BUILDS] ERROR: Build/import for target "${target.name}" failed: ${errMessage(err)}`);
    throw err;
  }
}

/**
 * Ensures a registry is serving on the configured localhost:<port> endpoint by running
 * registry:2 inside the cluster (hostPort), so kubelet can pull "localhost:<port>/..." images.
 */
export async function ensureLocalRegistry(
  registry: string,
  log: WaffleLogFn,
  cwd: string = process.cwd()
): Promise<void> {
  const m = /^(localhost|127\.0\.0\.1):(\d+)$/.exec(registry);
  if (!m) return;
  const port = m[2];
  const env = getWaffleExecutionEnv();
  // Q8: the liveness probe is a Node fetch, not a curl subprocess —
  // curl is not in the executor allowlist.
  if (await isRegistryReachable(`http://localhost:${port}/v2/`)) {
    return;
  }
  debug(`ensureLocalRegistry: probe of ${registry} failed`);
  log(`[BUILDS] No registry on ${registry}; deploying in-cluster registry (namespace "registry")...`);
  const manifest = `apiVersion: v1
kind: Namespace
metadata:
  name: registry
  labels:
    pod-security.kubernetes.io/enforce: privileged
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: registry
  namespace: registry
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: registry
  template:
    metadata:
      labels:
        app: registry
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  # k3s/k3d set this label to "true"; kubeadm sets it to "".
                  # A nodeSelector can only express one value, so use an
                  # affinity In-list covering both (registry portability).
                  - key: node-role.kubernetes.io/control-plane
                    operator: In
                    values: ["true", ""]
      tolerations:
        - key: "node-role.kubernetes.io/control-plane"
          operator: "Exists"
          effect: "NoSchedule"
        - key: "node-role.kubernetes.io/master"
          operator: "Exists"
          effect: "NoSchedule"
      containers:
        - name: registry
          image: registry:2
          imagePullPolicy: IfNotPresent
          ports:
            - containerPort: 5000
              hostPort: ${port}
          volumeMounts:
            - name: data
              mountPath: /var/lib/registry
      volumes:
        - name: data
          hostPath:
            path: /var/lib/vow-registry
            type: DirectoryOrCreate
---
apiVersion: v1
kind: Service
metadata:
  name: registry
  namespace: registry
spec:
  selector:
    app: registry
  ports:
    - port: 5000
      targetPort: 5000
`;
  try {
    // Q8: kubectl apply runs through the task executor; the manifest
    // travels via the runCommand `input` option (stdin), as the raw
    // spawn's stdin.write did before. The executor captures both
    // streams to the task log, so no manual draining is needed.
    const applyResult = await processManager.runCommandAndWait('kubectl', ['apply', '-f', '-'], {
      cwd,
      env,
      input: manifest,
    });
    assertCommandSuccess(applyResult, 'kubectl apply -f - (registry)');
    const rolloutResult = await processManager.runCommandAndWait(
      'kubectl',
      ['rollout', 'status', 'deployment/registry', '-n', 'registry', '--timeout=120s'],
      { cwd, env }
    );
    assertCommandSuccess(rolloutResult, 'kubectl rollout status deployment/registry');
    for (let i = 0; i < 15; i++) {
      if (await isRegistryReachable(`http://localhost:${port}/v2/`)) {
        log(`[BUILDS] In-cluster registry is serving on ${registry}.`);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    log(`[BUILDS] Notice: registry deployed but ${registry} not reachable yet; relying on containerd import.`);
  } catch (e) {
    log(`[BUILDS] Notice: could not deploy in-cluster registry: ${errMessage(e).split('\n')[0]}`);
  }
}

/**
 * Imports a built image (under every name kubelet might use) into containerd on the local
 * node and every other cluster node. Throws on failure so the build is not reported as OK.
 */
export async function importImageToCluster(
  target: { name: string; image: string; tag?: string },
  fullTag: string,
  log: WaffleLogFn,
  cwd: string = process.cwd()
): Promise<void> {
  const shortName = `${target.image}:${target.tag || 'latest'}`;
  const names = [fullTag, shortName, `docker.io/${shortName}`];
  for (const n of names.slice(1)) {
    // Q8: docker runs through the task executor (validator + task log).
    const tagResult = await processManager.runCommandAndWait('docker', ['tag', fullTag, n], { cwd });
    assertCommandSuccess(tagResult, 'docker tag');
  }
  const env = getWaffleExecutionEnv();

  // Local node (control plane / this host): stream docker save into
  // containerd's importer — no shell, no buffering of the image stream.
  await pipeExecs(
    { file: 'docker', args: ['save', ...names] },
    { file: 'sudo', args: ['k3s', 'ctr', '-n', 'k8s.io', 'images', 'import', '-'] },
    { env }
  );
  log(`[BUILDS] Imported ${fullTag} into local containerd.`);

  // Peer nodes, discovered from the cluster (not hardcoded)
  const localIps = new Set(
    Object.values(os.networkInterfaces()).flatMap((l) => (l || []).map((a) => a.address))
  );
  let peers: string[] = [];
  const nodesResult = await processManager.runCommandAndWait(
    'kubectl',
    ['get', 'nodes', '-o', 'jsonpath={range .items[*]}{.status.addresses[?(@.type=="InternalIP")].address}{"\\n"}{end}'],
    { cwd, env }
  );
  if (nodesResult.code === 0) {
    peers = nodesResult.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((ip) => ip && !localIps.has(ip) && isIpAddressLiteral(ip));
  } else {
    // Cannot list nodes; single-node assumption. A genuine peer-discovery
    // failure is indistinguishable from a single-node cluster at this
    // point, so leave a debug trace (§5.7).
    debug(
      `importImageToCluster: listing cluster nodes failed: ${nodesResult.stderr.trim() || `exit code ${nodesResult.code}`}`
    );
  }
  for (const ip of peers) {
    try {
      await pipeExecs(
        { file: 'docker', args: ['save', ...names] },
        {
          file: 'ssh',
          args: ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', ip, 'sudo k3s ctr -n k8s.io images import -'],
        },
        { env }
      );
      log(`[BUILDS] Imported ${fullTag} into node ${ip}.`);
    } catch (e) {
      throw new Error(`failed to import ${fullTag} into node ${ip}: ${errMessage(e).split('\n')[0]}`, { cause: e });
    }
  }
}
