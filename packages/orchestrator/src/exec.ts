import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

/** Sessions are killed after this long without input or output. */
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

export interface ExecSessionOptions {
  namespace: string;
  podName: string;
  containerName?: string;
  command?: string[];
  cols?: number;
  rows?: number;
}

export class ContainerExecSession extends EventEmitter {
  public id: string;
  private process?: ChildProcess;
  private isAlive = false;
  private closeEmitted = false;
  private lastActivity = Date.now();
  private idleTimer?: NodeJS.Timeout;

  constructor(public options: ExecSessionOptions) {
    super();
    // Was 8 chars of Math.random: collisions silently overwrote a live
    // session in the manager map, and ids were guessable by any other
    // k8s:exec holder.
    this.id = randomBytes(12).toString('hex');
  }

  private emitCloseOnce(code: number): void {
    if (this.closeEmitted) return;
    this.closeEmitted = true;
    if (this.idleTimer) clearInterval(this.idleTimer);
    this.emit('close', code);
  }

  private touch(): void {
    this.lastActivity = Date.now();
  }

  public start(): void {
    const args: string[] = ['exec', '-i'];
    if (this.options.namespace) {
      args.push('-n', this.options.namespace);
    }
    if (this.options.containerName) {
      args.push('-c', this.options.containerName);
    }
    args.push(this.options.podName);
    args.push('--');

    const cmd = this.options.command && this.options.command.length > 0
      ? this.options.command
      : ['/bin/sh', '-c', 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'];

    args.push(...cmd);

    this.process = spawn('kubectl', args, {
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLUMNS: String(this.options.cols || 80),
        LINES: String(this.options.rows || 24),
      },
    });

    this.isAlive = true;
    this.touch();
    this.idleTimer = setInterval(() => {
      if (this.isAlive && Date.now() - this.lastActivity > SESSION_IDLE_TIMEOUT_MS) {
        this.kill();
      }
    }, 60_000);
    this.idleTimer.unref?.();

    // Writing to a dead kubectl raises EPIPE on stdin; without a handler
    // that is an uncaught exception.
    this.process.stdin?.on('error', () => {});

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.touch();
      this.emit('data', chunk.toString('utf-8'));
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.touch();
      this.emit('data', chunk.toString('utf-8'));
    });

    this.process.on('close', (code) => {
      this.isAlive = false;
      this.emitCloseOnce(code ?? 0);
    });

    this.process.on('error', (err) => {
      this.isAlive = false;
      // Same unlistened-'error' hazard as the task executor: re-emit
      // only when someone is listening, and always surface a close so
      // the manager does not leak the session in its map.
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
      this.emitCloseOnce(1);
    });
  }

  public write(data: string): void {
    if (this.process && this.isAlive && this.process.stdin?.writable) {
      this.touch();
      this.process.stdin.write(data);
    }
  }

  public kill(): void {
    if (this.process && this.isAlive) {
      this.isAlive = false;
      this.process.kill('SIGTERM');
    }
  }

  public get running(): boolean {
    return this.isAlive;
  }
}

class ExecSessionManager {
  private sessions = new Map<string, ContainerExecSession>();

  public createSession(options: ExecSessionOptions): ContainerExecSession {
    const session = new ContainerExecSession(options);
    this.sessions.set(session.id, session);

    session.on('close', () => {
      this.sessions.delete(session.id);
    });

    session.start();
    return session;
  }

  public getSession(id: string): ContainerExecSession | undefined {
    return this.sessions.get(id);
  }

  public closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.kill();
      this.sessions.delete(id);
    }
  }
}

export const execSessionManager = new ExecSessionManager();
