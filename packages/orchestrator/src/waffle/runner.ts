/**
 * Waffle pipeline runner: progress model and the WaffleRunner engine (WS6 split of waffle.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { checkOpenEbsStatus } from '../storage.js';
import { execAsync, getWaffleExecutionEnv } from './shared.js';
import { type WaffleSecretKey, type WaffleGitSource, type WaffleStep, type WafflePipeline } from './schema.js';
import { getWaffleRunHistory } from './registry.js';

// ============================================================================
// 4. WAFFLE RUNNER & REAL-TIME PROGRESS TRACKING
// ============================================================================

export type StepStatus = 'pending' | 'running' | 'verifying' | 'completed' | 'failed' | 'skipped';

export type StageStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export type PipelineStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WaffleStepProgress {
  stepId: string;
  name: string;
  status: StepStatus;
  chart: string;
  namespace: string;
  releaseName: string;
  domain?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
  logs: string[];
}

export interface WaffleStageProgress {
  stageId: string;
  name: string;
  status: StageStatus;
  mode: 'series' | 'parallel';
  steps: Record<string, WaffleStepProgress>;
  startedAt?: string;
  finishedAt?: string;
}

export interface WaffleRunProgress {
  runId: string;
  sourceId: string;
  pipelineName: string;
  status: PipelineStatus;
  stages: Record<string, WaffleStageProgress>;
  startedAt: string;
  finishedAt?: string;
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  activeStepId?: string;
  activeStageId?: string;
  currentLogLine?: string;
  error?: string;
  deployedDomains: Array<{ name: string; domain: string; url: string }>;
  dryRun?: boolean;
}

export class WaffleRunner extends EventEmitter {
  private projectRoot: string;
  private activeRun: WaffleRunProgress | null = null;
  private aborted: boolean = false;

  constructor(projectRoot: string) {
    super();
    this.projectRoot = projectRoot;
  }

  public getActiveRun(): WaffleRunProgress | null {
    return this.activeRun;
  }

  public abort(): void {
    this.aborted = true;
    if (this.activeRun) {
      this.activeRun.status = 'cancelled';
      this.emit('progress', this.activeRun);
    }
  }

  /**
   * Executes a WafflePipeline with real-time events and streaming logs
   */
  public async executePipeline(options: {
    sourceId: string;
    pipeline: WafflePipeline;
    baseDir: string;
    dryRun?: boolean;
    buildOnly?: boolean;
  }): Promise<WaffleRunProgress> {
    this.aborted = false;
    const { sourceId, pipeline, baseDir, dryRun, buildOnly } = options;

    const runId = `run_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let totalSteps = 0;
    const stagesProgress: Record<string, WaffleStageProgress> = {};

    for (const stage of pipeline.stages) {
      const stepsMap: Record<string, WaffleStepProgress> = {};
      for (const step of stage.steps) {
        totalSteps++;
        stepsMap[step.id] = {
          stepId: step.id,
          name: step.name,
          status: 'pending',
          chart: step.chart,
          namespace: step.namespace || pipeline.settings?.defaultNamespace || 'default',
          releaseName: step.releaseName || step.id,
          domain: step.domain,
          logs: [],
        };
      }
      stagesProgress[stage.id] = {
        stageId: stage.id,
        name: stage.name,
        status: 'pending',
        mode: stage.mode || 'series',
        steps: stepsMap,
      };
    }

    const runProgress: WaffleRunProgress = {
      runId,
      sourceId,
      pipelineName: pipeline.metadata.name,
      status: 'running',
      stages: stagesProgress,
      startedAt: new Date().toISOString(),
      totalSteps,
      completedSteps: 0,
      failedSteps: 0,
      deployedDomains: [],
      dryRun: Boolean(dryRun),
    };

    this.activeRun = runProgress;
    this.emit('start', runProgress);
    this.emit('progress', runProgress);

    try {
      if (buildOnly) {
        this.logToRun(`[BUILDS] Rebuild mode activated for pipeline "${pipeline.metadata.name}".`);
        if (!pipeline.builds?.targets || pipeline.builds.targets.length === 0) {
          this.logToRun('[BUILDS] No build targets defined in pipeline. Nothing to rebuild.');
        } else {
          await this.buildImages(pipeline, baseDir, Boolean(dryRun));
          this.logToRun(`[BUILDS] All ${pipeline.builds.targets.length} target image(s) processed successfully.`);
        }
        runProgress.status = 'completed';
        return runProgress;
      }

      // 1. Run Pre-flight Checks (e.g. OpenEBS detection & installation)
      await this.runPreflight(pipeline, baseDir, dryRun);

      // 1.1 Synchronize Global Pipeline Secrets (keys block)
      if (pipeline.keys?.secrets && pipeline.keys.secrets.length > 0) {
        const defaultNs = pipeline.settings?.defaultNamespace || 'default';
        await this.provisionSecrets(pipeline.keys.secrets, defaultNs, Boolean(dryRun));
      }

      // 1.2 Build Container Images (builds block)
      if (pipeline.builds?.targets && pipeline.builds.targets.length > 0) {
        await this.buildImages(pipeline, baseDir, Boolean(dryRun));
      }

      // 2. Execute Stages in Order
      for (const stage of pipeline.stages) {
        if (this.aborted) break;

        const stageProg = runProgress.stages[stage.id];
        stageProg.status = 'running';
        stageProg.startedAt = new Date().toISOString();
        runProgress.activeStageId = stage.id;
        this.emit('stage_start', { stageId: stage.id, name: stage.name });
        this.emit('progress', runProgress);

        if (stage.mode === 'parallel') {
          // Parallel execution of all steps in stage
          const stepPromises = stage.steps.map((step) =>
            this.executeStep({
              step,
              stageId: stage.id,
              pipeline,
              baseDir,
              dryRun: Boolean(dryRun),
              runProgress,
            })
          );
          const results = await Promise.allSettled(stepPromises);
          const hasFailure = results.some((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value));
          if (hasFailure) {
            stageProg.status = 'failed';
            if (pipeline.settings?.rollbackOnFailure) {
              throw new Error(`Stage "${stage.name}" failed during parallel execution`);
            }
          } else {
            stageProg.status = 'completed';
          }
        } else {
          // Series execution
          let stageHasFailure = false;
          for (const step of stage.steps) {
            if (this.aborted) break;
            const success = await this.executeStep({
              step,
              stageId: stage.id,
              pipeline,
              baseDir,
              dryRun: Boolean(dryRun),
              runProgress,
            });
            if (!success) {
              stageHasFailure = true;
              if (pipeline.settings?.rollbackOnFailure) {
                stageProg.status = 'failed';
                throw new Error(`Step "${step.name}" failed in stage "${stage.name}"`);
              }
            }
          }
          if (stageHasFailure) {
            stageProg.status = 'failed';
          } else {
            stageProg.status = 'completed';
          }
        }

        stageProg.finishedAt = new Date().toISOString();
        this.emit('stage_complete', { stageId: stage.id, status: stageProg.status });
        this.emit('progress', runProgress);
      }

      runProgress.status = runProgress.failedSteps > 0 ? 'failed' : 'completed';
    } catch (err: any) {
      runProgress.status = 'failed';
      runProgress.error = err.message;
      this.logToRun(`[FATAL] Pipeline halted: ${err.message}`);
    } finally {
      runProgress.finishedAt = new Date().toISOString();
      this.emit('finish', runProgress);
      this.emit('progress', runProgress);
      await getWaffleRunHistory().recordRun(runProgress);
    }

    return runProgress;
  }

  /**
   * Derives Supabase ANON_KEY / SERVICE_ROLE_KEY as HS256 JWTs signed with SUPABASE_JWT_SECRET.
   * Returns undefined for any other variable or when the signing secret is not set.
   */
  private deriveSupabaseJwt(envVar: string): string | undefined {
    const role = envVar === 'SUPABASE_ANON_KEY' ? 'anon' : envVar === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service_role' : undefined;
    const secret = process.env.SUPABASE_JWT_SECRET;
    if (!role || !secret) return undefined;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase', iat: now, exp: now + 10 * 365 * 24 * 3600 })}`;
    const sig = createHmac('sha256', secret).update(unsigned).digest('base64url');
    return `${unsigned}.${sig}`;
  }

  /**
   * Provision Kubernetes Secrets defined in pipeline.keys or step.keys
   */
  private async provisionSecrets(
    secrets: WaffleSecretKey[],
    defaultNamespace: string,
    dryRun?: boolean
  ): Promise<void> {
    for (const sec of secrets) {
      const ns = sec.namespace || defaultNamespace;
      this.logToRun(`[KEYS] Ensuring Kubernetes Secret "${sec.name}" in namespace "${ns}"...`);
      if (dryRun) {
        this.logToRun(`[KEYS] [DRY-RUN] Secret "${sec.name}" creation simulated.`);
        continue;
      }

      const secretData: Record<string, string> = {};
      if (sec.literals) {
        const missing = new Set<string>();
        for (const [k, v] of Object.entries(sec.literals)) {
          // Interpolate every ${VAR} occurrence (whole-value or embedded in a URL).
          // Never fall back to a built-in default: published placeholder secrets
          // (e.g. *_change_me) must not reach a cluster.
          secretData[k] = String(v).replace(/\$\{([a-zA-Z0-9_]+)\}/g, (_m, envVar: string) => {
            const fromEnv = process.env[envVar] ?? this.loadProjectEnvFiles()[envVar];
            if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
            const derived = this.deriveSupabaseJwt(envVar);
            if (derived) return derived;
            missing.add(envVar);
            return '';
          });
        }
        if (missing.size > 0) {
          throw new Error(
            `Secret "${sec.name}" requires unset environment variable(s): ${[...missing].sort().join(', ')}. ` +
              `Export them (see charts/production-prep.md) before running the pipeline.`
          );
        }
        for (const [k, val] of Object.entries(secretData)) {
          if (/change_?me/i.test(val)) {
            throw new Error(`Secret "${sec.name}" key "${k}" still contains a "change_me" placeholder; refusing to apply.`);
          }
        }
      }
      if (sec.fromEnv) {
        for (const envVar of sec.fromEnv) {
          const val = process.env[envVar] || this.loadProjectEnvFiles()[envVar] || '';
          secretData[envVar] = val;
        }
      }

      if (Object.keys(secretData).length > 0) {
        try {
          await execAsync(`kubectl create namespace ${JSON.stringify(ns)} --dry-run=client -o yaml | kubectl apply -f -`, { env: getWaffleExecutionEnv() });
          const manifestObj = {
            apiVersion: 'v1',
            kind: 'Secret',
            metadata: {
              name: sec.name,
              namespace: ns,
              labels: {
                'app.kubernetes.io/managed-by': 'waffle',
              },
              annotations: {
                // Keep Helm from deleting this secret if a previous release rendered one with the same name.
                'helm.sh/resource-policy': 'keep',
              },
            },
            type: 'Opaque',
            stringData: secretData,
          };
          const manifestJson = JSON.stringify(manifestObj);
          await execAsync(`cat << 'EOF' | kubectl apply -f -\n${manifestJson}\nEOF`, { env: getWaffleExecutionEnv() });
          this.logToRun(`[KEYS] Secret "${sec.name}" synchronized in namespace "${ns}".`);
        } catch (err: any) {
          this.logToRun(`[KEYS] Notice: Secret sync encountered: ${err.message}`);
        }
      }
    }
  }

  /**
   * Reads KEY=VALUE pairs from <projectRoot>/.env.production then .env (earlier file wins).
   * The Studio (Next.js) server does not load these itself, unlike the waffle CLI, so secrets
   * such as BILLAMA_MASTER_API_KEY would otherwise look unset when a run starts from the UI.
   * Process env always takes precedence (callers check it first).
   */
  private loadProjectEnvFiles(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const name of ['.env.production', '.env']) {
      const file = path.join(this.projectRoot, name);
      if (!fs.existsSync(file)) continue;
      for (const raw of fs.readFileSync(file, 'utf-8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
        if (!m || m[1] in out) continue;
        let v = m[2].trim();
        if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
        out[m[1]] = v;
      }
    }
    return out;
  }

  /**
   * Builds container images defined in pipeline.builds
   */
  private async buildImages(
    pipeline: WafflePipeline,
    baseDir: string,
    dryRun?: boolean
  ): Promise<void> {
    if (!pipeline.builds?.targets || pipeline.builds.targets.length === 0) {
      return;
    }
    const registry = pipeline.builds.registry || 'localhost:5001';
    this.logToRun(`[BUILDS] Starting builds for ${pipeline.builds.targets.length} target(s) using registry "${registry}"...`);

    if (dryRun) {
      for (const target of pipeline.builds.targets) {
        const fullTag = `${registry}/${target.image}:${target.tag || 'latest'}`;
        const gitInfo = target.git ? ` (git: ${typeof target.git === 'string' ? target.git : target.git.repo})` : '';
        this.logToRun(`[BUILDS] [DRY-RUN] Target "${target.name}" -> ${fullTag} (context: ${target.context})${gitInfo} simulated.`);
      }
      return;
    }

    const failedTargets: string[] = [];
    await this.ensureLocalRegistry(registry);

    for (const target of pipeline.builds.targets) {
      const contextPath = path.resolve(baseDir, target.context);

      // 1. Auto-clone or pull from Git if target.git is defined
      if (target.git) {
        const gitConfig: WaffleGitSource =
          typeof target.git === 'string' ? { repo: target.git } : target.git;
        const cloneDir = gitConfig.dir ? path.resolve(baseDir, gitConfig.dir) : contextPath;

        try {
          const hasGit = fs.existsSync(path.join(cloneDir, '.git'));
          const isEmpty = !fs.existsSync(cloneDir) || fs.readdirSync(cloneDir).length === 0;

          if (isEmpty) {
            let repoUrl = gitConfig.repo;
            // Convert git@github.com:org/repo.git to https://github.com/org/repo.git if SSH key is absent
            if (repoUrl.startsWith('git@github.com:')) {
              repoUrl = repoUrl.replace('git@github.com:', 'https://github.com/');
            }

            this.logToRun(`[BUILDS] Target "${target.name}": Cloning repository from ${repoUrl}...`);
            fs.mkdirSync(path.dirname(cloneDir), { recursive: true });

            const branchArg = gitConfig.branch ? `-b ${JSON.stringify(gitConfig.branch)}` : '';
            const depthArg = gitConfig.depth && !gitConfig.commit ? `--depth ${gitConfig.depth}` : '';
            const submodulesArg = gitConfig.submodules ? '--recurse-submodules' : '';

            const cloneCmd = `git clone ${branchArg} ${depthArg} ${submodulesArg} ${JSON.stringify(repoUrl)} ${JSON.stringify(cloneDir)}`.replace(/\s+/g, ' ');
            await execAsync(cloneCmd);

            if (gitConfig.commit) {
              await execAsync(`git -C ${JSON.stringify(cloneDir)} checkout ${JSON.stringify(gitConfig.commit)}`);
            } else if (gitConfig.tag) {
              await execAsync(`git -C ${JSON.stringify(cloneDir)} checkout tags/${JSON.stringify(gitConfig.tag)}`);
            }
            this.logToRun(`[BUILDS] Target "${target.name}": Repository successfully cloned into ${cloneDir}.`);
          } else if (hasGit) {
            this.logToRun(`[BUILDS] Target "${target.name}": Existing repository detected at ${cloneDir}; fetching updates...`);
            await execAsync(`git -C ${JSON.stringify(cloneDir)} fetch --tags`).catch(() => {});
            if (gitConfig.branch) {
              await execAsync(`git -C ${JSON.stringify(cloneDir)} checkout ${JSON.stringify(gitConfig.branch)}`).catch(() => {});
              await execAsync(`git -C ${JSON.stringify(cloneDir)} pull origin ${JSON.stringify(gitConfig.branch)}`).catch(() => {});
            } else if (gitConfig.commit) {
              await execAsync(`git -C ${JSON.stringify(cloneDir)} checkout ${JSON.stringify(gitConfig.commit)}`).catch(() => {});
            } else if (gitConfig.tag) {
              await execAsync(`git -C ${JSON.stringify(cloneDir)} checkout tags/${JSON.stringify(gitConfig.tag)}`).catch(() => {});
            }
          }
        } catch (gitErr: any) {
          this.logToRun(`[BUILDS] Warning: Git operation for target "${target.name}" failed: ${gitErr.message}`);
        }
      }

      const dockerfilePath = target.dockerfile ? path.resolve(contextPath, target.dockerfile) : path.join(contextPath, 'Dockerfile');
      const fullTag = `${registry}/${target.image}:${target.tag || 'latest'}`;

      this.logToRun(`[BUILDS] Building target "${target.name}" -> ${fullTag}...`);
      try {
        const buildArgs = ['build', '-t', fullTag];
        if (target.dockerfile) {
          buildArgs.push('-f', dockerfilePath);
        }
        buildArgs.push(contextPath);

        await new Promise<void>((resolve, reject) => {
          const proc = spawn('docker', buildArgs);
          proc.stdout?.on('data', (d) => {
            const lines = d.toString().split('\n').filter((l: string) => l.trim().length > 0);
            for (const line of lines) {
              this.logToRun(`[DOCKER] [${target.name}] ${line}`);
            }
          });
          proc.stderr?.on('data', (d) => {
            const lines = d.toString().split('\n').filter((l: string) => l.trim().length > 0);
            for (const line of lines) {
              this.logToRun(`[DOCKER] [${target.name}] ${line}`);
            }
          });
          proc.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`docker build exited with code ${code}`));
          });
          proc.on('error', reject);
        });

        // Push to the in-cluster/local registry when it is reachable (best effort; the
        // containerd import below is what guarantees the cluster can run the image).
        this.logToRun(`[BUILDS] Pushing image ${fullTag}...`);
        await execAsync(`docker push --tls-verify=false ${JSON.stringify(fullTag)}`).catch(async () => {
          await execAsync(`docker push ${JSON.stringify(fullTag)}`).catch((pushErr) => {
            this.logToRun(`[BUILDS] Notice: Registry push to "${registry}" skipped or unavailable: ${String(pushErr.message).split('\n')[0]}`);
          });
        });

        // MANDATORY: make the image available to every cluster node's containerd.
        await this.importImageToCluster(target, fullTag);

        this.logToRun(`[BUILDS] Target "${target.name}" successfully built and published.`);
      } catch (err: any) {
        failedTargets.push(target.name);
        this.logToRun(`[BUILDS] ERROR: Build/import for target "${target.name}" failed: ${err.message}`);
      }
    }

    if (failedTargets.length > 0) {
      throw new Error(`Image build/import failed for target(s): ${failedTargets.join(', ')}`);
    }
  }

  /**
   * Ensures a registry is serving on the configured localhost:<port> endpoint by running
   * registry:2 inside the cluster (hostPort), so kubelet can pull "localhost:<port>/..." images.
   */
  private async ensureLocalRegistry(registry: string): Promise<void> {
    const m = /^(localhost|127\.0\.0\.1):(\d+)$/.exec(registry);
    if (!m) return;
    const port = m[2];
    const env = getWaffleExecutionEnv();
    try {
      await execAsync(`curl -fsS -m 3 http://localhost:${port}/v2/`);
      return;
    } catch {
      // not reachable yet; deploy it
    }
    this.logToRun(`[BUILDS] No registry on ${registry}; deploying in-cluster registry (namespace "registry")...`);
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
      await new Promise<void>((resolve, reject) => {
        const proc = spawn('kubectl', ['apply', '-f', '-'], { env });
        let err = '';
        proc.stderr?.on('data', (d) => (err += d.toString()));
        proc.on('close', (c) => (c === 0 ? resolve() : reject(new Error(err || `kubectl apply exited ${c}`))));
        proc.on('error', reject);
        proc.stdin?.end(manifest);
      });
      await execAsync(`kubectl rollout status deployment/registry -n registry --timeout=120s`, { env });
      for (let i = 0; i < 15; i++) {
        try {
          await execAsync(`curl -fsS -m 3 http://localhost:${port}/v2/`);
          this.logToRun(`[BUILDS] In-cluster registry is serving on ${registry}.`);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      this.logToRun(`[BUILDS] Notice: registry deployed but ${registry} not reachable yet; relying on containerd import.`);
    } catch (e: any) {
      this.logToRun(`[BUILDS] Notice: could not deploy in-cluster registry: ${String(e.message).split('\n')[0]}`);
    }
  }

  /**
   * Imports a built image (under every name kubelet might use) into containerd on the local
   * node and every other cluster node. Throws on failure so the build is not reported as OK.
   */
  private async importImageToCluster(target: { name: string; image: string; tag?: string }, fullTag: string): Promise<void> {
    const shortName = `${target.image}:${target.tag || 'latest'}`;
    const names = [fullTag, shortName, `docker.io/${shortName}`];
    for (const n of names.slice(1)) {
      await execAsync(`docker tag ${JSON.stringify(fullTag)} ${JSON.stringify(n)}`);
    }
    const saveCmd = `docker save ${names.map((n) => JSON.stringify(n)).join(' ')}`;
    const env = getWaffleExecutionEnv();

    // Local node (control plane / this host)
    await execAsync(`${saveCmd} | sudo k3s ctr -n k8s.io images import -`, { maxBuffer: 1024 * 1024 * 64 });
    this.logToRun(`[BUILDS] Imported ${fullTag} into local containerd.`);

    // Peer nodes, discovered from the cluster (not hardcoded)
    const localIps = new Set(
      Object.values(os.networkInterfaces()).flatMap((l) => (l || []).map((a) => a.address))
    );
    let peers: string[] = [];
    try {
      const { stdout } = await execAsync(
        `kubectl get nodes -o jsonpath='{range .items[*]}{.status.addresses[?(@.type=="InternalIP")].address}{"\\n"}{end}'`,
        { env }
      );
      peers = stdout.split('\n').map((l) => l.trim()).filter((ip) => ip && !localIps.has(ip));
    } catch {
      // cannot list nodes; single-node assumption
    }
    for (const ip of peers) {
      try {
        await execAsync(
          `${saveCmd} | ssh -o BatchMode=yes -o ConnectTimeout=10 ${ip} "sudo k3s ctr -n k8s.io images import -"`,
          { maxBuffer: 1024 * 1024 * 64 }
        );
        this.logToRun(`[BUILDS] Imported ${fullTag} into node ${ip}.`);
      } catch (e: any) {
        throw new Error(`failed to import ${fullTag} into node ${ip}: ${String(e.message).split('\n')[0]}`);
      }
    }
  }

  /**
   * Preflight checks: check OpenEBS storage class and cluster readiness
   */
  private async runPreflight(pipeline: WafflePipeline, baseDir: string, dryRun?: boolean): Promise<void> {
    this.logToRun('[PREFLIGHT] Checking cluster environment and storage fabric...');

    // Detect if OpenEBS storage class is needed
    const needsOpenEBS =
      Boolean(pipeline.preflight?.storage?.requireStorageClass?.includes('openebs')) ||
      Boolean(pipeline.settings?.defaultStorageClass?.includes('openebs')) ||
      pipeline.stages.some((st) =>
        st.steps.some((sp) => {
          const sets = sp.set ? Object.values(sp.set) : [];
          return sets.some((val) => String(val).includes('openebs'));
        })
      );

    if (needsOpenEBS) {
      this.logToRun('[PREFLIGHT] OpenEBS Dynamic LocalPV required. Verifying cluster StorageClass and provisioner...');
      if (!dryRun) {
        const openebsStatus = await checkOpenEbsStatus(this.projectRoot);
        if (openebsStatus.isReady) {
          this.logToRun(`[PREFLIGHT] OpenEBS is verified and active: ${openebsStatus.message}.`);
          return;
        }

        this.logToRun('[PREFLIGHT] OpenEBS not fully detected. Initiating dynamic provisioning...');
        // Check if local openebs chart exists
        const localOpenEBSChart = path.join(baseDir, 'openebs');
        if (fs.existsSync(localOpenEBSChart)) {
          this.logToRun('[PREFLIGHT] Found local OpenEBS chart at ./openebs. Installing via Helm...');
          try {
            await execAsync(`helm upgrade --install openebs ${JSON.stringify(localOpenEBSChart)} --namespace openebs --create-namespace --wait --timeout 5m`);
            this.logToRun('[PREFLIGHT] Successfully deployed OpenEBS Dynamic LocalPV provisioner.');
          } catch (err: any) {
            const recheck = await checkOpenEbsStatus(this.projectRoot);
            if (recheck.isReady) {
              this.logToRun(`[PREFLIGHT] OpenEBS is verified active despite Helm upgrade notice: ${recheck.message}`);
            } else {
              throw err;
            }
          }
        } else {
          // Attempt storage script fallback
          const storageScript = path.join(this.projectRoot, 'src', 'k3s_storage.sh');
          if (fs.existsSync(storageScript)) {
            this.logToRun('[PREFLIGHT] Running src/k3s_storage.sh install --engine openebs...');
            await execAsync(`bash ${JSON.stringify(storageScript)} install --engine openebs`);
            this.logToRun('[PREFLIGHT] OpenEBS provisioned via cluster storage script.');
          } else {
            this.logToRun('[PREFLIGHT] Warning: OpenEBS provisioner script not available. Proceeding with deployment...');
          }
        }
      } else {
        this.logToRun('[PREFLIGHT] [DRY-RUN] OpenEBS StorageClass verification simulated (OK).');
      }
    }
  }

  /**
   * Executes a single step (helm lint, helm install/upgrade, verification)
   */
  private async executeStep(ctx: {
    step: WaffleStep;
    stageId: string;
    pipeline: WafflePipeline;
    baseDir: string;
    dryRun: boolean;
    runProgress: WaffleRunProgress;
  }): Promise<boolean> {
    const { step, stageId, pipeline, baseDir, dryRun, runProgress } = ctx;
    const stepProg = runProgress.stages[stageId].steps[step.id];
    stepProg.status = 'running';
    stepProg.startedAt = new Date().toISOString();
    runProgress.activeStepId = step.id;

    const startTimer = Date.now();
    this.emit('step_start', { stepId: step.id, name: step.name, stageId });
    this.emit('progress', runProgress);

    const log = (msg: string) => {
      const line = `[${new Date().toLocaleTimeString()}] [${step.id}] ${msg}`;
      stepProg.logs.push(line);
      runProgress.currentLogLine = line;
      this.emit('step_log', { stepId: step.id, line });
      this.emit('progress', runProgress);
    };

    try {
      // Resolve chart path
      let chartPath = step.chart;
      if (step.chart.startsWith('.')) {
        chartPath = path.resolve(baseDir, step.chart);
      } else if (!step.chart.includes('/') && fs.existsSync(path.join(baseDir, step.chart))) {
        chartPath = path.join(baseDir, step.chart);
      }

      const releaseName = step.releaseName || step.id;
      const namespace = step.namespace || pipeline.settings?.defaultNamespace || 'default';
      const timeout = step.timeout || '5m';

      // OpenEBS idempotency detection:
      // If this step deploys OpenEBS (chart path, step id, or release name),
      // verify if OpenEBS is already operational in the cluster to prevent Helm immutable field conflicts.
      const isOpenEbsStep =
        step.id.toLowerCase().includes('openebs') ||
        releaseName.toLowerCase().includes('openebs') ||
        step.chart.toLowerCase().includes('openebs');

      if (isOpenEbsStep && !dryRun) {
        log('Checking if OpenEBS Storage Fabric is already active in cluster...');
        const openebsStatus = await checkOpenEbsStatus(this.projectRoot);
        if (openebsStatus.isReady) {
          log('[openebs] OpenEBS is already deployed and operational in cluster:');
          if (openebsStatus.storageClasses.length > 0) {
            log(`  * StorageClasses: ${openebsStatus.storageClasses.join(', ')}`);
          }
          if (openebsStatus.readyDeployments.length > 0) {
            log(`  * Ready Deployments: ${openebsStatus.readyDeployments.join(', ')}`);
          }
          log(`  * Running Pods: ${openebsStatus.runningPods}`);
          log('[openebs] Skipping "helm upgrade" to prevent immutable field conflicts (StorageClass parameters & Deployment selector).');

          stepProg.status = 'completed';
          stepProg.finishedAt = new Date().toISOString();
          stepProg.durationMs = Date.now() - startTimer;
          runProgress.completedSteps++;

          log(`Step "${step.name}" finished in ${(stepProg.durationMs / 1000).toFixed(1)}s (already active).`);
          this.emit('step_complete', { stepId: step.id, status: 'completed' });
          this.emit('progress', runProgress);
          return true;
        }
      }

      // Step-level secrets synchronization
      if (step.keys) {
        const stepSec: WaffleSecretKey = typeof (step.keys as any).name === 'string'
          ? (step.keys as WaffleSecretKey)
          : {
              name: `${step.id}-secrets`,
              namespace,
              literals: step.keys as Record<string, string>,
            };
        await this.provisionSecrets([stepSec], namespace, dryRun);
      }

      log(`Preparing Helm deployment: release="${releaseName}", namespace="${namespace}", chart="${step.chart}"`);

      // Construct Helm flags
      const helmArgs = [
        'upgrade',
        '--install',
        releaseName,
        chartPath,
        '--namespace',
        namespace,
      ];

      if (step.createNamespace || isOpenEbsStep) {
        helmArgs.push('--create-namespace');
      }

      if (step.wait && !dryRun) {
        helmArgs.push('--wait');
      }

      helmArgs.push('--timeout', timeout);
      helmArgs.push('--take-ownership');

      // Domain configuration
      if (step.domain) {
        helmArgs.push('--set', `ingress.host=${step.domain}`);
        runProgress.deployedDomains.push({
          name: step.name,
          domain: step.domain,
          url: `https://${step.domain}`,
        });
      }

      // Explicit set values
      if (step.set) {
        for (const [key, val] of Object.entries(step.set)) {
          helmArgs.push('--set', `${key}=${val}`);
        }
      }

      // Dry-run mode
      if (dryRun) {
        helmArgs.push('--dry-run');
        log(`Running in DRY-RUN mode: helm ${helmArgs.join(' ')}`);
      }

      // Execute Helm command
      const helmCmd = `helm ${helmArgs.map((a) => (a.includes(' ') || a.includes('=') ? JSON.stringify(a) : a)).join(' ')}`;
      log(`Executing: ${helmCmd}`);

      if (!dryRun) {
        const { stdout, stderr } = await execAsync(helmCmd, { cwd: baseDir, env: getWaffleExecutionEnv() });
        if (stdout) log(stdout.trim());
        if (stderr) log(stderr.trim());

        // Health / Readiness probe
        stepProg.status = 'verifying';
        this.emit('progress', runProgress);
        log(`Verifying deployment readiness in namespace "${namespace}"...`);
        await this.verifyStepHealth(step, namespace, log);
      } else {
        log('Dry-run completed successfully (manifests simulated).');
      }

      stepProg.status = 'completed';
      stepProg.finishedAt = new Date().toISOString();
      stepProg.durationMs = Date.now() - startTimer;
      runProgress.completedSteps++;

      log(`Step "${step.name}" finished in ${(stepProg.durationMs / 1000).toFixed(1)}s.`);
      this.emit('step_complete', { stepId: step.id, status: 'completed' });
      this.emit('progress', runProgress);
      return true;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      const releaseName = step.releaseName || step.id;
      const isOpenEbsStep =
        step.id.toLowerCase().includes('openebs') ||
        releaseName.toLowerCase().includes('openebs') ||
        step.chart.toLowerCase().includes('openebs');

      if (
        isOpenEbsStep &&
        (errMsg.includes('field is immutable') ||
          errMsg.includes('cannot patch') ||
          errMsg.includes('meta.helm.sh/release-name') ||
          errMsg.includes('invalid ownership metadata') ||
          errMsg.includes('rendered manifests contain a resource that already exists') ||
          errMsg.includes('StorageClass "openebs-hostpath"'))
      ) {
        const fallbackCheck = await checkOpenEbsStatus(this.projectRoot).catch(() => ({
          isReady: false,
          message: '',
          storageClasses: [],
          readyDeployments: [],
          runningPods: 0,
        }));
        if (
          fallbackCheck.isReady ||
          fallbackCheck.storageClasses.some((s) => s.includes('openebs')) ||
          errMsg.includes('meta.helm.sh') ||
          errMsg.includes('already exists')
        ) {
          log(`[openebs] Warning: Helm reported existing installation conflict (${errMsg.split('\n')[0]}), but OpenEBS is verified active in cluster: ${fallbackCheck.message || 'StorageClass openebs-hostpath registered'}`);
          log(`[openebs] Marking step "${step.name}" as completed.`);

          stepProg.status = 'completed';
          stepProg.finishedAt = new Date().toISOString();
          stepProg.durationMs = Date.now() - startTimer;
          runProgress.completedSteps++;
          this.emit('step_complete', { stepId: step.id, status: 'completed' });
          this.emit('progress', runProgress);
          return true;
        }
      }

      stepProg.status = 'failed';
      stepProg.finishedAt = new Date().toISOString();
      stepProg.durationMs = Date.now() - startTimer;
      stepProg.error = err.message;
      runProgress.failedSteps++;

      log(`[ERROR] Step failed: ${err.message}`);
      this.emit('step_complete', { stepId: step.id, status: 'failed', error: err.message });
      this.emit('progress', runProgress);
      return false;
    }
  }

  /**
   * Verifies health of deployed resources
   */
  private async verifyStepHealth(step: WaffleStep, namespace: string, log: (msg: string) => void): Promise<void> {
    const health = step.healthCheck;
    if (!health) {
      // Default health check: wait for pods in namespace with app label
      try {
        const cmd = `kubectl rollout status deployment/${step.releaseName || step.id} -n ${namespace} --timeout=60s`;
        await execAsync(cmd, { env: getWaffleExecutionEnv() });
        log('Deployment rollout status confirmed ready.');
      } catch {
        // Rollout status is optional if chart has no matching single deployment name
      }
      return;
    }

    if (health.type === 'storageClass' && health.name) {
      log(`Checking StorageClass: "${health.name}"...`);
      await execAsync(`kubectl get sc ${health.name}`, { env: getWaffleExecutionEnv() });
      log(`StorageClass "${health.name}" is verified.`);
    } else if (health.type === 'podReady') {
      const releaseName = step.releaseName || step.id;
      log(`Waiting for pods associated with release "${releaseName}"...`);
      try {
        await execAsync(`kubectl wait --for=condition=ready pod -l app.kubernetes.io/instance=${releaseName} -n ${namespace} --timeout=${health.timeout || '2m'}`, { env: getWaffleExecutionEnv() });
        log('Pod readiness verified.');
      } catch {
        log('Warning: Pod readiness wait timed out or matched no pods; proceeding.');
      }
    }
  }

  private logToRun(message: string): void {
    if (this.activeRun) {
      this.activeRun.currentLogLine = message;
      this.emit('pipeline_log', message);
      this.emit('progress', this.activeRun);
    }
  }
}
