import * as fs from 'node:fs';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { substituteVariables } from './template.js';
import { mergeYamlStrings } from './yaml.js';
import { loadProjectConfig, findProjectRoot } from './config.js';

const execAsync = promisify(exec);

export interface InitializerResult {
  directory: string;
  appliedFiles: Array<{
    fileName: string;
    hasOverride: boolean;
    applied: boolean;
    error?: string;
  }>;
  success: boolean;
}

/**
 * Renders and merges manifests from an init directory, taking into account .init_overrides
 */
export function renderInitializerManifests(
  projectRoot: string,
  initDirRelativeOrAbsolute: string,
  envOverride?: Record<string, string | undefined>
): Array<{ fileName: string; content: string; hasOverride: boolean }> {
  const root = fs.existsSync(path.join(projectRoot, 'src', 'default.env'))
    ? projectRoot
    : findProjectRoot(projectRoot);
  const config = loadProjectConfig(root);
  const env: Record<string, string | undefined> = {
    ...config.raw,
    ...envOverride,
  };

  const baseDirName = path.basename(initDirRelativeOrAbsolute);
  const baseInitPath = path.isAbsolute(initDirRelativeOrAbsolute)
    ? initDirRelativeOrAbsolute
    : path.join(root, initDirRelativeOrAbsolute);

  const overridePath = path.join(root, '.init_overrides', baseDirName);
  const hasOverrideDir = fs.existsSync(overridePath) && fs.statSync(overridePath).isDirectory();

  if (!fs.existsSync(baseInitPath) && !hasOverrideDir) {
    return [];
  }

  const baseFiles = fs.existsSync(baseInitPath)
    ? fs.readdirSync(baseInitPath).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    : [];

  const overrideFiles = hasOverrideDir
    ? fs.readdirSync(overridePath).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    : [];

  const allFileNames = Array.from(new Set([...baseFiles, ...overrideFiles])).sort();
  const results: Array<{ fileName: string; content: string; hasOverride: boolean }> = [];

  for (const file of allFileNames) {
    const baseFilePath = path.join(baseInitPath, file);
    const overrideFilePath = path.join(overridePath, file);
    const hasOverride = hasOverrideDir && fs.existsSync(overrideFilePath);

    let finalYaml = '';
    if (fs.existsSync(baseFilePath) && hasOverride) {
      const baseContent = fs.readFileSync(baseFilePath, 'utf-8');
      const overrideContent = fs.readFileSync(overrideFilePath, 'utf-8');
      try {
        finalYaml = mergeYamlStrings(baseContent, overrideContent);
      } catch {
        finalYaml = overrideContent;
      }
    } else if (hasOverride) {
      finalYaml = fs.readFileSync(overrideFilePath, 'utf-8');
    } else if (fs.existsSync(baseFilePath)) {
      finalYaml = fs.readFileSync(baseFilePath, 'utf-8');
    }

    const substituted = substituteVariables(finalYaml, env);
    results.push({
      fileName: file,
      content: substituted,
      hasOverride,
    });
  }

  return results;
}

/**
 * Applies all manifests in an init directory to the Kubernetes cluster using kubectl apply
 */
export async function applyInitializerDirectory(
  projectRoot: string,
  initDirRelativeOrAbsolute: string,
  envOverride?: Record<string, string | undefined>
): Promise<InitializerResult> {
  const rendered = renderInitializerManifests(projectRoot, initDirRelativeOrAbsolute, envOverride);
  const baseDirName = path.basename(initDirRelativeOrAbsolute);

  const result: InitializerResult = {
    directory: baseDirName,
    appliedFiles: [],
    success: true,
  };

  if (rendered.length === 0) {
    return result;
  }

  for (const item of rendered) {
    try {
      // Apply via kubectl stdin
      const kubeEnv = {
        ...process.env,
        KUBECONFIG: process.env.KUBECONFIG || (fs.existsSync('/etc/rancher/k3s/k3s.yaml') ? '/etc/rancher/k3s/k3s.yaml' : undefined),
      };
      await new Promise<void>((resolve, reject) => {
        const proc = exec('kubectl apply -f -', { cwd: projectRoot, env: kubeEnv }, (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr || err.message));
          } else {
            resolve();
          }
        });

        if (proc.stdin) {
          proc.stdin.write(item.content);
          proc.stdin.end();
        } else {
          reject(new Error('Failed to open stdin for kubectl'));
        }
      });

      result.appliedFiles.push({
        fileName: item.fileName,
        hasOverride: item.hasOverride,
        applied: true,
      });
    } catch (err: any) {
      result.success = false;
      result.appliedFiles.push({
        fileName: item.fileName,
        hasOverride: item.hasOverride,
        applied: false,
        error: err.message,
      });
    }
  }

  return result;
}
