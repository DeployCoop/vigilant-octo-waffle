'use client';

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';

export interface TaskSummary {
  id: string;
  command: string;
  args: string[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  exitCode?: number | null;
  startedAt: string;
  finishedAt?: string | null;
  logCount: number;
}

interface TerminalContextType {
  isOpen: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  activeTaskId: string | null;
  activeTaskTitle: string | null;
  tasks: TaskSummary[];
  runningTaskCount: number;
  autoPopOnNewTask: boolean;
  openTerminal: (taskId: string, title?: string) => void;
  closeTerminal: () => void;
  minimizeTerminal: () => void;
  maximizeTerminal: () => void;
  restoreTerminal: () => void;
  setAutoPopOnNewTask: (enabled: boolean) => void;
}

const TerminalContext = createContext<TerminalContextType | undefined>(undefined);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskTitle, setActiveTaskTitle] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [autoPopOnNewTask, setAutoPopOnNewTaskState] = useState<boolean>(true);

  // Track task IDs we've already seen so we only auto-pop on genuinely new running tasks
  const seenTaskIdsRef = useRef<Set<string>>(new Set());
  const initialLoadRef = useRef(true);

  // Load user preference for auto-pop
  useEffect(() => {
    try {
      const stored = localStorage.getItem('vow_terminal_autopop');
      if (stored !== null) {
        setAutoPopOnNewTaskState(stored === 'true');
      }
    } catch {}
  }, []);

  const setAutoPopOnNewTask = (enabled: boolean) => {
    setAutoPopOnNewTaskState(enabled);
    try {
      localStorage.setItem('vow_terminal_autopop', String(enabled));
    } catch {}
  };

  const openTerminal = useCallback((taskId: string, title?: string) => {
    setActiveTaskId(taskId);
    if (title) {
      setActiveTaskTitle(title);
    }
    setIsOpen(true);
    setIsMinimized(false);
  }, []);

  const closeTerminal = useCallback(() => {
    setIsOpen(false);
    setIsMinimized(false);
    setIsMaximized(false);
  }, []);

  const minimizeTerminal = useCallback(() => {
    setIsMinimized(true);
  }, []);

  const maximizeTerminal = useCallback(() => {
    setIsMaximized(true);
    setIsMinimized(false);
  }, []);

  const restoreTerminal = useCallback(() => {
    setIsMinimized(false);
    setIsMaximized(false);
  }, []);

  // Poll for background task updates & auto-pop on new tasks
  const pollTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks');
      if (!res.ok) return;
      const data = await res.json();
      const list: TaskSummary[] = data.tasks || [];
      setTasks(list);

      // On initial load, record all existing task IDs so we don't spam-pop past tasks
      if (initialLoadRef.current) {
        for (const t of list) {
          seenTaskIdsRef.current.add(t.id);
        }
        initialLoadRef.current = false;
        return;
      }

      // Check for newly spawned running tasks
      if (autoPopOnNewTask) {
        for (const t of list) {
          if (!seenTaskIdsRef.current.has(t.id)) {
            seenTaskIdsRef.current.add(t.id);
            if (t.status === 'running') {
              const cmdLabel = `${t.command} ${t.args.slice(0, 2).join(' ')}`.trim();
              openTerminal(t.id, cmdLabel || 'Process Execution');
              break;
            }
          }
        }
      }
    } catch {
      // offline / transient
    }
  }, [autoPopOnNewTask, openTerminal]);

  useEffect(() => {
    pollTasks();
    const interval = setInterval(pollTasks, 2500);
    return () => clearInterval(interval);
  }, [pollTasks]);

  // Global custom event listener so any fetch or helper can trigger the terminal
  useEffect(() => {
    const handleCustomEvent = (e: Event) => {
      const custom = e as CustomEvent<{ taskId: string; title?: string }>;
      if (custom.detail?.taskId) {
        openTerminal(custom.detail.taskId, custom.detail.title);
      }
    };

    window.addEventListener('vow:open-terminal', handleCustomEvent);
    return () => window.removeEventListener('vow:open-terminal', handleCustomEvent);
  }, [openTerminal]);

  const runningTaskCount = tasks.filter((t) => t.status === 'running').length;

  return (
    <TerminalContext.Provider
      value={{
        isOpen,
        isMinimized,
        isMaximized,
        activeTaskId,
        activeTaskTitle,
        tasks,
        runningTaskCount,
        autoPopOnNewTask,
        openTerminal,
        closeTerminal,
        minimizeTerminal,
        maximizeTerminal,
        restoreTerminal,
        setAutoPopOnNewTask,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider');
  }
  return context;
}

/**
 * Global helper to trigger terminal pop-out from anywhere (even outside React hooks)
 */
export function dispatchOpenTerminal(taskId: string, title?: string) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('vow:open-terminal', {
        detail: { taskId, title },
      })
    );
  }
}
