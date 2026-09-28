'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Server,
  Play,
  Square,
  RefreshCw,
  Cpu,
  Layers,
  CheckCircle2,
  AlertCircle,
  Terminal,
  PlusCircle,
  MinusCircle,
  Activity,
  Copy,
  Check,
  Download,
  X,
  Shield,
  ArrowRight,
  Settings,
  Zap,
  RotateCcw,
  Trash2,
  Wifi,
} from 'lucide-react';
import { copyToClipboard as copyText } from '@/lib/clipboard';

interface ClusterData {
  platform: string;
  isRunning: boolean;
  name: string;
  ingress: string;
  clusterIssuer: string;
  domain: string;
  telemetry?: {
    nodeCount: number;
    podCount: number;
    namespaceCount: number;
    ingressCount: number;
    nodes: Array<{ name: string; status: string; roles: string[]; age: string }>;
    namespaces: string[];
    ingresses: Array<{ name: string; namespace: string; host: string; class: string }>;
  };
}

export default function ClusterPage() {
  const [cluster, setCluster] = useState<ClusterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [scaling, setScaling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nodeMetrics, setNodeMetrics] = useState<Record<string, { cpu: string; memory: string }>>({});

  // K3s multi-node join & operations state
  const [showK3sModal, setShowK3sModal] = useState(false);
  const [k3sRole, setK3sRole] = useState<'agent' | 'server'>('agent');
  const [k3sServerUrl, setK3sServerUrl] = useState('');
  const [k3sToken, setK3sToken] = useState('');
  const [k3sNodeName, setK3sNodeName] = useState('');
  const [k3sNodeIp, setK3sNodeIp] = useState('');
  const [k3sLabels, setK3sLabels] = useState('');
  const [k3sSshHost, setK3sSshHost] = useState('');
  const [k3sSshPort, setK3sSshPort] = useState('22');
  const [k3sSshKey, setK3sSshKey] = useState('');
  const [k3sBatchTargets, setK3sBatchTargets] = useState('');
  const [k3sTargetsFile, setK3sTargetsFile] = useState('targets');
  const [k3sParallel, setK3sParallel] = useState('10');
  const [k3sTune, setK3sTune] = useState(true);
  const [k3sCopyRegistries, setK3sCopyRegistries] = useState(true);
  const [k3sCopyKubeconfig, setK3sCopyKubeconfig] = useState(false);
  const [k3sRegistriesFile, setK3sRegistriesFile] = useState('');
  const [k3sActiveTab, setK3sActiveTab] = useState<'command' | 'script' | 'ssh' | 'batch' | 'ops'>('command');
  const [k3sJoinInfo, setK3sJoinInfo] = useState<any>(null);
  const [k3sLoading, setK3sLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const fetchCluster = async () => {
    try {
      const res = await fetch('/api/cluster');
      const data = await res.json();
      setCluster(data);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  const fetchNodeMetrics = async () => {
    try {
      const res = await fetch('/api/k8s/metrics?type=node');
      const data = await res.json();
      if (data.nodes) {
        const map: Record<string, { cpu: string; memory: string }> = {};
        data.nodes.forEach((n: any) => {
          map[n.nodeName] = {
            cpu: n.cpuFormatted,
            memory: n.memoryFormatted,
          };
        });
        setNodeMetrics(map);
      }
    } catch {}
  };

  const handleScaleNodes = async (delta: number) => {
    setScaling(true);
    setMessage(null);
    try {
      const res = await fetch('/api/cluster/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scale_k3d',
          clusterName: cluster?.name || 'vigilant-octo-waffle',
          delta,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message || `Scaled cluster nodes by ${delta}`);
        fetchCluster();
      } else {
        setMessage(`Scaling notice: ${data.message || data.error}`);
      }
    } catch (err: any) {
      setMessage(`Scale error: ${err.message}`);
    } finally {
      setScaling(false);
    }
  };

  const openK3sModal = async () => {
    setShowK3sModal(true);
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s');
      const data = await res.json();
      setK3sJoinInfo(data);
      if (data.serverUrl) setK3sServerUrl(data.serverUrl);
      if (data.token) setK3sToken(data.token);
    } catch {} finally {
      setK3sLoading(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    await copyText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2500);
  };

  const handleSaveK3sScript = async () => {
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate-script',
          role: k3sRole,
          serverUrl: k3sServerUrl || undefined,
          token: k3sToken || undefined,
          nodeName: k3sNodeName || undefined,
          nodeIp: k3sNodeIp || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`K3s ${k3sRole} join script saved to ${data.relativePath}`);
      } else {
        setMessage(`Script generation error: ${data.error}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    }
  };

  const handleSshProvision = async () => {
    if (!k3sSshHost.trim()) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ssh-join',
          targetHost: k3sSshHost.trim(),
          port: Number(k3sSshPort) || 22,
          sshKey: k3sSshKey.trim() || undefined,
          role: k3sRole,
          serverUrl: k3sServerUrl || undefined,
          token: k3sToken || undefined,
          nodeName: k3sNodeName || undefined,
          nodeIp: k3sNodeIp || undefined,
          tune: k3sTune,
          copyRegistries: k3sCopyRegistries,
          copyKubeconfig: k3sCopyKubeconfig,
          registriesFile: k3sRegistriesFile.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`SSH provision dispatched for ${k3sSshHost} (Task ID: ${data.taskId})`);
        setShowK3sModal(false);
      } else {
        setMessage(`SSH provision error: ${data.error}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  const handleBatchJoin = async () => {
    setK3sLoading(true);
    try {
      const targetsList = k3sBatchTargets
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch-join',
          targetsFile: k3sTargetsFile.trim() || undefined,
          targets: targetsList.length > 0 ? targetsList : undefined,
          parallel: Number(k3sParallel) || 10,
          tune: k3sTune,
          copyRegistries: k3sCopyRegistries,
          copyKubeconfig: k3sCopyKubeconfig,
          registriesFile: k3sRegistriesFile.trim() || undefined,
          role: k3sRole,
          serverUrl: k3sServerUrl || undefined,
          token: k3sToken || undefined,
          sshKey: k3sSshKey.trim() || undefined,
          port: Number(k3sSshPort) || 22,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Batch join dispatched (Task ID: ${data.taskId})`);
        setShowK3sModal(false);
      } else {
        setMessage(`Batch join error: ${data.error}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  const handleK3sOp = async (op: 'ping' | 'tune' | 'kmod' | 'registries' | 'kill' | 'build' | 'rebuild') => {
    if (op === 'kill' && !confirm('WARNING: Are you sure you want to tear down K3s on these nodes?')) return;
    if (op === 'rebuild' && !confirm('WARNING: Full rebuild will teardown existing cluster and recreate all nodes. Proceed?')) return;
    setK3sLoading(true);
    try {
      const targetsList = k3sBatchTargets
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: op,
          targetsFile: k3sTargetsFile.trim() || undefined,
          targets: targetsList.length > 0 ? targetsList : undefined,
          remoteHost: k3sSshHost.trim() || undefined,
          port: Number(k3sSshPort) || 22,
          sshKey: k3sSshKey.trim() || undefined,
          parallel: Number(k3sParallel) || 10,
          all: true,
          copyKubeconfig: true,
          registriesFile: k3sRegistriesFile.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`K3s ${op} operation dispatched (Task ID: ${data.taskId})`);
        setShowK3sModal(false);
      } else {
        setMessage(`Operation error: ${data.error}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  useEffect(() => {
    fetchCluster();
    fetchNodeMetrics();
    const interval = setInterval(() => {
      fetchCluster();
      fetchNodeMetrics();
    }, 6000);
    return () => clearInterval(interval);
  }, []);


  const handleAction = async (action: 'start' | 'stop' | 'up') => {
    if (action === 'stop' && !confirm('Are you sure you want to delete the local cluster?')) return;
    setActionLoading(true);
    setMessage(null);
    try {
      let res;
      if (action === 'stop') {
        res = await fetch('/api/cluster', { method: 'DELETE' });
      } else {
        res = await fetch('/api/cluster', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
      }
      const data = await res.json();
      if (data.success) {
        setMessage(`Action '${action}' dispatched (Task ID: ${data.taskId})`);
      } else {
        setMessage(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Server className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Cluster Lifecycle Control</h2>
          </div>
          <p className="text-sm text-slate-400">
            Manage your local KinD, K3d, or K3s Kubernetes instances and node topology
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => handleAction('start')}
            disabled={actionLoading}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Create Cluster</span>
          </button>
          <button
            onClick={() => handleAction('stop')}
            disabled={actionLoading}
            className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors disabled:opacity-50"
          >
            <Square className="w-3.5 h-3.5 fill-white" />
            <span>Delete Cluster</span>
          </button>
          <Link
            href="/terminal"
            className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 flex items-center space-x-1.5 transition-colors"
          >
            <Terminal className="w-3.5 h-3.5 text-sky-400" />
            <span>Terminal</span>
          </Link>
        </div>
      </div>

      {message && (
        <div className="p-4 bg-sky-950/60 border border-sky-800 text-sky-300 text-sm rounded-lg flex items-center justify-between">
          <span>{message}</span>
          <Link href="/terminal" className="underline hover:text-white text-xs font-semibold">
            Follow Logs →
          </Link>
        </div>
      )}

      {/* Cluster Overview Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Runtime Platform</span>
          <div className="text-xl font-bold text-white uppercase flex items-center space-x-2">
            <span>{cluster?.platform || 'KinD'}</span>
            {cluster?.name ? <span className="text-xs font-mono font-normal text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/40">({cluster.name})</span> : null}
          </div>
          <p className="text-xs text-slate-400">
            {cluster?.platform === 'k3d' ? 'Rancher K3s in Docker' : cluster?.platform === 'kind' ? 'Kubernetes in Docker' : 'Lightweight Kubernetes'}
          </p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Ingress Controller</span>
          <div className="text-xl font-bold text-white capitalize">{cluster?.ingress || 'nginx'}</div>
          <p className="text-xs text-slate-400">Port 80/443 mapped to host localhost</p>
        </div>

        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Base Domain</span>
          <div className="text-xl font-bold text-white truncate">{cluster?.domain || 'example.com'}</div>
          <p className="text-xs text-slate-400">Configured in .env (THIS_DOMAIN)</p>
        </div>
      </div>

      {/* Live Nodes & Scaling Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <span>Cluster Nodes & Scaling Simulator</span>
            </h3>
            <p className="text-xs text-slate-400">
              Live nodes from Kubernetes API with dynamic K3d worker scaling and CPU/RAM load metrics
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => openK3sModal()}
              className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg flex items-center space-x-1.5 transition font-semibold cursor-pointer shadow-sm"
              title="Join an additional worker or control-plane server node to this K3s cluster"
            >
              <Server className="w-3.5 h-3.5" />
              <span>Join K3s Node</span>
            </button>
            {cluster?.platform === 'k3d' && (
              <>
                <button
                  onClick={() => handleScaleNodes(-1)}
                  disabled={scaling}
                  className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-rose-300 border border-slate-700 rounded-lg flex items-center space-x-1.5 disabled:opacity-40 transition cursor-pointer"
                  title="Scale down K3d worker agent node"
                >
                  <MinusCircle className="w-3.5 h-3.5 text-rose-400" />
                  <span>-1 Worker</span>
                </button>
                <button
                  onClick={() => handleScaleNodes(1)}
                  disabled={scaling}
                  className="text-xs px-2.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg flex items-center space-x-1.5 disabled:opacity-40 transition font-medium cursor-pointer"
                  title="Add simulated K3d worker agent node"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  <span>+1 Worker</span>
                </button>
              </>
            )}
            <span className="text-xs px-2.5 py-1.5 bg-slate-800 text-slate-300 rounded-md font-mono">
              {cluster?.telemetry?.nodes?.length || 0} Nodes
            </span>
          </div>
        </div>

        <div className="divide-y divide-slate-800/60">
          {cluster?.telemetry?.nodes && cluster.telemetry.nodes.length > 0 ? (
            cluster.telemetry.nodes.map((node) => {
              const metrics = nodeMetrics[node.name];

              return (
                <div key={node.name} className="p-4 flex items-center justify-between hover:bg-slate-800/30">
                  <div className="flex items-center space-x-3">
                    <Cpu className="w-5 h-5 text-sky-400" />
                    <div>
                      <div className="text-sm font-semibold text-slate-200">{node.name}</div>
                      <div className="text-xs text-slate-400 flex items-center space-x-2">
                        <span>Roles: {node.roles.join(', ')}</span>
                        {node.age && <span>• Age: {node.age}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-4">
                    {metrics && (
                      <div className="text-xs font-mono text-slate-400 flex items-center space-x-2 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
                        <Activity className="w-3 h-3 text-sky-400" />
                        <span>CPU: {metrics.cpu}</span>
                        <span className="text-slate-600">|</span>
                        <span>RAM: {metrics.memory}</span>
                      </div>
                    )}
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                        node.status === 'Ready'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                      }`}
                    >
                      {node.status}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-8 text-center text-sm text-slate-500">
              No nodes detected. The cluster may be stopped or not yet initialized.
            </div>
          )}
        </div>
      </div>

      {/* K3s Multi-Node Join Modal */}
      {showK3sModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-purple-600/20 border border-purple-500/30 flex items-center justify-center">
                  <Server className="w-4 h-4 text-purple-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Join Additional K3s Node</h3>
                  <p className="text-xs text-slate-400">
                    Add baremetal, VM, or cloud nodes into your K3s cluster
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowK3sModal(false)}
                className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Role Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Node Role</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setK3sRole('agent')}
                  className={`p-3 rounded-xl border text-left transition ${
                    k3sRole === 'agent'
                      ? 'bg-purple-950/40 border-purple-500 text-white shadow-sm'
                      : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <div className="text-xs font-bold text-purple-300">Worker Node (Agent)</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">Executes workloads and scheduled pods</div>
                </button>
                <button
                  type="button"
                  onClick={() => setK3sRole('server')}
                  className={`p-3 rounded-xl border text-left transition ${
                    k3sRole === 'server'
                      ? 'bg-purple-950/40 border-purple-500 text-white shadow-sm'
                      : 'bg-slate-800/40 border-slate-700/60 text-slate-400 hover:border-slate-600'
                  }`}
                >
                  <div className="text-xs font-bold text-purple-300">Control-Plane (Server)</div>
                  <div className="text-[11px] text-slate-400 mt-0.5">HA etcd server & API controller</div>
                </button>
              </div>
            </div>

            {/* Connection Parameters */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">K3s Server URL</label>
                <input
                  type="text"
                  value={k3sServerUrl}
                  onChange={(e) => setK3sServerUrl(e.target.value)}
                  placeholder="https://192.168.1.10:6443"
                  className="w-full text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Cluster Join Token</label>
                <div className="relative">
                  <input
                    type="password"
                    value={k3sToken}
                    onChange={(e) => setK3sToken(e.target.value)}
                    placeholder="K3s node token"
                    className="w-full text-xs font-mono bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 pr-8 text-white focus:outline-none focus:border-purple-500"
                  />
                  {k3sToken && (
                    <button
                      type="button"
                      onClick={() => copyToClipboard(k3sToken, 'token')}
                      className="absolute right-2 top-2 text-slate-400 hover:text-white"
                      title="Copy Token"
                    >
                      {copied === 'token' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Node Metadata (Optional) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Node Name (Optional)</label>
                <input
                  type="text"
                  value={k3sNodeName}
                  onChange={(e) => setK3sNodeName(e.target.value)}
                  placeholder="e.g. worker-edge-01"
                  className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Node IP (Optional)</label>
                <input
                  type="text"
                  value={k3sNodeIp}
                  onChange={(e) => setK3sNodeIp(e.target.value)}
                  placeholder="e.g. 192.168.1.50"
                  className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-400">Labels (Optional)</label>
                <input
                  type="text"
                  value={k3sLabels}
                  onChange={(e) => setK3sLabels(e.target.value)}
                  placeholder="role=worker,zone=edge"
                  className="w-full text-xs bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>

            {/* Join Method Tabs */}
            <div className="space-y-3">
              <div className="flex border-b border-slate-800 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setK3sActiveTab('command')}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                    k3sActiveTab === 'command'
                      ? 'border-purple-500 text-purple-300'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  One-Line Command
                </button>
                <button
                  type="button"
                  onClick={() => setK3sActiveTab('script')}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                    k3sActiveTab === 'script'
                      ? 'border-purple-500 text-purple-300'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Join Script (.sh)
                </button>
                <button
                  type="button"
                  onClick={() => setK3sActiveTab('ssh')}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                    k3sActiveTab === 'ssh'
                      ? 'border-purple-500 text-purple-300'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Remote SSH Join
                </button>
                <button
                  type="button"
                  onClick={() => setK3sActiveTab('batch')}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                    k3sActiveTab === 'batch'
                      ? 'border-purple-500 text-purple-300'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Batch Provision
                </button>
                <button
                  type="button"
                  onClick={() => setK3sActiveTab('ops')}
                  className={`px-3 py-2 text-xs font-semibold border-b-2 transition whitespace-nowrap ${
                    k3sActiveTab === 'ops'
                      ? 'border-purple-500 text-purple-300'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Cluster Operations
                </button>
              </div>

              {k3sActiveTab === 'command' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Run this command as root (or sudo) on the target machine:</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          `curl -sfL https://get.k3s.io | K3S_URL="${k3sServerUrl || 'https://<SERVER_IP>:6443'}" K3S_TOKEN="${k3sToken || '<TOKEN>'}" sh -s - ${k3sRole}${k3sNodeName ? ` --node-name ${k3sNodeName}` : ''}${k3sNodeIp ? ` --node-ip ${k3sNodeIp}` : ''}${k3sLabels ? ` ${k3sLabels.split(',').filter(Boolean).map((l) => `--node-label ${l.trim()}`).join(' ')}` : ''}`,
                          'oneliner'
                        )
                      }
                      className="text-purple-400 hover:text-purple-300 font-medium flex items-center space-x-1"
                    >
                      {copied === 'oneliner' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied === 'oneliner' ? 'Copied!' : 'Copy Command'}</span>
                    </button>
                  </div>
                  <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 whitespace-pre-wrap break-all leading-relaxed">
                    {`curl -sfL https://get.k3s.io | K3S_URL="${k3sServerUrl || 'https://<SERVER_IP>:6443'}" K3S_TOKEN="${k3sToken || '<TOKEN>'}" sh -s - ${k3sRole}${k3sNodeName ? ` --node-name ${k3sNodeName}` : ''}${k3sNodeIp ? ` --node-ip ${k3sNodeIp}` : ''}${k3sLabels ? ` ${k3sLabels.split(',').filter(Boolean).map((l) => `--node-label ${l.trim()}`).join(' ')}` : ''}`}
                  </pre>
                </div>
              )}

              {k3sActiveTab === 'script' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Generated standalone bash script for the target node:</span>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={handleSaveK3sScript}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-purple-300 rounded text-xs font-medium flex items-center space-x-1 border border-slate-700"
                      >
                        <Download className="w-3 h-3" />
                        <span>Save to .secrets/</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            `#!/usr/bin/env bash\nset -euo pipefail\nexport K3S_URL="${k3sServerUrl || 'https://<SERVER_IP>:6443'}"\nexport K3S_TOKEN="${k3sToken || '<TOKEN>'}"\necho "==> Joining K3s cluster at \${K3S_URL} as ${k3sRole}..."\ncurl -sfL https://get.k3s.io | sh -s - ${k3sRole}${k3sNodeName ? ` --node-name ${k3sNodeName}` : ''}${k3sNodeIp ? ` --node-ip ${k3sNodeIp}` : ''}${k3sLabels ? ` ${k3sLabels.split(',').filter(Boolean).map((l) => `--node-label ${l.trim()}`).join(' ')}` : ''}\necho "==> Node successfully joined!"`,
                            'script'
                          )
                        }
                        className="text-purple-400 hover:text-purple-300 font-medium flex items-center space-x-1"
                      >
                        {copied === 'script' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied === 'script' ? 'Copied!' : 'Copy Script'}</span>
                      </button>
                    </div>
                  </div>
                  <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
{`#!/usr/bin/env bash
set -euo pipefail

export K3S_URL="${k3sServerUrl || 'https://<SERVER_IP>:6443'}"
export K3S_TOKEN="${k3sToken || '<TOKEN>'}"

echo "==> Joining K3s cluster at \${K3S_URL} as ${k3sRole}..."
curl -sfL https://get.k3s.io | sh -s - ${k3sRole}${k3sNodeName ? ` --node-name ${k3sNodeName}` : ''}${k3sNodeIp ? ` --node-ip ${k3sNodeIp}` : ''}${k3sLabels ? ` ${k3sLabels.split(',').filter(Boolean).map((l) => `--node-label ${l.trim()}`).join(' ')}` : ''}

echo "==> Node successfully joined!"`}
                  </pre>
                </div>
              )}

              {k3sActiveTab === 'ssh' && (
                <div className="space-y-3 p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-400">
                    Remotely execute the join sequence on a target machine over SSH with sudo privileges:
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-300">Target Host (user@ip)</label>
                      <input
                        type="text"
                        value={k3sSshHost}
                        onChange={(e) => setK3sSshHost(e.target.value)}
                        placeholder="ubuntu@192.168.1.50"
                        className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">SSH Port</label>
                      <input
                        type="text"
                        value={k3sSshPort}
                        onChange={(e) => setK3sSshPort(e.target.value)}
                        placeholder="22"
                        className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">SSH Key Path (Optional)</label>
                    <input
                      type="text"
                      value={k3sSshKey}
                      onChange={(e) => setK3sSshKey(e.target.value)}
                      placeholder="~/.ssh/id_rsa (defaults to standard SSH agent/keys)"
                      className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-300 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-800">
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={k3sTune}
                        onChange={(e) => setK3sTune(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0"
                      />
                      <span>Tune NVMe & Limits</span>
                    </label>
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={k3sCopyRegistries}
                        onChange={(e) => setK3sCopyRegistries(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0"
                      />
                      <span>Deploy Registries</span>
                    </label>
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={k3sCopyKubeconfig}
                        onChange={(e) => setK3sCopyKubeconfig(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0"
                      />
                      <span>Copy Kubeconfig</span>
                    </label>
                  </div>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleSshProvision}
                      disabled={!k3sSshHost.trim() || k3sLoading}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-40 cursor-pointer"
                    >
                      <Server className="w-3.5 h-3.5" />
                      <span>{k3sLoading ? 'Provisioning...' : 'Provision Remote Node'}</span>
                    </button>
                  </div>
                </div>
              )}

              {k3sActiveTab === 'batch' && (
                <div className="space-y-4 p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-400">
                    Batch provision and join multiple nodes in parallel using a targets file or direct host list:
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">Targets File Path</label>
                      <input
                        type="text"
                        value={k3sTargetsFile}
                        onChange={(e) => setK3sTargetsFile(e.target.value)}
                        placeholder="targets or targets.txt"
                        className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">Parallel Jobs (-j)</label>
                      <input
                        type="number"
                        value={k3sParallel}
                        onChange={(e) => setK3sParallel(e.target.value)}
                        min="1"
                        max="100"
                        placeholder="10"
                        className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Or Direct Targets List (one host/IP per line)</label>
                    <textarea
                      value={k3sBatchTargets}
                      onChange={(e) => setK3sBatchTargets(e.target.value)}
                      rows={3}
                      placeholder="root@192.168.1.50&#10;root@192.168.1.51&#10;192.168.1.52"
                      className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-800">
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={k3sTune}
                        onChange={(e) => setK3sTune(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0"
                      />
                      <span>Auto-tune NVMe & Limits</span>
                    </label>
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={k3sCopyRegistries}
                        onChange={(e) => setK3sCopyRegistries(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0"
                      />
                      <span>Deploy Registries</span>
                    </label>
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={k3sCopyKubeconfig}
                        onChange={(e) => setK3sCopyKubeconfig(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0"
                      />
                      <span>Sync Kubeconfig</span>
                    </label>
                  </div>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleBatchJoin}
                      disabled={k3sLoading}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-40 cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>{k3sLoading ? 'Provisioning...' : 'Provision All Targets'}</span>
                    </button>
                  </div>
                </div>
              )}

              {k3sActiveTab === 'ops' && (
                <div className="space-y-4 p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-400">
                    Execute direct cluster maintenance, health diagnostics, and rebuilding operations:
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                      <div className="flex items-center space-x-2">
                        <Wifi className="w-4 h-4 text-emerald-400" />
                        <h4 className="text-xs font-bold text-white">Ping & Health Diagnostic</h4>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Check node SSH reachability, hostname, uptime, and advertised IP addresses.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleK3sOp('ping')}
                        disabled={k3sLoading}
                        className="w-full mt-2 py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition cursor-pointer"
                      >
                        <Wifi className="w-3.5 h-3.5" />
                        <span>Run Ping Diagnostic</span>
                      </button>
                    </div>

                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                      <div className="flex items-center space-x-2">
                        <Zap className="w-4 h-4 text-amber-400" />
                        <h4 className="text-xs font-bold text-white">Tune Kernel & Limits</h4>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Persist NVMe-oF modules (nvme_tcp) and file descriptor/inotify sysctl limits.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleK3sOp('tune')}
                        disabled={k3sLoading}
                        className="w-full mt-2 py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition cursor-pointer"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Apply Kernel & Limits</span>
                      </button>
                    </div>

                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                      <div className="flex items-center space-x-2">
                        <Layers className="w-4 h-4 text-sky-400" />
                        <h4 className="text-xs font-bold text-white">Registry Mirrors</h4>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Distribute registries.yaml and copy kubeconfig across cluster nodes.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleK3sOp('registries')}
                        disabled={k3sLoading}
                        className="w-full mt-2 py-1.5 px-3 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 rounded-lg text-xs font-medium flex items-center justify-center space-x-1.5 transition cursor-pointer"
                      >
                        <Layers className="w-3.5 h-3.5" />
                        <span>Deploy Registries Config</span>
                      </button>
                    </div>

                    <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                      <div className="flex items-center space-x-2">
                        <RotateCcw className="w-4 h-4 text-purple-400" />
                        <h4 className="text-xs font-bold text-white">Vanilla Cluster Rebuild</h4>
                      </div>
                      <p className="text-[11px] text-slate-400">
                        Complete teardown, tune, registry deploy, server init, and parallel worker join.
                      </p>
                      <button
                        type="button"
                        onClick={() => handleK3sOp('rebuild')}
                        disabled={k3sLoading}
                        className="w-full mt-2 py-1.5 px-3 bg-purple-900/40 hover:bg-purple-800/60 text-purple-300 border border-purple-700 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Trigger Full Rebuild</span>
                      </button>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-[11px] text-rose-400">Destructive Actions:</span>
                    <button
                      type="button"
                      onClick={() => handleK3sOp('kill')}
                      disabled={k3sLoading}
                      className="py-1.5 px-3 bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 border border-rose-800/80 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Teardown Cluster (k3s-uninstall)</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 flex justify-between items-center text-xs text-slate-500 border-t border-slate-800">
              <span>CLI alternative: <code className="text-purple-300 bg-slate-950 px-1.5 py-0.5 rounded">./src/k3s_add_node.sh --role {k3sRole}</code></span>
              <button
                type="button"
                onClick={() => setShowK3sModal(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition font-medium"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
