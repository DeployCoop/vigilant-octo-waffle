'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Server,
  Play,
  Square,
  ShieldCheck,
  Terminal,
  ExternalLink,
  Layers,
  Key,
  Globe,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface ClusterInfo {
  platform: string;
  isRunning: boolean;
  ingress: string;
  clusterIssuer: string;
  domain: string;
  activeTasks: number;
  telemetry?: {
    nodeCount: number;
    podCount: number;
    ingressCount: number;
    nodes: any[];
  };
}

interface AppItem {
  id: string;
  name: string;
  category: string;
  enabled: boolean;
  ingressUrl?: string;
  subdomain?: string;
}

export default function DashboardPage() {
  const [cluster, setCluster] = useState<ClusterInfo | null>(null);
  const [apps, setApps] = useState<AppItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      const [clusterRes, appsRes] = await Promise.all([
        fetch('/api/cluster'),
        fetch('/api/apps'),
      ]);
      const clusterData = await clusterRes.json();
      const appsData = await appsRes.json();
      setCluster(clusterData);
      setApps(appsData.apps || []);
    } catch {
      // offline or server error
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleRunUp = async () => {
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'up' }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Started full deployment (Task ID: ${data.taskId})`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartCluster = async () => {
    setActionLoading(true);
    try {
      const res = await fetch('/api/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Cluster creation started (Task ID: ${data.taskId})`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopCluster = async () => {
    if (!confirm('Are you sure you want to stop/delete the local cluster?')) return;
    setActionLoading(true);
    try {
      const res = await fetch('/api/cluster', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setMessage(`Cluster deletion task started (Task ID: ${data.taskId})`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const enabledApps = apps.filter((a) => a.enabled);
  const activeIngresses = apps.filter((a) => a.enabled && a.ingressUrl);

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="text-xl">🐙</span>
            <h2 className="text-xl font-bold text-white tracking-tight">Vigilant Octo Waffle Hub</h2>
          </div>
          <p className="text-sm text-slate-400">
            Local Kubernetes (KinD / K3d / K3s) + ArgoCD GitOps + mkcert TLS environment
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={fetchData}
            className="p-2 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-lg transition-colors"
            title="Refresh status"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={handleRunUp}
            disabled={actionLoading}
            className="px-4 py-2 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white text-sm font-semibold rounded-lg shadow-sm flex items-center space-x-2 transition-all disabled:opacity-50"
          >
            <Play className="w-4 h-4 fill-white" />
            <span>Run Full Deployment (./up)</span>
          </button>
          <Link
            href="/terminal"
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium rounded-lg border border-slate-700 flex items-center space-x-2 transition-colors"
          >
            <Terminal className="w-4 h-4 text-sky-400" />
            <span>Live Terminal</span>
          </Link>
        </div>
      </div>

      {message && (
        <div className="p-4 bg-sky-950/60 border border-sky-800 text-sky-300 text-sm rounded-lg flex items-center justify-between">
          <span>{message}</span>
          <Link href="/terminal" className="underline hover:text-white text-xs font-semibold">
            View in Terminal →
          </Link>
        </div>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Cluster Status */}
        <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Cluster State</span>
            <Server className="w-4 h-4 text-sky-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-white capitalize">
              {cluster?.platform || 'KinD'}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                cluster?.isRunning
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              }`}
            >
              {cluster?.isRunning ? 'Running' : 'Stopped / Standby'}
            </span>
          </div>
          <p className="text-xs text-slate-400">
            {cluster?.telemetry?.nodeCount || 0} Nodes · {cluster?.telemetry?.podCount || 0} Pods
          </p>
        </div>

        {/* Enabled Services */}
        <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Enabled Services</span>
            <Layers className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-white">{enabledApps.length}</span>
            <span className="text-xs text-slate-400">of {apps.length} available</span>
          </div>
          <p className="text-xs text-slate-400">Configured in .env.enabler</p>
        </div>

        {/* Ingress & Domain */}
        <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Domain & Ingress</span>
            <Globe className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-xl font-bold text-white truncate">{cluster?.domain || 'example.com'}</span>
          </div>
          <p className="text-xs text-slate-400">
            Provider: <span className="text-slate-300 capitalize">{cluster?.ingress || 'nginx'}</span>
          </p>
        </div>

        {/* TLS & Issuer */}
        <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">TLS Issuer</span>
            <ShieldCheck className="w-4 h-4 text-violet-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-xl font-bold text-white truncate">
              {cluster?.clusterIssuer || 'mkcert-issuer'}
            </span>
          </div>
          <p className="text-xs text-slate-400">cert-manager automated local CA</p>
        </div>
      </div>

      {/* Quick Action Strip & Ingress Applications */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Active Service Endpoints</h3>
            <p className="text-xs text-slate-400">
              Access your local applications over trusted TLS with custom subdomains
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleStartCluster}
              disabled={actionLoading}
              className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-md transition-colors flex items-center space-x-1.5"
            >
              <Play className="w-3 h-3 text-emerald-400" />
              <span>Create Cluster</span>
            </button>
            <button
              onClick={handleStopCluster}
              disabled={actionLoading}
              className="text-xs px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 border border-rose-800/40 rounded-md transition-colors flex items-center space-x-1.5"
            >
              <Square className="w-3 h-3 text-rose-400" />
              <span>Delete Cluster</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {activeIngresses.map((app) => (
            <div
              key={app.id}
              className="p-4 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl flex items-center justify-between transition-colors group"
            >
              <div className="space-y-1 min-w-0 pr-3">
                <div className="flex items-center space-x-2">
                  <span className="font-semibold text-sm text-slate-200 group-hover:text-sky-400 transition-colors truncate">
                    {app.name}
                  </span>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">
                    {app.category.split('&')[0]}
                  </span>
                </div>
                <p className="text-xs text-slate-400 truncate">{app.ingressUrl}</p>
              </div>

              <a
                href={app.ingressUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="p-2 bg-slate-800 hover:bg-sky-500 hover:text-white text-slate-300 rounded-lg transition-colors shrink-0"
                title={`Open ${app.name} in browser`}
              >
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
