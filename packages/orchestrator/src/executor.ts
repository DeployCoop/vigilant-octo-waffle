import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import * as fs from 'node:fs';

export const ALLOWED_EXECUTABLES = new Set([
  'kubectl',
  'helm',
  'kind',
  'k3d',
  'k3s',
  'argocd',
  'flux',
  'velero',
  'docker',
  'mkcert',
  'echo',
  'ssh',
  'scp',
  'parallel',
  'git',
]);

export interface CommandValidationResult {
  allowed: boolean;
  reason?: string;
  normalizedCommand?: string;
  normalizedArgs?: string[];
}

/**
 * Validates a command and argument list against the orchestrator allowlist.
 * Prevents arbitrary code execution and command injection.
 */
export function validateCommand(
  rawCommand: string,
  rawArgs: string[] = [],
  cwd: string = process.cwd()
): CommandValidationResult {
  if (!rawCommand || typeof rawCommand !== 'string') {
    return { allowed: false, reason: 'Command must be a non-empty string' };
  }

  const trimmedCmd = rawCommand.trim();

  // Direct script execution: e.g. "./up" or "up"
  if (trimmedCmd === './up' || trimmedCmd === 'up') {
    const upPath = path.resolve(cwd, 'up');
    if (!fs.existsSync(upPath)) {
      return { allowed: false, reason: 'Script "./up" does not exist in project root' };
    }
    return {
      allowed: true,
      normalizedCommand: 'bash',
      normalizedArgs: [upPath, ...rawArgs],
    };
  }

  // If command is bash
  if (trimmedCmd === 'bash' || trimmedCmd === '/bin/bash' || trimmedCmd === '/usr/bin/bash') {
    if (rawArgs.length === 0) {
      return { allowed: false, reason: 'Interactive bash or empty arguments are not permitted' };
    }

    // Disallow dangerous shell evaluation flags (-c, -s, -i, etc.)
    for (const arg of rawArgs) {
      if (arg === '-c' || arg === '-s' || arg === '-i' || arg.startsWith('-c') || arg === '--rcfile') {
        return { allowed: false, reason: 'Bash shell evaluation flags (-c, -s, etc.) are strictly forbidden' };
      }
    }

    const scriptTarget = rawArgs[0];
    const resolvedTarget = path.resolve(cwd, scriptTarget);
    const resolvedCwd = path.resolve(cwd);

    // Prevent directory traversal outside cwd
    if (!resolvedTarget.startsWith(resolvedCwd + path.sep) && resolvedTarget !== resolvedCwd) {
      return { allowed: false, reason: 'Script path must remain within the repository root' };
    }

    // Must be a recognized script (up, src/*.sh)
    const rel = path.relative(resolvedCwd, resolvedTarget);
    const isUpScript = rel === 'up';
    const isSrcScript = rel.startsWith('src' + path.sep) && rel.endsWith('.sh');

    if (!isUpScript && !isSrcScript) {
      return {
        allowed: false,
        reason: `Target script "${rel}" is not an authorized project script (allowed: up, src/*.sh)`,
      };
    }

    if (!fs.existsSync(resolvedTarget)) {
      return { allowed: false, reason: `Target script "${rel}" does not exist on disk` };
    }

    return {
      allowed: true,
      normalizedCommand: 'bash',
      normalizedArgs: [resolvedTarget, ...rawArgs.slice(1)],
    };
  }

  // Check if binary is in ALLOWED_EXECUTABLES
  const baseBinary = path.basename(trimmedCmd);
  if (!ALLOWED_EXECUTABLES.has(baseBinary)) {
    return {
      allowed: false,
      reason: `Binary "${baseBinary}" is not in the orchestrator allowlist. Allowed binaries: ${Array.from(
        ALLOWED_EXECUTABLES
      ).join(', ')}, or bash with authorized project scripts (up, src/*.sh)`,
    };
  }

  // Ensure no path traversal in binary name
  if (trimmedCmd.includes('/') && !['/usr/bin/', '/usr/local/bin/', '/bin/'].some((p) => trimmedCmd.startsWith(p))) {
    return { allowed: false, reason: 'Custom path binaries outside standard system directories are not permitted' };
  }

  return {
    allowed: true,
    normalizedCommand: baseBinary,
    normalizedArgs: rawArgs,
  };
}

export interface TaskLogEntry {
  timestamp: string;
  type: 'stdout' | 'stderr' | 'system';
  message: string;
}

export interface TaskRun {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  exitCode?: number | null;
  startedAt: string;
  finishedAt?: string;
  logs: TaskLogEntry[];
  emitter: EventEmitter;
  childProcess?: ChildProcess;
}

/**
 * In-memory process and task manager for orchestrator operations.
 *
 * NOTE: Tasks and execution states are maintained in-memory within this single Node.js process.
 * Running under multi-instance, clustered, or stateless serverless runtimes will not share task state.
 * For production multi-replica deployments, backing state with Redis, PostgreSQL, or a persistent job queue is required.
 */
class ProcessManager {
  private tasks: Map<string, TaskRun> = new Map();
  private maxLogsPerTask = 2000;

  public createTask(command: string, args: string[], cwd: string): TaskRun {
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const emitter = new EventEmitter();

    const task: TaskRun = {
      id,
      command,
      args,
      cwd,
      status: 'running',
      startedAt: new Date().toISOString(),
      logs: [],
      emitter,
    };

    this.tasks.set(id, task);
    return task;
  }

  public getTask(id: string): TaskRun | undefined {
    return this.tasks.get(id);
  }

  public getAllTasks(): TaskRun[] {
    return Array.from(this.tasks.values()).sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  public runCommand(
    command: string,
    args: string[],
    options: {
      cwd: string;
      env?: Record<string, string>;
    }
  ): TaskRun {
    const validation = validateCommand(command, args, options.cwd);
    if (!validation.allowed) {
      throw new Error(`Command execution rejected by orchestrator allowlist: ${validation.reason}`);
    }

    const effectiveCmd = validation.normalizedCommand || command;
    const effectiveArgs = validation.normalizedArgs || args;

    const task = this.createTask(effectiveCmd, effectiveArgs, options.cwd);

    this.appendLog(task, 'system', `Executing: ${effectiveCmd} ${effectiveArgs.join(' ')}`);

    try {
      const child = spawn(effectiveCmd, effectiveArgs, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: false,
      });

      task.childProcess = child;

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        this.appendLog(task, 'stdout', text);
      });

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        this.appendLog(task, 'stderr', text);
      });

      child.on('close', (code: number | null) => {
        task.exitCode = code;
        task.finishedAt = new Date().toISOString();
        task.status = code === 0 ? 'completed' : 'failed';
        this.appendLog(
          task,
          'system',
          `Process exited with code ${code} (${task.status})`
        );
        task.emitter.emit('close', code);
      });

      child.on('error', (err: Error) => {
        task.status = 'failed';
        task.finishedAt = new Date().toISOString();
        this.appendLog(task, 'system', `Process error: ${err.message}`);
        task.emitter.emit('error', err);
      });
    } catch (err: any) {
      task.status = 'failed';
      task.finishedAt = new Date().toISOString();
      this.appendLog(task, 'system', `Failed to spawn: ${err.message}`);
      task.emitter.emit('error', err);
    }

    return task;
  }

  public cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running' || !task.childProcess) {
      return false;
    }

    try {
      task.childProcess.kill('SIGTERM');
      task.status = 'cancelled';
      task.finishedAt = new Date().toISOString();
      this.appendLog(task, 'system', 'Process terminated by user');
      task.emitter.emit('close', -1);
      return true;
    } catch {
      return false;
    }
  }

  private appendLog(task: TaskRun, type: 'stdout' | 'stderr' | 'system', message: string): void {
    const entry: TaskLogEntry = {
      timestamp: new Date().toISOString(),
      type,
      message,
    };

    task.logs.push(entry);
    if (task.logs.length > this.maxLogsPerTask) {
      task.logs.shift();
    }

    task.emitter.emit('log', entry);
  }
}

export const processManager = new ProcessManager();
