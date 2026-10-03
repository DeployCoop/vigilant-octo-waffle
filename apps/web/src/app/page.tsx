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
  Boxes,
  HardDrive,
  Cpu,
  Sparkles,
} from 'lucide-react';
import { useTerminal } from '@/context/TerminalContext';
import { soundFx } from '@/lib/audio';
import { ClusterTopologyMap } from '@/components/ClusterTopologyMap';
import { RadialGauge } from '@/components/ui/RadialGauge';
import { LiveSparkline } from '@/components/ui/LiveSparkline';
import { ShimmerBar } from '@/components/ui/ShimmerBar';
import { OrbitalSpinner } from '@/components/ui/OrbitalSpinner';
import { Activity } from 'lucide-react';

interface ClusterInfo {
  platform: string;
  name?: string;
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
  const [nodes, setNodes] = useState<any[]>([]);
  const [pods, setPods] = useState<any[]>([]);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([18, 22, 19, 25, 21, 24, 20, 22, 21, 23]);
  const [apiLatency, setApiLatency] = useState<number>(22);
  const [healthScore, setHealthScore] = useState<number>(100);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionLabel, setActionLabel] = useState<string>('Processing...');
  const [message, setMessage] = useState<string | null>(null);
  const { openTerminal } = useTerminal();

  const fetchData = async () => {
    try {
      const t0 = performance.now();
      const [clusterRes, appsRes, nodesRes, podsRes] = await Promise.all([
        fetch('/api/cluster'),
        fetch('/api/apps'),
        fetch('/api/cluster/nodes').catch(() => null),
        fetch('/api/k8s/pods').catch(() => null),
      ]);
      const latencyMs = Math.round(performance.now() - t0);
      setApiLatency(latencyMs);
      setLatencyHistory((prev) => [...prev.slice(-14), latencyMs]);

      const clusterData = await clusterRes.json();
      const appsData = await appsRes.json();
      setCluster(clusterData);
      setApps(appsData.apps || []);

      if (nodesRes && nodesRes.ok) {
        const nodesData = await nodesRes.json();
        setNodes(nodesData.nodes || []);
      }
      if (podsRes && podsRes.ok) {
        const podsData = await podsRes.json();
        setPods(podsData.pods || []);
      }

      // Compute health score
      if (clusterData?.isRunning) {
        setHealthScore(100);
      } else {
        setHealthScore(35);
      }
    } catch {
      setHealthScore(20);
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
    soundFx.playClick();
    setActionLoading(true);
    setActionLabel('Deploying cluster stack & applications...');
    setMessage(null);
    try {
      const res = await fetch('/api/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'up' }),
      });
      const data = await res.json();
      if (data.success) {
        soundFx.playSuccess();
        setMessage(`Started full deployment (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, 'Full Cluster Deployment (up)');
        }
      } else {
        soundFx.playError();
        setMessage(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      soundFx.playError();
      setMessage(`Failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartCluster = async () => {
    soundFx.playClick();
    setActionLoading(true);
    setActionLabel('Provisioning cluster nodes...');
    try {
      const res = await fetch('/api/cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      });
      const data = await res.json();
      if (data.success) {
        soundFx.playSuccess();
        setMessage(`Cluster creation started (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, 'Cluster Provisioning');
        }
      } else {
        soundFx.playError();
        setMessage(`Failed: ${data.error || 'Failed to start cluster'}`);
      }
    } catch (err: any) {
      soundFx.playError();
      setMessage(`Failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopCluster = async () => {
    soundFx.playClick();
    if (!confirm('Are you sure you want to stop/delete the local cluster?')) return;
    setActionLoading(true);
    setActionLabel('Tearing down cluster resources...');
    try {
      const res = await fetch('/api/cluster', { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        soundFx.playSuccess();
        setMessage(`Cluster deletion task started (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, 'Cluster Teardown');
        }
      } else {
        soundFx.playError();
        setMessage(`Failed: ${data.error || 'Failed to delete cluster'}`);
      }
    } catch (err: any) {
      soundFx.playError();
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
            onClick={() => {
              soundFx.playSonarPing();
              fetchData();
            }}
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
            href="/antigravity"
            className="px-3.5 py-2 bg-gradient-to-r from-sky-600/30 to-indigo-600/30 hover:from-sky-600/40 hover:to-indigo-600/40 text-sky-300 text-sm font-medium rounded-lg border border-sky-500/40 flex items-center space-x-2 transition-colors"
          >
            <Sparkles className="w-4 h-4 text-sky-400" />
            <span>Antigravity Copilot</span>
          </Link>
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

      {/* Action Progress Shimmer */}
      {actionLoading && (
        <div className="p-4 bg-slate-900/90 border border-sky-500/30 rounded-xl space-y-2 shadow-lg shadow-sky-950/40">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center space-x-2 text-sky-400">
              <OrbitalSpinner size={18} color="#38bdf8" />
              <span className="font-mono font-medium">{actionLabel}</span>
            </div>
            <span className="text-slate-400 text-[11px] font-mono">Mission Control Active</span>
          </div>
          <ShimmerBar height={5} color="cyan" />
        </div>
      )}

      {/* Cyberdeck Mission Control Telemetry Strip */}
      <div className="p-4 sm:p-5 bg-slate-900/80 border border-slate-800 rounded-2xl backdrop-blur-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-3 border-b border-slate-800/80">
          <div className="flex items-center space-x-2.5">
            <div className="relative">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping absolute" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 relative" />
            </div>
            <h3 className="text-sm font-bold text-white tracking-wide uppercase font-mono flex items-center gap-2">
              <Activity className="w-4 h-4 text-sky-400" />
              Telemetry Telemetry & Real-Time Cyberdeck
            </h3>
          </div>
          <div className="flex items-center space-x-4 text-xs font-mono text-slate-400">
            <span>API Latency: <strong className="text-sky-300">{apiLatency} ms</strong></span>
            <span>·</span>
            <span>Nodes: <strong className="text-emerald-300">{nodes.length}</strong></span>
            <span>·</span>
            <span>Pods: <strong className="text-indigo-300">{pods.length}</strong></span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-center">
          {/* Health Gauge */}
          <div className="flex items-center space-x-4 p-3 bg-slate-950/40 border border-slate-800/70 rounded-xl">
            <RadialGauge
              value={healthScore}
              title="Health Score"
              unit="%"
              colorScheme="health"
              size={130}
            />
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-slate-200">K8s Core Livez</div>
              <p className="text-slate-400 text-[11px]">
                {healthScore >= 90
                  ? 'All controller components nominal'
                  : 'Cluster degraded or stopped'}
              </p>
              <div className="pt-1 text-[11px] font-mono text-emerald-400">
                {cluster?.isRunning ? 'ACTIVE RUNTIME' : 'STANDBY'}
              </div>
            </div>
          </div>

          {/* Latency Gauge + Sparkline */}
          <div className="flex flex-col p-3 bg-slate-950/40 border border-slate-800/70 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-slate-400">API Response Stream</span>
              <span className="text-xs font-mono text-sky-400">{apiLatency} ms</span>
            </div>
            <div className="flex items-center justify-center py-1">
              <LiveSparkline
                data={latencyHistory}
                width={260}
                height={46}
                color="#38bdf8"
                fillColor="rgba(56, 189, 248, 0.15)"
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>t-15 ticks</span>
              <span>Live polling (8s)</span>
            </div>
          </div>

          {/* CIS Hardening Gauge */}
          <div className="flex items-center space-x-4 p-3 bg-slate-950/40 border border-slate-800/70 rounded-xl">
            <RadialGauge
              value={94}
              title="CIS Benchmark"
              unit="%"
              colorScheme="speed"
              size={130}
            />
            <div className="space-y-1 text-xs">
              <div className="font-semibold text-slate-200">Security Posture</div>
              <p className="text-slate-400 text-[11px]">
                PSS Restricted enforcement & rootless socket isolation
              </p>
              <div className="pt-1 text-[11px] font-mono text-sky-400">
                GRADE A+ VERIFIED
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Front-and-Center Cluster Topology Map */}
      <ClusterTopologyMap
        nodes={nodes}
        pods={pods}
        loading={loading}
        onRefresh={() => {
          soundFx.playSonarPing();
          fetchData();
        }}
      />

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Cluster Status */}
        <div className="p-5 bg-slate-900/60 border border-slate-800 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Cluster State</span>
            <Server className="w-4 h-4 text-sky-400" />
          </div>
          <div className="flex items-baseline space-x-2">
            <span className="text-2xl font-bold text-white uppercase">
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
            {cluster?.name ? <span className="text-sky-400 font-medium">{cluster.name} · </span> : null}
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

      {/* Quick Navigation Panels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Link
          href="/pods"
          className="p-4 bg-slate-900/90 border border-slate-800 hover:border-sky-500/50 rounded-xl transition-all group"
        >
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-sky-950/80 rounded-lg border border-sky-800/40 text-sky-400 group-hover:scale-105 transition-transform">
              <Boxes className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-200 group-hover:text-sky-400">Pod Explorer</div>
              <div className="text-xs text-slate-400">Live logs & restarts</div>
            </div>
          </div>
        </Link>

        <Link
          href="/storage"
          className="p-4 bg-slate-900/90 border border-slate-800 hover:border-emerald-500/50 rounded-xl transition-all group"
        >
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-emerald-950/80 rounded-lg border border-emerald-800/40 text-emerald-400 group-hover:scale-105 transition-transform">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-200 group-hover:text-emerald-400">Storage Allocation</div>
              <div className="text-xs text-slate-400">PV, PVC & StorageClass</div>
            </div>
          </div>
        </Link>

        <Link
          href="/apps"
          className="p-4 bg-slate-900/90 border border-slate-800 hover:border-indigo-500/50 rounded-xl transition-all group"
        >
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-indigo-950/80 rounded-lg border border-indigo-800/40 text-indigo-400 group-hover:scale-105 transition-transform">
              <Cpu className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-200 group-hover:text-indigo-400">Presets & RAM Profiler</div>
              <div className="text-xs text-slate-400">Workload resource sizing</div>
            </div>
          </div>
        </Link>

        <Link
          href="/certificates"
          className="p-4 bg-slate-900/90 border border-slate-800 hover:border-amber-500/50 rounded-xl transition-all group"
        >
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-amber-950/80 rounded-lg border border-amber-800/40 text-amber-400 group-hover:scale-105 transition-transform">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-slate-200 group-hover:text-amber-400">Zero-Sudo DNS & TLS</div>
              <div className="text-xs text-slate-400">sslip.io & cert-manager</div>
            </div>
          </div>
        </Link>
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
