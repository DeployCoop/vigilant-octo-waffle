'use client';

import { useState, useEffect, useRef } from 'react';
import {
  Boxes,
  RefreshCw,
  Search,
  Terminal,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Server,
  X,
  FileText,
  Code,
  Send,
  Trash2,
} from 'lucide-react';

interface ContainerInfo {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
}

interface PodInfo {
  name: string;
  namespace: string;
  status: string;
  ready: string;
  restarts: number;
  node: string;
  ip: string;
  age: string;
  containers: ContainerInfo[];
}

export default function PodsPage() {
  const [pods, setPods] = useState<PodInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedNamespace, setSelectedNamespace] = useState('all');
  const [search, setSearch] = useState('');

  // Log viewer state
  const [activeLogPod, setActiveLogPod] = useState<PodInfo | null>(null);
  const [selectedLogContainer, setSelectedLogContainer] = useState<string>('');
  const [tailLines, setTailLines] = useState<number>(200);
  const [logs, setLogs] = useState<string>('');
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Exec shell state
  const [activeExecPod, setActiveExecPod] = useState<PodInfo | null>(null);
  const [selectedExecContainer, setSelectedExecContainer] = useState<string>('');
  const [execSessionId, setExecSessionId] = useState<string | null>(null);
  const [terminalOutput, setTerminalOutput] = useState<string>('');
  const [commandInput, setCommandInput] = useState<string>('');
  const [connectingExec, setConnectingExec] = useState(false);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchPods = async () => {
    setLoading(true);
    try {
      const url =
        selectedNamespace === 'all'
          ? '/api/k8s/pods'
          : `/api/k8s/pods?namespace=${encodeURIComponent(selectedNamespace)}`;
      const res = await fetch(url);
      const data = await res.json();
      setPods(data.pods || []);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPods();
  }, [selectedNamespace]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalOutput]);

  const namespaces = Array.from(new Set(pods.map((p) => p.namespace))).sort();

  const filteredPods = pods.filter((pod) => {
    const matchesSearch =
      pod.name.toLowerCase().includes(search.toLowerCase()) ||
      pod.node.toLowerCase().includes(search.toLowerCase()) ||
      pod.status.toLowerCase().includes(search.toLowerCase());
    return matchesSearch;
  });

  // Log handling
  const openLogViewer = (pod: PodInfo) => {
    setActiveLogPod(pod);
    const firstContainer = pod.containers[0]?.name || '';
    setSelectedLogContainer(firstContainer);
    fetchLogs(pod.namespace, pod.name, firstContainer, tailLines);
  };

  const fetchLogs = async (namespace: string, name: string, container: string, tail: number) => {
    setLoadingLogs(true);
    try {
      const q = new URLSearchParams({
        namespace,
        pod: name,
        tailLines: String(tail),
      });
      if (container) q.set('container', container);

      const res = await fetch(`/api/k8s/logs?${q.toString()}`);
      const data = await res.json();
      setLogs(data.logs || 'No logs returned from pod.');
    } catch (err: any) {
      setLogs(`Error loading logs: ${err.message}`);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Interactive Exec Shell handling
  const openExecShell = async (pod: PodInfo) => {
    setActiveExecPod(pod);
    const firstContainer = pod.containers[0]?.name || '';
    setSelectedExecContainer(firstContainer);
    setTerminalOutput(`Connecting interactive shell to pod ${pod.name} (${pod.namespace})...\n`);
    startExecSession(pod.namespace, pod.name, firstContainer);
  };

  const startExecSession = async (namespace: string, podName: string, containerName: string) => {
    setConnectingExec(true);
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const res = await fetch('/api/k8s/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start',
          namespace,
          podName,
          containerName,
        }),
      });
      const data = await res.json();
      if (!data.sessionId) throw new Error(data.error || 'Failed starting session');

      setExecSessionId(data.sessionId);
      setTerminalOutput((prev) => prev + `Connected! Session ID: ${data.sessionId}\n$ `);

      const es = new EventSource(`/api/k8s/exec?sessionId=${data.sessionId}`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'output' && payload.data) {
            setTerminalOutput((prev) => prev + payload.data);
          } else if (payload.type === 'close') {
            setTerminalOutput((prev) => prev + `\n[Process exited with code ${payload.code}]\n`);
            es.close();
          }
        } catch {
          // ignore
        }
      };

      es.onerror = () => {
        es.close();
      };
    } catch (err: any) {
      setTerminalOutput((prev) => prev + `Failed to start exec: ${err.message}\n`);
    } finally {
      setConnectingExec(false);
    }
  };

  const sendExecCommand = async (cmdToSend?: string) => {
    const text = cmdToSend !== undefined ? cmdToSend : commandInput;
    if (!execSessionId || !text) return;

    try {
      await fetch('/api/k8s/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'input',
          sessionId: execSessionId,
          data: `${text}\n`,
        }),
      });
      if (cmdToSend === undefined) {
        setCommandInput('');
      }
    } catch (err: any) {
      setTerminalOutput((prev) => prev + `\nSend error: ${err.message}\n`);
    }
  };

  const closeExecShell = () => {
    if (execSessionId) {
      fetch('/api/k8s/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', sessionId: execSessionId }),
      }).catch(() => {});
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    setActiveExecPod(null);
    setExecSessionId(null);
    setTerminalOutput('');
  };

  const runningCount = pods.filter((p) => p.status === 'Running').length;
  const failingCount = pods.filter((p) => p.status !== 'Running' && p.status !== 'Completed').length;
  const restartCount = pods.reduce((acc, p) => acc + p.restarts, 0);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Boxes className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Kubernetes Pod Explorer & Terminal Shell</h2>
          </div>
          <p className="text-sm text-slate-400">
            Real-time inspection of workloads, containers, restart diagnostics, stdout/stderr logs, and in-browser interactive exec shell
          </p>
        </div>

        <button
          onClick={fetchPods}
          disabled={loading}
          className="text-xs px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg flex items-center space-x-2 self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Pods</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Total Pods</div>
          <div className="text-2xl font-bold text-white">{pods.length}</div>
        </div>
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Running Healthy</div>
          <div className="text-2xl font-bold text-emerald-400">{runningCount}</div>
        </div>
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Warning / Pending</div>
          <div className={`text-2xl font-bold ${failingCount > 0 ? 'text-amber-400' : 'text-slate-500'}`}>
            {failingCount}
          </div>
        </div>
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Total Restarts</div>
          <div className={`text-2xl font-bold ${restartCount > 0 ? 'text-rose-400' : 'text-slate-500'}`}>
            {restartCount}
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search pod name, status, or node..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
          />
        </div>

        <select
          value={selectedNamespace}
          onChange={(e) => setSelectedNamespace(e.target.value)}
          className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500"
        >
          <option value="all">All Namespaces</option>
          {namespaces.map((ns) => (
            <option key={ns} value={ns}>
              Namespace: {ns}
            </option>
          ))}
        </select>
      </div>

      {/* Pods Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-5 py-3 font-semibold">Pod Name</th>
                <th className="px-5 py-3 font-semibold">Namespace</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Ready</th>
                <th className="px-5 py-3 font-semibold">Restarts</th>
                <th className="px-5 py-3 font-semibold">Node</th>
                <th className="px-5 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {filteredPods.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                    No pods found matching query.
                  </td>
                </tr>
              ) : (
                filteredPods.map((pod) => {
                  const isRunning = pod.status === 'Running';
                  const isCompleted = pod.status === 'Completed';

                  return (
                    <tr key={`${pod.namespace}/${pod.name}`} className="hover:bg-slate-800/40 transition-colors">
                      <td className="px-5 py-3.5 font-bold text-slate-200">
                        <div className="truncate max-w-xs">{pod.name}</div>
                      </td>
                      <td className="px-5 py-3.5 text-slate-400">
                        <span className="bg-slate-800 px-2 py-0.5 rounded text-[11px]">{pod.namespace}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                            isRunning
                              ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/50'
                              : isCompleted
                              ? 'bg-blue-950/80 text-blue-400 border border-blue-800/50'
                              : 'bg-rose-950/80 text-rose-400 border border-rose-800/50'
                          }`}
                        >
                          {pod.status}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-300">{pod.ready}</td>
                      <td className="px-5 py-3.5">
                        <span className={pod.restarts > 0 ? 'text-amber-400 font-bold' : 'text-slate-500'}>
                          {pod.restarts}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-400 truncate max-w-[120px]">{pod.node}</td>
                      <td className="px-5 py-3.5 text-right font-sans">
                        <div className="inline-flex items-center space-x-1.5">
                          <button
                            onClick={() => openLogViewer(pod)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-sky-600 hover:text-white text-slate-300 border border-slate-700 rounded transition-colors text-xs inline-flex items-center space-x-1"
                            title="View Pod Stdout/Stderr Logs"
                          >
                            <Terminal className="w-3 h-3" />
                            <span>Logs</span>
                          </button>
                          <button
                            onClick={() => openExecShell(pod)}
                            disabled={!isRunning}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-indigo-600 hover:text-white text-slate-300 border border-slate-700 rounded transition-colors text-xs inline-flex items-center space-x-1 disabled:opacity-40"
                            title={isRunning ? 'Open Interactive Shell in Container' : 'Pod must be Running to exec'}
                          >
                            <Code className="w-3 h-3" />
                            <span>Exec</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log Viewer Modal Drawer */}
      {activeLogPod && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <FileText className="w-5 h-5 text-sky-400" />
                <div>
                  <h3 className="text-sm font-bold text-white font-mono">{activeLogPod.name}</h3>
                  <p className="text-xs text-slate-400">Namespace: {activeLogPod.namespace}</p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {activeLogPod.containers.length > 1 && (
                  <select
                    value={selectedLogContainer}
                    onChange={(e) => {
                      setSelectedLogContainer(e.target.value);
                      fetchLogs(activeLogPod.namespace, activeLogPod.name, e.target.value, tailLines);
                    }}
                    className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200"
                  >
                    {activeLogPod.containers.map((c) => (
                      <option key={c.name} value={c.name}>
                        Container: {c.name}
                      </option>
                    ))}
                  </select>
                )}

                <select
                  value={tailLines}
                  onChange={(e) => {
                    const lines = Number(e.target.value);
                    setTailLines(lines);
                    fetchLogs(activeLogPod.namespace, activeLogPod.name, selectedLogContainer, lines);
                  }}
                  className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200"
                >
                  <option value={100}>Tail 100</option>
                  <option value={250}>Tail 250</option>
                  <option value={500}>Tail 500</option>
                  <option value={1000}>Tail 1000</option>
                </select>

                <button
                  onClick={() => fetchLogs(activeLogPod.namespace, activeLogPod.name, selectedLogContainer, tailLines)}
                  disabled={loadingLogs}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700"
                  title="Refresh logs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingLogs ? 'animate-spin' : ''}`} />
                </button>

                <button
                  onClick={() => setActiveLogPod(null)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded border border-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Log Terminal Body */}
            <div className="flex-1 p-4 bg-black overflow-auto font-mono text-xs text-slate-300 leading-relaxed whitespace-pre-wrap select-text">
              {loadingLogs ? (
                <div className="flex items-center space-x-2 text-slate-500">
                  <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                  <span>Streaming logs from API server...</span>
                </div>
              ) : (
                logs
              )}
            </div>
          </div>
        </div>
      )}

      {/* Interactive Container Exec Shell Modal Drawer */}
      {activeExecPod && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-xl w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Exec Header */}
            <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <Code className="w-5 h-5 text-indigo-400" />
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-bold text-white font-mono">{activeExecPod.name}</h3>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/40">
                      kubectl exec
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">Namespace: {activeExecPod.namespace}</p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {activeExecPod.containers.length > 1 && (
                  <select
                    value={selectedExecContainer}
                    onChange={(e) => {
                      setSelectedExecContainer(e.target.value);
                      startExecSession(activeExecPod.namespace, activeExecPod.name, e.target.value);
                    }}
                    className="px-2.5 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200"
                  >
                    {activeExecPod.containers.map((c) => (
                      <option key={c.name} value={c.name}>
                        Container: {c.name}
                      </option>
                    ))}
                  </select>
                )}

                <button
                  onClick={() => setTerminalOutput('')}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded border border-slate-700"
                  title="Clear terminal screen"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <button
                  onClick={closeExecShell}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded border border-slate-700"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Quick Command Bar */}
            <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-800/80 flex items-center space-x-2 overflow-x-auto text-xs">
              <span className="text-slate-500 text-[11px] shrink-0">Quick Commands:</span>
              {['ls -la', 'ps aux', 'df -h', 'cat /etc/os-release', 'env'].map((cmd) => (
                <button
                  key={cmd}
                  onClick={() => sendExecCommand(cmd)}
                  className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-[11px] rounded border border-slate-700 shrink-0 transition-colors"
                >
                  {cmd}
                </button>
              ))}
            </div>

            {/* Terminal Window */}
            <div className="flex-1 p-4 bg-black overflow-auto font-mono text-xs text-emerald-400 leading-relaxed whitespace-pre-wrap select-text">
              {connectingExec && (
                <div className="flex items-center space-x-2 text-slate-500 mb-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Spawning interactive shell session...</span>
                </div>
              )}
              {terminalOutput}
              <div ref={terminalEndRef} />
            </div>

            {/* Interactive Input Bar */}
            <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center space-x-2">
              <span className="font-mono text-xs text-slate-500 pl-2">$</span>
              <input
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    sendExecCommand();
                  }
                }}
                placeholder="Type command and press Enter (e.g. ls, uname -a, ps)..."
                className="flex-1 px-3 py-1.5 bg-black border border-slate-800 rounded font-mono text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                autoFocus
              />
              <button
                onClick={() => sendExecCommand()}
                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-xs font-semibold flex items-center space-x-1 transition-colors"
              >
                <Send className="w-3 h-3" />
                <span>Run</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
