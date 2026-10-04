import { processManager, type TaskRun } from './executor.js';
import { loadProjectConfig } from './config.js';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { substituteVariables } from './template.js';

export interface ClusterStatus {
  platform: 'kind' | 'k3d' | 'k3s';
  isRunning?: boolean;
  name: string;
  ingress: string;
  clusterIssuer: string;
  domain: string;
  activeTasks: number;
}

export class ClusterOrchestrator {
  constructor(private projectRoot: string) {}

  public getStatus(): ClusterStatus {
    const config = loadProjectConfig(this.projectRoot);
    const runningTasks = processManager.getAllTasks().filter((t) => t.status === 'running');

    return {
      platform: config.cluster.k8sPlatform,
      name: config.raw['THIS_NAME'] || 'example',
      ingress: config.cluster.ingress,
      clusterIssuer: config.cluster.clusterIssuer,
      domain: config.cluster.domain,
      activeTasks: runningTasks.length,
    };
  }

  /**
   * Spawns the cluster creation process
   */
  public startCluster(): TaskRun {
    const config = loadProjectConfig(this.projectRoot);
    const platform = config.cluster.k8sPlatform;

    if (platform === 'kind') {
      const tplPath = path.join(this.projectRoot, 'src', 'kind-config.tpl');
      const renderedConfigPath = path.join(this.projectRoot, '.kind-config.rendered.yaml');

      if (fs.existsSync(tplPath)) {
        const rawTpl = fs.readFileSync(tplPath, 'utf-8');
        const rendered = substituteVariables(rawTpl, config.raw, { preserveUnknown: true });
        fs.writeFileSync(renderedConfigPath, rendered, 'utf-8');
      }

      return processManager.runCommand(
        'kind',
        ['create', 'cluster', `--config=${renderedConfigPath}`],
        {
          cwd: this.projectRoot,
          env: config.raw,
        }
      );
    } else if (platform === 'k3d') {
      const tplPath = path.join(this.projectRoot, 'src', 'k3d-config.tpl');
      const renderedConfigPath = path.join(this.projectRoot, '.k3d-config.rendered.yaml');

      if (fs.existsSync(tplPath)) {
        const rawTpl = fs.readFileSync(tplPath, 'utf-8');
        const rendered = substituteVariables(rawTpl, config.raw, { preserveUnknown: true });
        fs.writeFileSync(renderedConfigPath, rendered, 'utf-8');
      }

      return processManager.runCommand(
        'k3d',
        ['cluster', 'create', '--config', renderedConfigPath],
        {
          cwd: this.projectRoot,
          env: config.raw,
        }
      );
    } else {
      // k3s
      const upScript = path.join(this.projectRoot, 'src', 'k3s_up.sh');
      if (fs.existsSync(upScript)) {
        return processManager.runCommand('bash', [upScript], {
          cwd: this.projectRoot,
          env: config.raw,
        });
      }
      return processManager.runCommand('kubectl', ['get', 'nodes'], {
        cwd: this.projectRoot,
        env: config.raw,
      });
    }
  }

  /**
   * Tears down the cluster
   */
  public stopCluster(platformOverride?: 'kind' | 'k3d' | 'k3s', clusterName?: string): TaskRun {
    const config = loadProjectConfig(this.projectRoot);
    const platform = platformOverride || config.cluster.k8sPlatform;

    if (platform === 'kind') {
      const args = ['delete', 'cluster'];
      if (clusterName) {
        args.push('--name', clusterName);
      }
      return processManager.runCommand('kind', args, {
        cwd: this.projectRoot,
        env: config.raw,
      });
    } else if (platform === 'k3d') {
      const args = ['cluster', 'delete'];
      if (clusterName) {
        args.push(clusterName);
      }
      return processManager.runCommand('k3d', args, {
        cwd: this.projectRoot,
        env: config.raw,
      });
    } else {
      // k3s or baremetal
      const killScript = path.join(this.projectRoot, 'src', 'k3s_kill.sh');
      if (fs.existsSync(killScript)) {
        const hasTargets = fs.existsSync(path.join(this.projectRoot, 'targets'));
        const args = hasTargets ? [killScript, '--all', '-y'] : [killScript, '--local', '-y'];
        return processManager.runCommand('bash', args, {
          cwd: this.projectRoot,
          env: config.raw,
        });
      }
      return processManager.runCommand('echo', ['Cannot automatically delete baremetal/k3s cluster: src/k3s_kill.sh not found'], {
        cwd: this.projectRoot,
      });
    }
  }

  /**
   * Runs the full orchestration sequence (equivalent to ./up)
   */
  public runFullDeployment(): TaskRun {
    const config = loadProjectConfig(this.projectRoot);
    const upScript = path.join(this.projectRoot, 'up');

    return processManager.runCommand('bash', [upScript], {
      cwd: this.projectRoot,
      env: config.raw,
    });
  }
}
