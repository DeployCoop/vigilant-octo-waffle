'use client';

import { useState, useEffect } from 'react';
import {
  Globe,
  RefreshCw,
  Send,
} from 'lucide-react';

interface FleetCluster {
  id: string;
  name: string;
  environment: 'local' | 'dev' | 'staging' | 'production';
  provider: 'kind' | 'k3d' | 'eks' | 'gke' | 'aks';
  k8sVersion: string;
  nodeCount: number;
  podCount: number;
  cpuCapacityCores: number;
  memoryCapacityGb: number;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  isCurrentContext: boolean;
  location: string;
  argocdSyncStatus: 'Synced' | 'OutOfSync' | 'Progressing';
}

export default function FleetCommanderPage() {
  const [clusters, setClusters] = useState<FleetCluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Broadcast state
  const [broadcastApp, setBroadcastApp] = useState('nextcloud');
  const [selectedClusterIds, setSelectedClusterIds] = useState<string[]>(['cluster-kind-local', 'cluster-k3d-edge']);
  const [broadcasting, setBroadcasting] = useState(false);

  const fetchClusters = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/fleet');
      const data = await res.json();
      setClusters(data.clusters || []);
    } catch (err) {
      console.error('Failed to load fleet clusters:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClusters();
  }, []);

  const handleSwitchContext = async (clusterId: string) => {
    try {
      const res = await fetch('/api/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'switch_context', clusterId }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(data.message);
        fetchClusters();
      }
    } catch (err) {
      console.error('Switch context failed:', err);
    }
  };

  const handleBroadcast = async () => {
    setBroadcasting(true);
    try {
      const res = await fetch('/api/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'broadcast',
          appId: broadcastApp,
          targetClusterIds: selectedClusterIds,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(data.message);
        fetchClusters();
      }
    } catch (err) {
      console.error('Broadcast failed:', err);
    } finally {
      setBroadcasting(false);
    }
  };

  const toggleClusterSelection = (id: string) => {
    setSelectedClusterIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-blue-500/10 text-blue-400 rounded-xl border border-blue-500/20">
            <Globe className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">OctoFleet: Multi-Cluster Fleet Commander</h1>
            <p className="text-sm text-slate-400">
              Unified control deck for local KinD/K3d and multi-cloud EKS/GKE/AKS clusters with global app broadcasting
            </p>
          </div>
        </div>

        <button
          onClick={fetchClusters}
          disabled={loading}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Fleet</span>
        </button>
      </div>

      {actionMessage && (
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-blue-300 flex justify-between items-center">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
      )}

      {/* Cluster Grid Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {clusters.map((cluster) => {
          const isCurrent = cluster.isCurrentContext;
          return (
            <div
              key={cluster.id}
              className={`p-6 rounded-2xl border transition flex flex-col justify-between space-y-4 ${
                isCurrent
                  ? 'bg-blue-950/20 border-blue-500/50 shadow-sm'
                  : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                      cluster.environment === 'production'
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                        : cluster.environment === 'staging'
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {cluster.environment}
                  </span>

                  <span className="text-[10px] font-mono text-slate-400 uppercase bg-slate-800 px-2 py-0.5 rounded border border-slate-700">
                    {cluster.provider}
                  </span>
                </div>

                <div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                    <span>{cluster.name}</span>
                    {isCurrent && <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>}
                  </h3>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">{cluster.location}</div>
                </div>

                <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800/80 space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between text-slate-400">
                    <span>K8s Version:</span>
                    <span className="text-slate-200">{cluster.k8sVersion}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Nodes / Pods:</span>
                    <span className="text-slate-200">{cluster.nodeCount} / {cluster.podCount}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Compute Capacity:</span>
                    <span className="text-slate-200">{cluster.cpuCapacityCores} Cores, {cluster.memoryCapacityGb}GB</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>GitOps Sync:</span>
                    <span className={cluster.argocdSyncStatus === 'Synced' ? 'text-emerald-400' : 'text-amber-400'}>
                      {cluster.argocdSyncStatus}
                    </span>
                  </div>
                </div>
              </div>

              <div>
                <button
                  onClick={() => handleSwitchContext(cluster.id)}
                  disabled={isCurrent}
                  className={`w-full py-2 rounded-lg text-xs font-medium transition ${
                    isCurrent
                      ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30 cursor-default'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  }`}
                >
                  {isCurrent ? 'Active Operational Context' : 'Switch Context'}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Global Application Broadcaster */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center space-x-2">
          <Send className="w-5 h-5 text-blue-400" />
          <h2 className="text-base font-bold text-slate-100">Global Application & GitOps Broadcaster</h2>
        </div>
        <p className="text-xs text-slate-400">
          Deploy an application simultaneously across selected target clusters in your fleet with unified GitOps reconciliation.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Select Application Spec</label>
            <select
              value={broadcastApp}
              onChange={(e) => setBroadcastApp(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 outline-none focus:border-blue-500 font-mono"
            >
              <option value="nextcloud">nextcloud (Storage & Sync Suite)</option>
              <option value="keycloak">keycloak (Single Sign-On Auth)</option>
              <option value="postgres">postgres (Database Cluster)</option>
              <option value="traefik">traefik (Edge Ingress Gateway)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Target Fleet Clusters</label>
            <div className="flex flex-wrap gap-2">
              {clusters.map((c) => {
                const isChecked = selectedClusterIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleClusterSelection(c.id)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono transition border ${
                      isChecked
                        ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                        : 'bg-slate-950 text-slate-400 border-slate-800'
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <button
              onClick={handleBroadcast}
              disabled={broadcasting || selectedClusterIds.length === 0}
              className="w-full flex items-center justify-center space-x-2 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              {broadcasting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
              <span>Broadcast App to Fleet</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
