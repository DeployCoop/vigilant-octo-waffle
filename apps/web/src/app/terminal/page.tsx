'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Terminal as TerminalIcon,
  Play,
  Square,
  Trash2,
  Download,
  RotateCw,
  Clock,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface TaskSummary {
  id: string;
  command: string;
  args: string[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  exitCode?: number | null;
  startedAt: string;
  logCount: number;
}

export default function TerminalPage() {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [taskStatus, setTaskStatus] = useState<string>('idle');
  const [autoScroll, setAutoScroll] = useState(true);
  const [customCmd, setCustomCmd] = useState('');
  const [runningCmd, setRunningCmd] = useState(false);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/tasks');
      const data = await res.json();
      const list: TaskSummary[] = data.tasks || [];
      setTasks(list);

      // Auto-select latest task if none selected or if a task is currently running
      if (!selectedTaskId && list.length > 0) {
        setSelectedTaskId(list[0].id);
      } else if (list.length > 0) {
        const running = list.find((t) => t.status === 'running');
        if (running && running.id !== selectedTaskId) {
          // If a new task is running, automatically switch to it
          setSelectedTaskId(running.id);
        }
      }
    } catch {
      // offline
    }
  };

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, []);

  // Connect SSE for selected task
  useEffect(() => {
    if (!selectedTaskId) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    setLogs([]);
    const es = new EventSource(`/api/tasks/stream?taskId=${selectedTaskId}`);
    eventSourceRef.current = es;

    es.addEventListener('status', (e: any) => {
      try {
        const parsed = JSON.parse(e.data);
        setTaskStatus(parsed.status);
      } catch {}
    });

    es.addEventListener('log', (e: any) => {
      try {
        const parsed = JSON.parse(e.data);
        const prefix =
          parsed.type === 'system'
            ? '⚙ '
            : parsed.type === 'stderr'
            ? '⚠ '
            : '  ';
        setLogs((prev) => [...prev, `${prefix}${parsed.message.trimEnd()}`]);
      } catch {}
    });

    es.addEventListener('done', (e: any) => {
      try {
        const parsed = JSON.parse(e.data);
        setTaskStatus(parsed.status);
      } catch {}
      fetchTasks();
    });

    es.onerror = () => {
      es.close();
    };

    return () => {
      es.close();
    };
  }, [selectedTaskId]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleRunCustom = async (e?: React.FormEvent, preset?: string) => {
    if (e) e.preventDefault();
    const commandToRun = (preset || customCmd).trim();
    if (!commandToRun) return;

    setErrorMsg(null);
    setRunningCmd(true);
    try {
      const parts = commandToRun.split(' ').filter(Boolean);
      const command = parts[0];
      const args = parts.slice(1);

      const res = await fetch('/api/tasks/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, args }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setErrorMsg(data.error || 'Failed to dispatch command');
        return;
      }

      setSelectedTaskId(data.taskId);
      setCustomCmd('');
      fetchTasks();
    } catch (err: any) {
      setErrorMsg(err.message || 'Network error while dispatching command');
    } finally {
      setRunningCmd(false);
    }
  };

  const handleCancelTask = async () => {
    if (!selectedTaskId) return;
    try {
      await fetch('/api/tasks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: selectedTaskId }),
      });
      fetchTasks();
    } catch {}
  };

  const handleDownloadLogs = () => {
    const text = logs.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTaskId || 'task'}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto h-[calc(100vh-8rem)] flex flex-col">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-900 border border-slate-800 rounded-xl shrink-0">
        <div className="flex items-center space-x-3">
          <TerminalIcon className="w-5 h-5 text-sky-400" />
          <div>
            <h2 className="text-sm font-bold text-white">Live Operations Terminal</h2>
            <p className="text-xs text-slate-400">Stream realtime output from cluster and container tasks</p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Task Selector */}
          <select
            value={selectedTaskId || ''}
            onChange={(e) => setSelectedTaskId(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
          >
            {tasks.length === 0 ? (
              <option value="">No tasks recorded</option>
            ) : (
              tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  [{t.status.toUpperCase()}] {t.command} {t.args.slice(0, 2).join(' ')} ({new Date(t.startedAt).toLocaleTimeString()})
                </option>
              ))
            )}
          </select>

          {taskStatus === 'running' && (
            <button
              onClick={handleCancelTask}
              className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1"
              title="Terminate running process"
            >
              <Square className="w-3 h-3 fill-white" />
              <span>Kill</span>
            </button>
          )}

          <button
            onClick={() => setLogs([])}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
            title="Clear Console"
          >
            <Trash2 className="w-4 h-4" />
          </button>

          <button
            onClick={handleDownloadLogs}
            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
            title="Download Log File"
          >
            <Download className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Output Window */}
      <div className="flex-1 bg-black border border-slate-800 rounded-xl p-4 font-mono text-xs overflow-y-auto leading-relaxed flex flex-col justify-between">
        <div className="space-y-1">
          {logs.length === 0 ? (
            <div className="text-slate-600 select-none py-8 text-center">
              Terminal ready. Logs will stream here when tasks are executed.
            </div>
          ) : (
            logs.map((line, idx) => (
              <div
                key={idx}
                className={`whitespace-pre-wrap ${
                  line.startsWith('⚠')
                    ? 'text-amber-400'
                    : line.startsWith('⚙')
                    ? 'text-sky-400 font-bold'
                    : 'text-slate-300'
                }`}
              >
                {line}
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>
      </div>

      {/* Security notice & Quick Allowlisted Presets */}
      <div className="space-y-2 shrink-0">
        {errorMsg && (
          <div className="flex items-center space-x-2 p-3 bg-rose-950/60 border border-rose-800 text-rose-300 rounded-lg text-xs font-mono">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-slate-400 text-[11px] font-medium mr-1 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            Allowed Presets:
          </span>
          {[
            'bash up',
            'bash src/hostr.sh',
            'kubectl get nodes',
            'kubectl get pods -A',
            'helm list -A',
            'argocd app list',
          ].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => handleRunCustom(undefined, preset)}
              disabled={runningCmd}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded border border-slate-700 font-mono text-[11px] transition-colors disabled:opacity-50"
            >
              {preset}
            </button>
          ))}
        </div>

        {/* Command Dispatcher Bar */}
        <form onSubmit={(e) => handleRunCustom(e)} className="flex gap-2">
          <input
            type="text"
            placeholder="Execute allowlisted command (e.g. bash src/hostr.sh, kubectl get pods -A, bash up)..."
            value={customCmd}
            onChange={(e) => setCustomCmd(e.target.value)}
            disabled={runningCmd}
            className="flex-1 px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg font-mono text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
          <button
            type="submit"
            disabled={runningCmd || !customCmd.trim()}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors disabled:opacity-40"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Execute</span>
          </button>
        </form>
        <p className="text-[10px] text-slate-500 font-mono">
          Security Guard Active: Shell execution restricted by orchestrator allowlist (kubectl, helm, kind, k3d, argocd, velero, docker, mkcert, or bash with project scripts).
        </p>
      </div>
    </div>
  );
}
