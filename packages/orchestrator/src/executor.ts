import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import * as fs from 'node:fs';
import {
  TaskStore,
  taskStorePath,
  taskToRecord,
  type TaskRecord,
} from './taskStore.js';
import { findProjectRoot } from './config.js';

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
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  exitCode?: number | null;
  startedAt: string;
  finishedAt?: string;
  logs: TaskLogEntry[];
  emitter: EventEmitter;
  childProcess?: ChildProcess;
}

/**
 * Process and task manager for orchestrator operations.
 *
 * Live tasks are tracked in memory; when a task store is attached
 * (see initTaskPersistence), task *records* write through to SQLite
 * under .vow/ and reads merge memory with persisted history, so a
 * process restart no longer orphans task history (WS5). PTY exec
 * sessions stay in-memory deliberately — they hold live OS resources
 * that cannot survive a restart.
 *
 * NOTE: Tasks and execution states are maintained in-memory within this single Node.js process.
 * Running under multi-instance, clustered, or stateless serverless runtimes will not share task state.
 * For production multi-replica deployments, backing state with Redis, PostgreSQL, or a persistent job queue is required.
 */
export class ProcessManager {
  private tasks: Map<string, TaskRun> = new Map();
  private store: TaskStore | null = null;
  private lastFlush = new Map<string, number>();
  private autoAttachTried = false;

  /**
   * Lazy persistence (WS5): on the first task, if the task's cwd is
   * inside a VOW project (a src/default.env at or above it), open the
   * project's store, reconcile, and attach. This makes every entry
   * point (web routes, CLI, scripts) persistent without a boot hook,
   * while non-project cwds (unit tests, scratch dirs) stay in-memory.
   * VOW_TASK_STORE=off disables it; initTaskPersistence attaches
   * explicitly. Never throws.
   */
  private maybeAutoAttach(cwd: string): void {
    if (this.store || this.autoAttachTried) return;
    this.autoAttachTried = true;
    if (process.env.VOW_TASK_STORE === 'off') return;
    try {
      const root = findProjectRoot(cwd);
      if (!fs.existsSync(path.join(root, 'src', 'default.env'))) return;
      const store = new TaskStore(taskStorePath(root));
      store.reconcileRunning();
      this.attachStore(store);
    } catch {
      // persistence is best-effort
    }
  }

  /** Attach a persistent store; records write through from here on. */
  public attachStore(store: TaskStore): void {
    this.store = store;
  }

  public get attachedStore(): TaskStore | null {
    return this.store;
  }

  /** Write-through persistence: never throws (a store failure must
   *  not break task execution). */
  private persist(task: TaskRun): void {
    if (!this.store) return;
    try {
      this.store.upsert(taskToRecord(task));
      this.lastFlush.set(task.id, Date.now());
    } catch {
      // deliberately swallowed — see class doc
    }
  }
  private maxLogsPerTask = 2000;

  public createTask(command: string, args: string[], cwd: string): TaskRun {
    this.maybeAutoAttach(cwd);
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
    this.persist(task);
    return task;
  }

  public getTask(id: string): TaskRun | undefined {
    const live = this.tasks.get(id);
    if (live) return live;
    if (!this.store) return undefined;
    try {
      const record = this.store.get(id);
      return record ? hydrateRecord(record) : undefined;
    } catch {
      return undefined;
    }
  }

  public getAllTasks(): TaskRun[] {
    const merged = new Map<string, TaskRun>();
    if (this.store) {
      try {
        for (const record of this.store.list()) {
          merged.set(record.id, hydrateRecord(record));
        }
      } catch {
        // history unavailable; live tasks still return below
      }
    }
    for (const task of this.tasks.values()) {
      merged.set(task.id, task);
    }
    return Array.from(merged.values()).sort(
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
      this.persist(task);

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
        this.persist(task);
        task.emitter.emit('close', code);
      });

      child.on('error', (err: Error) => {
        task.status = 'failed';
        task.finishedAt = new Date().toISOString();
        this.appendLog(task, 'system', `Process error: ${err.message}`);
        this.persist(task);
        task.emitter.emit('error', err);
      });
    } catch (err: any) {
      task.status = 'failed';
      task.finishedAt = new Date().toISOString();
      this.appendLog(task, 'system', `Failed to spawn: ${err.message}`);
      this.persist(task);
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
      this.persist(task);
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

    // Write-through flush point, throttled: log streams can be hot,
    // and the transition flushes (start/close/cancel) carry the
    // state that matters most.
    if (this.store && Date.now() - (this.lastFlush.get(task.id) ?? 0) > 250) {
      this.persist(task);
    }

    task.emitter.emit('log', entry);
  }
}

/** Rebuild a TaskRun view from its persisted record (history). */
function hydrateRecord(record: TaskRecord): TaskRun {
  const meta = record.meta as {
    command?: string;
    args?: string[];
    cwd?: string;
  };
  return {
    id: record.id,
    command: meta.command ?? record.label,
    args: meta.args ?? [],
    cwd: meta.cwd ?? '',
    status: record.status,
    exitCode: record.exitCode,
    startedAt: record.startedAt,
    finishedAt: record.endedAt ?? undefined,
    logs: record.logTail,
    emitter: new EventEmitter(),
  };
}

export const processManager = new ProcessManager();

let persistenceInitialized = false;

/**
 * Attach SQLite task persistence for a project (WS5): opens
 * <projectRoot>/.vow/state.db, reconciles tasks a previous process
 * left marked running, and attaches the store to the shared
 * processManager. Idempotent; returns the store, or null when
 * persistence is unavailable — it never throws, because task
 * execution must not depend on the history store.
 */
export function initTaskPersistence(projectRoot: string): TaskStore | null {
  if (persistenceInitialized) return processManager.attachedStore;
  persistenceInitialized = true;
  try {
    const store = new TaskStore(taskStorePath(projectRoot));
    store.reconcileRunning();
    processManager.attachStore(store);
    return store;
  } catch {
    return null;
  }
}
