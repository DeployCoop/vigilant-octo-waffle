import * as fs from 'node:fs';
import * as path from 'node:path';
import { substituteVariables } from './template.js';
import { mergeYamlStrings } from './yaml.js';
import { processManager, type TaskRun } from './executor.js';
import { loadProjectConfig } from './config.js';

export interface ArgoAppManifestResult {
  appName: string;
  hasOverride: boolean;
  templatedYaml: string;
}

export class ArgoManager {
  constructor(private projectRoot: string) {}

  /**
   * Reads, merges overrides, and templates an ArgoCD application manifest
   */
  public prepareAppManifest(appName: string): ArgoAppManifestResult {
    const config = loadProjectConfig(this.projectRoot);
    const baseArgoPath = path.join(this.projectRoot, 'argo', appName, 'argocd.yaml');
    const overrideArgoPath = path.join(this.projectRoot, '.argo_overrides', appName, 'argocd.yaml');

    if (!fs.existsSync(baseArgoPath)) {
      throw new Error(`Base Argo manifest not found at ${baseArgoPath}`);
    }

    let yamlContent = fs.readFileSync(baseArgoPath, 'utf-8');
    const hasOverride = fs.existsSync(overrideArgoPath);

    if (hasOverride) {
      const overrideContent = fs.readFileSync(overrideArgoPath, 'utf-8');
      yamlContent = mergeYamlStrings(yamlContent, overrideContent);
    }

    // Substitute variables using current configuration
    const templatedYaml = substituteVariables(yamlContent, config.raw, {
      preserveUnknown: true,
    });

    return {
      appName,
      hasOverride,
      templatedYaml,
    };
  }

  /**
   * Deploys an ArgoCD application using argocd app create --upsert
   */
  public deployApp(appName: string): TaskRun {
    const config = loadProjectConfig(this.projectRoot);
    const { templatedYaml } = this.prepareAppManifest(appName);

    // Save templated manifest to a temporary location
    const tmpDir = path.join(this.projectRoot, '.vow-cache', 'argo');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const tmpFile = path.join(tmpDir, `${appName}.yaml`);
    fs.writeFileSync(tmpFile, templatedYaml, 'utf-8');

    // Argument parity with src/argoRunner.bash: the runner appends
    // $ARGOCD_CREATE_APP_EXTRA_ARGS (default --insecure) and
    // --loglevel $THIS_ARGO_LOG_LEVEL to the create invocation.
    const extraArgsRaw = config.raw['ARGOCD_CREATE_APP_EXTRA_ARGS']?.trim();
    const extraArgs = (extraArgsRaw ? extraArgsRaw : '--insecure')
      .split(/\s+/)
      .filter(Boolean);
    const logLevel = config.raw['THIS_ARGO_LOG_LEVEL'] || 'info';

    return processManager.runCommand(
      'argocd',
      [
        'app',
        'create',
        '--upsert',
        ...extraArgs,
        '--name',
        appName,
        '--loglevel',
        logLevel,
        '--grpc-web',
        '-f',
        tmpFile,
      ],
      {
        cwd: this.projectRoot,
        env: config.raw,
      }
    );
  }

  /**
   * Syncs an ArgoCD application
   */
  public syncApp(appName: string): TaskRun {
    const config = loadProjectConfig(this.projectRoot);

    return processManager.runCommand(
      'argocd',
      ['app', 'sync', appName, '--grpc-web'],
      {
        cwd: this.projectRoot,
        env: config.raw,
      }
    );
  }
}
