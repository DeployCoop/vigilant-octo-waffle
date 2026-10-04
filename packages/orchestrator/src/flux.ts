import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { loadProjectConfig } from './config.js';
import { processManager, type TaskRun } from './executor.js';
import { substituteVariables } from './template.js';
import { deepMergeYaml } from './yaml.js';

export interface PreparedFluxManifest {
  baseManifest: string;
  overrideManifest?: string;
  templatedYaml: string;
  source: 'native' | 'synthesized';
}

export class FluxManager {
  constructor(private projectRoot: string) {}

  /**
   * Reads, merges overrides, and templates a FluxCD application manifest.
   * Seamlessly synthesizes Flux resources from argo/<app>/argocd.yaml if native flux.yaml is absent.
   */
  public prepareAppManifest(appName: string): PreparedFluxManifest {
    const config = loadProjectConfig(this.projectRoot);
    const fluxNs = config.cluster.fluxNamespace || 'flux-system';
    const baseFluxPath = path.join(this.projectRoot, 'flux', appName, 'flux.yaml');
    const overrideFluxPath = path.join(this.projectRoot, '.flux_overrides', appName, 'flux.yaml');

    let baseManifest = '';
    let source: 'native' | 'synthesized' = 'native';

    if (fs.existsSync(baseFluxPath)) {
      baseManifest = fs.readFileSync(baseFluxPath, 'utf-8');
    } else {
      // Fallback: Synthesize Flux HelmRelease / Kustomization from ArgoCD Application manifest
      const baseArgoPath = path.join(this.projectRoot, 'argo', appName, 'argocd.yaml');
      if (fs.existsSync(baseArgoPath)) {
        const argoRaw = fs.readFileSync(baseArgoPath, 'utf-8');
        baseManifest = this.synthesizeFluxFromArgo(argoRaw, appName, fluxNs, {
          interval: config.raw.THIS_FLUX_INTERVAL || '5m',
          branch: config.raw.THIS_FLUX_BRANCH || 'main',
        });
        source = 'synthesized';
      } else {
        throw new Error(`No manifest found for '${appName}' in flux/ or argo/`);
      }
    }

    let finalYaml = baseManifest;
    let overrideManifest: string | undefined;

    if (fs.existsSync(overrideFluxPath)) {
      overrideManifest = fs.readFileSync(overrideFluxPath, 'utf-8');
      finalYaml = deepMergeYaml(baseManifest, overrideManifest);
    }

    // Substitute environment variables (${THIS_...}); unknown
    // references are preserved, matching fluxRunner's envsubst usage.
    const templatedYaml = substituteVariables(finalYaml, config.raw, {
      preserveUnknown: true,
    });

    return {
      baseManifest,
      overrideManifest,
      templatedYaml,
      source,
    };
  }

  /**
   * Synthesizes a FluxCD GitRepository + HelmRelease (or Kustomization) from an Argo Application CRD
   */
  public synthesizeFluxFromArgo(
    argoContent: string,
    appName: string,
    fluxNs = 'flux-system',
    resolved: { interval?: string; branch?: string } = {}
  ): string {
    // The interval/branch are resolved HERE, at generation time, on
    // purpose: the bash fluxRunner expands them while writing its
    // heredoc, and envsubst (either engine's substitution pass) never
    // expands \${VAR:-default} forms. Callers with a project config
    // (prepareAppManifest) pass the configured values; direct callers
    // get the historical placeholder text.
    const interval = resolved.interval ?? '${THIS_FLUX_INTERVAL:-5m}';
    const branch = resolved.branch ?? '${THIS_FLUX_BRANCH:-main}';
    let parsed: any = {};
    try {
      // uniqueKeys off: yq (the bash engine) tolerates duplicate map
      // keys last-wins, and real chart values in this repo use them.
      parsed = yaml.parse(argoContent, { uniqueKeys: false }) || {};
    } catch {
      parsed = {};
    }

    const spec = parsed.spec || {};
    const source = spec.source || {};
    const destination = spec.destination || {};
    const targetNs = destination.namespace || '${THIS_NAMESPACE}';
    const repoUrl = source.repoURL || '${THIS_REPO_URL}';
    const chartPath = source.path || '';
    const isHelm = Boolean(source.helm);

    const gitRepoDoc = {
      apiVersion: 'source.toolkit.fluxcd.io/v1',
      kind: 'GitRepository',
      metadata: {
        name: `${appName}-repo`,
        namespace: fluxNs,
      },
      spec: {
        interval,
        url: repoUrl,
        ref: {
          branch,
        },
      },
    };

    if (isHelm) {
      let helmValues: any = {};
      const rawValues = source.helm?.valuesObject || source.helm?.values;
      if (rawValues) {
        try {
          helmValues = typeof rawValues === 'string'
            ? yaml.parse(rawValues, { uniqueKeys: false }) || {}
            : rawValues;
        } catch {
          helmValues = {};
        }
      }

      const helmReleaseDoc = {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        metadata: {
          name: appName,
          namespace: targetNs,
        },
        spec: {
          interval,
          targetNamespace: targetNs,
          chart: {
            spec: {
              chart: chartPath,
              sourceRef: {
                kind: 'GitRepository',
                name: `${appName}-repo`,
                namespace: fluxNs,
              },
            },
          },
          values: helmValues,
        },
      };

      return `${yaml.stringify(gitRepoDoc).trim()}\n---\n${yaml.stringify(helmReleaseDoc).trim()}\n`;
    }

    // Non-Helm: Generate Kustomization
    const kustomizationDoc = {
      apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
      kind: 'Kustomization',
      metadata: {
        name: appName,
        namespace: fluxNs,
      },
      spec: {
        interval,
        targetNamespace: targetNs,
        prune: true,
        sourceRef: {
          kind: 'GitRepository',
          name: `${appName}-repo`,
        },
        path: `./${chartPath}`,
      },
    };

    return `${yaml.stringify(gitRepoDoc).trim()}\n---\n${yaml.stringify(kustomizationDoc).trim()}\n`;
  }

  /**
   * Deploys an application using FluxCD custom resources via kubectl apply
   */
  public deployApp(appName: string): TaskRun {
    const config = loadProjectConfig(this.projectRoot);
    const { templatedYaml } = this.prepareAppManifest(appName);

    const tmpDir = path.join(this.projectRoot, '.vow-cache', 'flux');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const tmpFile = path.join(tmpDir, `${appName}.yaml`);
    fs.writeFileSync(tmpFile, templatedYaml, 'utf-8');

    return processManager.runCommand(
      'kubectl',
      ['apply', '--server-side', '--force-conflicts', '-f', tmpFile],
      {
        cwd: this.projectRoot,
        env: config.raw,
      }
    );
  }

  /**
   * Syncs / Reconciles a FluxCD application via standard reconcile annotation
   */
  public syncApp(appName: string, namespace?: string): TaskRun {
    const config = loadProjectConfig(this.projectRoot);
    const targetNs = namespace || config.cluster.namespace || 'default';
    const now = String(Date.now());

    // Annotate HelmRelease to trigger immediate reconciliation
    return processManager.runCommand(
      'kubectl',
      ['annotate', '--overwrite', 'helmrelease', appName, '-n', targetNs, `reconcile.fluxcd.io/requestedAt=${now}`],
      {
        cwd: this.projectRoot,
        env: config.raw,
      }
    );
  }

  /**
   * Bootstraps FluxCD controllers and baseline CRDs using src/flux.sh
   */
  public bootstrapFlux(): TaskRun {
    const config = loadProjectConfig(this.projectRoot);
    const fluxScript = path.join(this.projectRoot, 'src', 'flux.sh');
    return processManager.runCommand('bash', [fluxScript], {
      cwd: this.projectRoot,
      env: config.raw,
    });
  }
}
