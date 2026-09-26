import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

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
    const task = this.createTask(command, args, options.cwd);

    this.appendLog(task, 'system', `Executing: ${command} ${args.join(' ')}`);

    try {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        shell: true,
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
