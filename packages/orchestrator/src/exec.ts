import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

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

  constructor(public options: ExecSessionOptions) {
    super();
    this.id = Math.random().toString(36).substring(2, 10);
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

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.emit('data', chunk.toString('utf-8'));
    });

    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.emit('data', chunk.toString('utf-8'));
    });

    this.process.on('close', (code) => {
      this.isAlive = false;
      this.emit('close', code ?? 0);
    });

    this.process.on('error', (err) => {
      this.isAlive = false;
      this.emit('error', err);
    });
  }

  public write(data: string): void {
    if (this.process && this.isAlive && this.process.stdin?.writable) {
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
