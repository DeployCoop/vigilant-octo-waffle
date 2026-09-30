'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import Link from 'next/link';
import {
  Terminal as TerminalIcon,
  X,
  Minimize2,
  Maximize2,
  Square,
  Copy,
  Check,
  Download,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Play,
  RotateCcw,
  Search,
  ExternalLink,
  ChevronDown,
} from 'lucide-react';
import { useTerminal } from '@/context/TerminalContext';

export function TerminalModal() {
  const {
    isOpen,
    isMinimized,
    isMaximized,
    activeTaskId,
    activeTaskTitle,
    tasks,
    runningTaskCount,
    autoPopOnNewTask,
    closeTerminal,
    minimizeTerminal,
    maximizeTerminal,
    restoreTerminal,
    openTerminal,
    setAutoPopOnNewTask,
  } = useTerminal();

  const [logs, setLogs] = useState<string[]>([]);
  const [taskStatus, setTaskStatus] = useState<string>('idle');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [elapsedSec, setElapsedSec] = useState<number>(0);

  const logsEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const currentTask = useMemo(() => {
    return tasks.find((t) => t.id === activeTaskId);
  }, [tasks, activeTaskId]);

  // Connect SSE stream whenever activeTaskId changes
  useEffect(() => {
    if (!isOpen || !activeTaskId) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    setLogs([]);
    setTaskStatus(currentTask?.status || 'running');
    setExitCode(currentTask?.exitCode ?? null);

    const es = new EventSource(`/api/tasks/stream?taskId=${activeTaskId}`);
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
        setExitCode(parsed.exitCode ?? null);
      } catch {}
    });

    es.onerror = () => {
      // Stream closed or error
      es.close();
    };

    return () => {
      es.close();
    };
  }, [isOpen, activeTaskId, currentTask?.status, currentTask?.exitCode]);

  // Autoscroll to bottom as logs stream in
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  // Elapsed timer while running
  useEffect(() => {
    if (taskStatus === 'running') {
      const startTime = currentTask?.startedAt
        ? new Date(currentTask.startedAt).getTime()
        : Date.now();
      timerRef.current = setInterval(() => {
        setElapsedSec(Math.max(0, Math.floor((Date.now() - startTime) / 1000)));
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [taskStatus, currentTask?.startedAt]);

  // Escape key handler to close / minimize
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isMinimized) {
        minimizeTerminal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isMinimized, minimizeTerminal]);

  const handleCopyLogs = async () => {
    try {
      const plainText = logs.map((l) => l.replace(/^[⚙⚠\s]\s?/, '')).join('\n');
      await navigator.clipboard.writeText(plainText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleDownloadLogs = () => {
    const plainText = logs.map((l) => l.replace(/^[⚙⚠\s]\s?/, '')).join('\n');
    const blob = new Blob([plainText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${activeTaskId || 'task'}.log`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleCancelTask = async () => {
    if (!activeTaskId || cancelling) return;
    setCancelling(true);
    try {
      await fetch('/api/tasks', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: activeTaskId }),
      });
      setTaskStatus('cancelled');
    } catch {}
    finally {
      setCancelling(false);
    }
  };

  const filteredLogs = useMemo(() => {
    if (!searchFilter.trim()) return logs;
    const lower = searchFilter.toLowerCase();
    return logs.filter((l) => l.toLowerCase().includes(lower));
  }, [logs, searchFilter]);

  if (!isOpen) return null;

  // Render Minimized Floating Dock Pill
  if (isMinimized) {
    return (
      <div
        className="fixed bottom-5 right-5 z-50 flex items-center space-x-3 px-4 py-2.5 bg-slate-900/95 border border-slate-700/80 rounded-full shadow-2xl backdrop-blur-md cursor-pointer hover:border-sky-500/60 transition-all group animate-in slide-in-from-bottom-4"
        onClick={() => restoreTerminal()}
      >
        <div className="flex items-center space-x-2">
          <TerminalIcon className="w-4 h-4 text-sky-400 group-hover:scale-110 transition-transform" />
          {taskStatus === 'running' ? (
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
          ) : taskStatus === 'completed' ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
          )}
          <span className="text-xs font-semibold text-white truncate max-w-[200px]">
            {activeTaskTitle || activeTaskId}
          </span>
          {taskStatus === 'running' && (
            <span className="text-[11px] font-mono text-emerald-400 font-medium">
              ({elapsedSec}s)
            </span>
          )}
        </div>

        <div className="flex items-center space-x-1 pl-2 border-l border-slate-700" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => restoreTerminal()}
            className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
            title="Expand Terminal"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => closeTerminal()}
            className="p-1 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // Render Full Modal Dialog
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div
        className={`bg-slate-950 border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${
          isMaximized
            ? 'w-full h-full rounded-none border-none'
            : 'w-full max-w-5xl h-[85vh] max-h-[900px]'
        }`}
      >
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-slate-900/90 border-b border-slate-800 select-none">
          <div className="flex items-center space-x-3 min-w-0">
            {/* Traffic Light Dots */}
            <div className="flex items-center space-x-1.5 pr-2">
              <button
                onClick={() => closeTerminal()}
                className="w-3 h-3 rounded-full bg-rose-500/80 hover:bg-rose-500 transition-colors"
                title="Close Terminal"
              />
              <button
                onClick={() => minimizeTerminal()}
                className="w-3 h-3 rounded-full bg-amber-500/80 hover:bg-amber-500 transition-colors"
                title="Minimize Terminal"
              />
              <button
                onClick={() => (isMaximized ? restoreTerminal() : maximizeTerminal())}
                className="w-3 h-3 rounded-full bg-emerald-500/80 hover:bg-emerald-500 transition-colors"
                title={isMaximized ? 'Restore' : 'Maximize'}
              />
            </div>

            <div className="flex items-center space-x-2 truncate">
              <TerminalIcon className="w-4 h-4 text-sky-400 shrink-0" />
              <h3 className="text-xs sm:text-sm font-bold text-white tracking-tight truncate">
                {activeTaskTitle || 'Process Terminal'}
              </h3>
              {activeTaskId && (
                <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
                  ({activeTaskId})
                </span>
              )}
            </div>

            {/* Task Selector Dropdown (if multiple tasks) */}
            {tasks.length > 1 && (
              <div className="relative hidden md:block">
                <select
                  value={activeTaskId || ''}
                  onChange={(e) => {
                    const chosen = tasks.find((t) => t.id === e.target.value);
                    if (chosen) openTerminal(chosen.id, `${chosen.command} ${chosen.args[0] || ''}`);
                  }}
                  className="bg-slate-950 border border-slate-800 text-[11px] font-mono text-slate-300 rounded px-2 py-0.5 pr-6 cursor-pointer focus:outline-none focus:border-sky-500 appearance-none"
                >
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.status === 'running' ? '⚡ ' : ''}{t.command} {t.args.slice(0, 2).join(' ')} ({t.id.slice(0, 8)})
                    </option>
                  ))}
                </select>
                <ChevronDown className="w-3 h-3 text-slate-500 absolute right-1.5 top-1.5 pointer-events-none" />
              </div>
            )}
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center space-x-2">
            {/* Status Badge */}
            <span
              className={`text-[11px] font-semibold uppercase px-2.5 py-0.5 rounded-full border flex items-center space-x-1.5 ${
                taskStatus === 'running'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  : taskStatus === 'completed'
                  ? 'bg-sky-950/60 border-sky-500/40 text-sky-300'
                  : taskStatus === 'cancelled'
                  ? 'bg-slate-800 border-slate-700 text-slate-400'
                  : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
              }`}
            >
              {taskStatus === 'running' ? (
                <>
                  <RefreshCw className="w-3 h-3 animate-spin text-emerald-400" />
                  <span>Running ({elapsedSec}s)</span>
                </>
              ) : taskStatus === 'completed' ? (
                <>
                  <CheckCircle2 className="w-3 h-3 text-sky-400" />
                  <span>Success (Exit 0)</span>
                </>
              ) : taskStatus === 'cancelled' ? (
                <span>Cancelled</span>
              ) : (
                <>
                  <AlertCircle className="w-3 h-3 text-rose-400" />
                  <span>Failed ({exitCode ?? 1})</span>
                </>
              )}
            </span>

            {/* Stop Task Button (if running) */}
            {taskStatus === 'running' && (
              <button
                onClick={handleCancelTask}
                disabled={cancelling}
                className="px-2.5 py-1 text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white rounded transition-colors flex items-center space-x-1 disabled:opacity-50"
                title="Terminate process"
              >
                <Square className="w-3 h-3 fill-current" />
                <span className="hidden sm:inline">{cancelling ? 'Stopping...' : 'Cancel'}</span>
              </button>
            )}

            {/* Minimize / Maximize / Close Buttons */}
            <button
              onClick={() => minimizeTerminal()}
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
              title="Minimize to floating dock"
            >
              <Minimize2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => (isMaximized ? restoreTerminal() : maximizeTerminal())}
              className="p-1.5 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors"
              title={isMaximized ? 'Restore window size' : 'Maximize full screen'}
            >
              {isMaximized ? <Square className="w-3.5 h-3.5" /> : <Maximize2 className="w-4 h-4" />}
            </button>
            <button
              onClick={() => closeTerminal()}
              className="p-1.5 text-slate-400 hover:text-rose-400 rounded hover:bg-slate-800 transition-colors"
              title="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar & Filter Bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-slate-800/80 text-xs">
          <div className="flex items-center space-x-2 flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-500" />
            <input
              type="text"
              placeholder="Filter terminal output..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 text-xs text-slate-200 rounded px-2.5 py-1 focus:outline-none focus:border-sky-500 w-full font-mono placeholder:text-slate-600"
            />
            {searchFilter && (
              <button
                onClick={() => setSearchFilter('')}
                className="text-slate-500 hover:text-slate-300"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => setAutoScroll(!autoScroll)}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors flex items-center space-x-1 ${
                autoScroll
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
              title="Toggle automatic autoscroll to latest line"
            >
              <span>Auto-scroll</span>
              <span className={`w-1.5 h-1.5 rounded-full ${autoScroll ? 'bg-sky-400' : 'bg-slate-500'}`} />
            </button>

            <button
              onClick={handleCopyLogs}
              className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center space-x-1"
              title="Copy output to clipboard"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>

            <button
              onClick={handleDownloadLogs}
              className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center space-x-1"
              title="Download raw logs"
            >
              <Download className="w-3 h-3" />
              <span className="hidden sm:inline">Download</span>
            </button>

            <Link
              href="/terminal"
              onClick={() => closeTerminal()}
              className="px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors flex items-center space-x-1"
              title="Open in full dedicated Terminal page"
            >
              <span>Full Page</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* Terminal Log Output Window */}
        <div className="flex-1 bg-slate-950 p-4 font-mono text-xs overflow-y-auto space-y-1 selection:bg-sky-500 selection:text-white">
          {filteredLogs.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-2 py-12">
              {taskStatus === 'running' ? (
                <>
                  <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
                  <p>Streaming live process output...</p>
                </>
              ) : (
                <p>No terminal output recorded for this task.</p>
              )}
            </div>
          ) : (
            filteredLogs.map((line, idx) => {
              const isSystem = line.startsWith('⚙');
              const isStderr = line.startsWith('⚠');
              return (
                <div
                  key={idx}
                  className={`leading-relaxed whitespace-pre-wrap break-all ${
                    isSystem
                      ? 'text-cyan-400 font-semibold bg-cyan-950/20 px-1 rounded'
                      : isStderr
                      ? 'text-amber-400 bg-amber-950/20 px-1 rounded'
                      : 'text-slate-300 hover:bg-slate-900/60 px-1 rounded'
                  }`}
                >
                  {line}
                </div>
              );
            })
          )}
          <div ref={logsEndRef} />
        </div>

        {/* Terminal Footer */}
        <div className="px-4 py-2 bg-slate-900/80 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-500">
          <div className="flex items-center space-x-3">
            <span>Lines: {filteredLogs.length}</span>
            {currentTask && (
              <span>Command: <code className="text-slate-400">{currentTask.command} {currentTask.args.slice(0, 3).join(' ')}</code></span>
            )}
          </div>

          <div className="flex items-center space-x-4">
            <label className="flex items-center space-x-1.5 cursor-pointer text-slate-400 hover:text-slate-200">
              <input
                type="checkbox"
                checked={autoPopOnNewTask}
                onChange={(e) => setAutoPopOnNewTask(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-0 w-3 h-3 cursor-pointer"
              />
              <span>Auto-pop on run</span>
            </label>
            <span className="hidden sm:inline text-slate-600">Press [Esc] to minimize</span>
          </div>
        </div>
      </div>
    </div>
  );
}
