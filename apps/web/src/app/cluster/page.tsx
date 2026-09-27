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
} from 'lucide-react';

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

    </div>
  );
}
