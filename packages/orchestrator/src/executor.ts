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
  'git',
]);

/**
 * Per-binary argument policy (bug-sweep fix, 2026-10-14).
 *
 * The allowlist used to validate only the binary NAME: any allowlisted
 * binary accepted arbitrary arguments, which quietly re-opened code
 * execution (`git -c core.sshCommand=...`, `ssh -o ProxyCommand=...`,
 * `docker run --privileged`, `helm --post-renderer`, GNU parallel).
 * Returns a rejection reason, or null when the arguments are acceptable.
 */
export function validateBinaryArgs(binary: string, args: string[]): string | null {
  for (const arg of args) {
    if (arg.includes('\0') || arg.includes('\n')) {
      return 'Arguments must not contain NUL or newline characters';
    }
  }

  switch (binary) {
    case 'git': {
      for (const arg of args) {
        if (
          arg === '-c' ||
          arg.startsWith('--config') ||
          arg.startsWith('--exec-path') ||
          arg === '-u' ||
          arg.startsWith('--upload-pack') ||
          arg.startsWith('--receive-pack') ||
          arg.startsWith('ext::')
        ) {
          return `git argument "${arg}" can execute arbitrary commands (config/transport injection) and is forbidden`;
        }
      }
      return null;
    }
    case 'ssh':
    case 'scp': {
      const localExecKeys = ['proxycommand', 'localcommand', 'permitlocalcommand', 'pkcs11provider', 'securitykeyprovider'];
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '-F') return `${binary} -F (custom config file) is forbidden: the config can contain ProxyCommand`;
        if (binary === 'scp' && arg === '-S') return 'scp -S (custom connection program) is forbidden';
        const optValue = arg === '-o' ? args[i + 1] : arg.startsWith('-o') ? arg.slice(2) : undefined;
        if (optValue) {
          const key = optValue.split('=')[0]?.trim().toLowerCase();
          if (key && localExecKeys.includes(key)) {
            return `${binary} option "${key}" executes a local command/library and is forbidden`;
          }
        }
        // Combined form: a bare token like ProxyCommand=... as an -o value
        // is handled above; also catch it when smuggled as its own token.
        const bareKey = arg.split('=')[0]?.trim().toLowerCase();
        if (arg.includes('=') && bareKey && localExecKeys.includes(bareKey)) {
          return `${binary} option "${bareKey}" executes a local command/library and is forbidden`;
        }
      }
      return null;
    }
    case 'docker': {
      const allowedSubcommands = new Set([
        'build', 'push', 'pull', 'tag', 'save', 'load', 'images', 'image',
        'ps', 'inspect', 'version', 'info', 'login', 'logout', 'rmi', 'history',
      ]);
      const globalValueFlags = new Set(['--config', '--host', '-H', '--context', '--log-level', '-l']);
      let subcommand: string | undefined;
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (globalValueFlags.has(arg)) {
          i++;
          continue;
        }
        if (arg.startsWith('-')) continue;
        subcommand = arg;
        break;
      }
      if (subcommand && !allowedSubcommands.has(subcommand)) {
        return `docker subcommand "${subcommand}" is forbidden through the task executor (container execution/management is out of scope; allowed: ${[...allowedSubcommands].join(', ')})`;
      }
      return null;
    }
    case 'helm': {
      for (const arg of args) {
        if (arg === '--post-renderer' || arg.startsWith('--post-renderer=')) {
          return 'helm --post-renderer executes an arbitrary binary and is forbidden';
        }
      }
      return null;
    }
    case 'kubectl': {
      for (const arg of args) {
        if (arg === '--server' || arg.startsWith('--server=')) {
          return 'kubectl --server is forbidden: it would send cluster credentials to an arbitrary endpoint';
        }
      }
      const subcommand = args.find((a) => !a.startsWith('-'));
      if (subcommand && ['exec', 'cp', 'port-forward'].includes(subcommand)) {
        return `kubectl ${subcommand} is forbidden through the generic task executor (use the dedicated exec route, which is permission-gated separately)`;
      }
      return null;
    }
    default:
      return null;
  }
}

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

  const argRejection = validateBinaryArgs(baseBinary, rawArgs);
  if (argRejection) {
    return { allowed: false, reason: argRejection };
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
    if (process.env.VOW_TASK_STORE === 'off') {
      this.autoAttachTried = true;
      return;
    }
    try {
      const root = findProjectRoot(cwd);
      if (!fs.existsSync(path.join(root, 'src', 'default.env'))) {
        // Definitive negative: not a project cwd. (Previously the tried
        // flag was also set when the attach THREW, permanently disabling
        // persistence for the process after one transient failure.)
        this.autoAttachTried = true;
        return;
      }
      const store = new TaskStore(taskStorePath(root));
      store.reconcileRunning();
      this.attachStore(store);
    } catch {
      // persistence is best-effort; leave autoAttachTried unset so the
      // next task retries instead of disabling persistence for good.
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
    this.pruneTasks();
    return task;
  }

  /**
   * Bounds the in-memory task map (bug-sweep fix): it previously grew
   * without limit for the life of the process, retaining every task and
   * its logs forever. Terminal tasks are kept up to a cap, newest first;
   * running tasks are never pruned.
   */
  private pruneTasks(): void {
    const MAX_TERMINAL_TASKS = 200;
    const terminal = [...this.tasks.values()]
      .filter((task) => task.status !== 'running')
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    for (const task of terminal.slice(MAX_TERMINAL_TASKS)) {
      this.tasks.delete(task.id);
      this.lastFlush.delete(task.id);
    }
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
      /** Kill the task (SIGTERM, then SIGKILL after a grace period) after this many ms. */
      timeoutMs?: number;
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

      // Terminal-state handling is finalize-once: whichever of close /
      // error / cancel / timeout lands first owns the status, and 'close'
      // is emitted exactly once. Previously the child's close handler
      // unconditionally overwrote a user cancel back to failed/completed,
      // and the error handler emitted 'error' on an emitter with no
      // listeners — which Node turns into a thrown exception that can
      // crash the server process.
      let finalized = false;
      let timedOut = false;
      let timeoutTimer: NodeJS.Timeout | undefined;
      let killTimer: NodeJS.Timeout | undefined;

      const finalize = (status: TaskRun['status'], code: number | null, logLine: string): void => {
        if (finalized) return;
        finalized = true;
        if (timeoutTimer) clearTimeout(timeoutTimer);
        if (killTimer) clearTimeout(killTimer);
        task.exitCode = code;
        task.finishedAt = new Date().toISOString();
        task.status = status;
        this.appendLog(task, 'system', logLine);
        this.persist(task);
        task.emitter.emit('close', code);
      };
      taskFinalizers.set(task, finalize);

      if (options.timeoutMs && options.timeoutMs > 0) {
        timeoutTimer = setTimeout(() => {
          timedOut = true;
          this.appendLog(task, 'system', `Task timed out after ${options.timeoutMs}ms; terminating`);
          try {
            child.kill('SIGTERM');
          } catch {
            // already gone
          }
          killTimer = setTimeout(() => {
            if (child.exitCode === null && child.signalCode === null) {
              try {
                child.kill('SIGKILL');
              } catch {
                // already gone
              }
            }
          }, 5000);
          killTimer.unref?.();
        }, options.timeoutMs);
        timeoutTimer.unref?.();
      }

      child.stdout.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        this.appendLog(task, 'stdout', text);
      });

      child.stderr.on('data', (data: Buffer) => {
        const text = data.toString('utf-8');
        this.appendLog(task, 'stderr', text);
      });

      child.on('close', (code: number | null) => {
        if (task.status === 'cancelled') {
          // Cancel already finalized the record; just note the real exit.
          this.appendLog(task, 'system', `Process exited with code ${code} after cancellation`);
          this.persist(task);
          return;
        }
        finalize(
          timedOut ? 'failed' : code === 0 ? 'completed' : 'failed',
          code,
          timedOut
            ? `Process terminated after timeout (code ${code})`
            : `Process exited with code ${code} (${code === 0 ? 'completed' : 'failed'})`
        );
      });

      child.on('error', (err: Error) => {
        if (task.status === 'cancelled') return;
        if (task.emitter.listenerCount('error') > 0) {
          task.emitter.emit('error', err);
        }
        finalize('failed', null, `Process error: ${err.message}`);
      });
    } catch (err) {
      // Spawn threw synchronously: the caller has not had a chance to
      // attach any listener yet, so emitting 'error' here would throw.
      // Record the failure on the task instead (status is the contract).
      task.status = 'failed';
      task.finishedAt = new Date().toISOString();
      this.appendLog(task, 'system', `Failed to spawn: ${err instanceof Error ? err.message : String(err)}`);
      this.persist(task);
      task.emitter.emit('close', null);
    }

    return task;
  }

  public cancelTask(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.status !== 'running' || !task.childProcess) {
      return false;
    }

    try {
      const child = task.childProcess;
      child.kill('SIGTERM');
      // Escalate: a child that ignores SIGTERM used to run forever while
      // its record claimed a finished state.
      const killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill('SIGKILL');
          } catch {
            // already gone
          }
        }
      }, 5000);
      killTimer.unref?.();

      const finalize = taskFinalizers.get(task);
      if (finalize) {
        finalize('cancelled', -1, 'Process terminated by user');
      } else {
        task.status = 'cancelled';
        task.finishedAt = new Date().toISOString();
        this.appendLog(task, 'system', 'Process terminated by user');
        this.persist(task);
        task.emitter.emit('close', -1);
      }
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

/**
 * Per-task finalize callbacks registered by runCommand, keyed by the task
 * object. Lets cancelTask finalize through the same finalize-once path as
 * the child's own close/error handlers (so cancel state can't be
 * overwritten by the later close event, and 'close' emits exactly once).
 */
const taskFinalizers = new WeakMap<
  TaskRun,
  (status: TaskRun['status'], code: number | null, logLine: string) => void
>();

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
