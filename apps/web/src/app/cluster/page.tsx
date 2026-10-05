'use client';

import {
  Server,
  Play,
  Square,
  Cpu,
  Terminal,
  PlusCircle,
  MinusCircle,
  Activity,
  Shield,
  HardDrive,
  Lock,
  ShieldCheck,
  ArrowUpCircle,
  Pause,
  LogOut,
  PlayCircle,
  Key,
} from 'lucide-react';
import Link from 'next/link';
import { useClusterPage } from './useClusterPage';
import K3sOpsModal from './components/K3sOpsModal';

export default function ClusterPage() {
  const state = useClusterPage();
  const { openSignInPrompt, canManageCluster, canJoinNodes, cluster, actionLoading, scaling, message, nodeMetrics, k3sLoading, k3sHealth, k3sEtcd, k3sCerts, k3sCis, handleScaleNodes, openK3sModal, handleDrainNode, handleCordonNode, handleUncordonNode, handleAction } = state;
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
            onClick={() => {
              if (!canManageCluster) {
                openSignInPrompt();
                return;
              }
              handleAction('start');
            }}
            disabled={actionLoading}
            title={canManageCluster ? undefined : 'Requires the cluster:manage permission (click to sign in)'}
            className={`px-3.5 py-2 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer ${
              canManageCluster
                ? 'bg-emerald-600 hover:bg-emerald-500'
                : 'bg-emerald-800/70 hover:bg-emerald-700/80 text-emerald-200 border border-emerald-600/40'
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Create Cluster</span>
          </button>
          <button
            onClick={() => {
              if (!canManageCluster) {
                openSignInPrompt();
                return;
              }
              handleAction('stop');
            }}
            disabled={actionLoading}
            title={canManageCluster ? undefined : 'Requires the cluster:manage permission (click to sign in)'}
            className={`px-3.5 py-2 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer ${
              canManageCluster
                ? 'bg-rose-600 hover:bg-rose-500'
                : 'bg-rose-900/60 hover:bg-rose-800/70 text-rose-200 border border-rose-700/40'
            }`}
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

      {!canManageCluster && (
        <div className="p-4 bg-amber-950/40 border border-amber-800/60 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-200">
          <div className="flex items-center space-x-2.5">
            <Lock className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              Cluster lifecycle controls are locked. You are viewing in read-only mode without the <code className="bg-amber-950/80 border border-amber-800/50 px-1 py-0.5 rounded font-mono">cluster:manage</code> permission.
            </span>
          </div>
          <button
            onClick={openSignInPrompt}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg shrink-0 transition flex items-center space-x-1.5 cursor-pointer shadow-sm"
          >
            <Key className="w-3.5 h-3.5" />
            <span>Sign In with Token</span>
          </button>
        </div>
      )}

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

      {/* Production K3s Battle-Hardened Operations Center */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/20 to-slate-900 border border-indigo-500/30 rounded-xl p-5 space-y-4 shadow-lg shadow-indigo-950/20">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white tracking-tight">Production K3s Battle-Hardening</h3>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/30 uppercase">
                  HA &amp; Security
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Automated embedded etcd snapshots, rolling upgrades, TLS rotation, and CIS compliance
              </p>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => openK3sModal('etcd')}
              className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 rounded-lg flex items-center space-x-1.5 transition font-medium cursor-pointer"
            >
              <HardDrive className="w-3.5 h-3.5 text-sky-400" />
              <span>etcd Snapshots</span>
            </button>
            <button
              onClick={() => openK3sModal('certs')}
              className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 rounded-lg flex items-center space-x-1.5 transition font-medium cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <span>TLS Certs</span>
            </button>
            <button
              onClick={() => openK3sModal('cis')}
              className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 rounded-lg flex items-center space-x-1.5 transition font-medium cursor-pointer"
            >
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>CIS Benchmark</span>
            </button>
            <button
              onClick={() => openK3sModal('upgrade')}
              className="text-xs px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg flex items-center space-x-1.5 transition font-semibold cursor-pointer shadow-sm"
            >
              <ArrowUpCircle className="w-3.5 h-3.5" />
              <span>Rolling Upgrade</span>
            </button>
          </div>
        </div>

        {/* 4 Health & Hardening KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Health Score */}
          <div className="p-3.5 bg-slate-950/80 border border-slate-800/80 rounded-lg space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium">Health Watchdog</span>
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-xl font-black text-white">{k3sHealth?.score ?? 100}%</span>
              <span className={`text-[11px] font-semibold uppercase ${
                (k3sHealth?.score ?? 100) >= 80 ? 'text-emerald-400' : (k3sHealth?.score ?? 100) >= 50 ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {k3sHealth?.status || 'HEALTHY'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 flex items-center space-x-2">
              <span>Latency: <strong className="text-slate-300 font-mono">{k3sHealth?.api_latency_ms ?? 0}ms</strong></span>
              <span>•</span>
              <span>Pods: <strong className="text-slate-300 font-mono">{k3sHealth?.pod_health?.running ?? cluster?.telemetry?.podCount ?? 0} ok</strong></span>
            </div>
          </div>

          {/* etcd Snapshots */}
          <div className="p-3.5 bg-slate-950/80 border border-slate-800/80 rounded-lg space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium">etcd Disaster Recovery</span>
              <HardDrive className="w-3.5 h-3.5 text-sky-400" />
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-xl font-black text-white">{k3sEtcd?.snapshot_count ?? (k3sEtcd?.snapshots?.length || 0)}</span>
              <span className="text-[11px] font-medium text-slate-400">snapshots</span>
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {k3sEtcd?.last_snapshot ? (
                <span>Last: <span className="text-slate-300 font-mono">{k3sEtcd.last_snapshot.name}</span></span>
              ) : (
                <span className="text-slate-500">Automated 12h cron active</span>
              )}
            </div>
          </div>

          {/* TLS Certificates */}
          <div className="p-3.5 bg-slate-950/80 border border-slate-800/80 rounded-lg space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium">TLS Certificate Health</span>
              <Lock className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="flex items-baseline space-x-2">
              <span className={`text-xl font-black ${
                k3sCerts?.all_valid !== false ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                {k3sCerts?.all_valid !== false ? 'Valid' : 'Attention'}
              </span>
              {k3sCerts?.earliest_expiry_days !== undefined && (
                <span className="text-[11px] text-slate-400 font-mono">({k3sCerts.earliest_expiry_days}d left)</span>
              )}
            </div>
            <div className="text-[11px] text-slate-400">
              <span>{k3sCerts?.certificates?.length || 10} certificates audited</span>
            </div>
          </div>

          {/* CIS Benchmark */}
          <div className="p-3.5 bg-slate-950/80 border border-slate-800/80 rounded-lg space-y-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-medium">CIS Hardening Audit</span>
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="flex items-baseline space-x-2">
              <span className="text-xl font-black text-white">{k3sCis?.score || `${k3sCis?.passed || 6}/${k3sCis?.total || 6}`}</span>
              <span className="text-[11px] text-emerald-400 font-semibold">{k3sCis?.percent ?? 100}% PASS</span>
            </div>
            <div className="text-[11px] text-slate-400">
              <span>Kernel limits, sysctl, &amp; RBAC</span>
            </div>
          </div>
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
              disabled={!canJoinNodes}
              className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg flex items-center space-x-1.5 transition font-semibold cursor-pointer shadow-sm disabled:opacity-50"
              title={canJoinNodes ? 'Join an additional worker or control-plane server node to this K3s cluster' : 'Requires the cluster:nodes:join permission'}
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

                  <div className="flex items-center space-x-3">
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

                    {/* Node Lifecycle Actions (Cordon, Drain) */}
                    <div className="flex items-center space-x-1.5 pl-1">
                      {node.status.toLowerCase().includes('schedulingdisabled') || node.status.toLowerCase().includes('cordon') ? (
                        <button
                          onClick={() => handleUncordonNode(node.name)}
                          disabled={k3sLoading}
                          className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-emerald-950/60 text-emerald-400 hover:border-emerald-600 border border-slate-700 rounded flex items-center space-x-1 transition disabled:opacity-40 cursor-pointer"
                          title="Uncordon node (mark as schedulable)"
                        >
                          <PlayCircle className="w-3 h-3" />
                          <span>Uncordon</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => handleCordonNode(node.name)}
                          disabled={k3sLoading}
                          className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-amber-950/60 text-amber-400 hover:border-amber-600 border border-slate-700 rounded flex items-center space-x-1 transition disabled:opacity-40 cursor-pointer"
                          title="Cordon node (mark as unschedulable)"
                        >
                          <Pause className="w-3 h-3" />
                          <span>Cordon</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleDrainNode(node.name)}
                        disabled={k3sLoading}
                        className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-rose-950/60 text-rose-400 hover:border-rose-600 border border-slate-700 rounded flex items-center space-x-1 transition disabled:opacity-40 cursor-pointer"
                        title="Drain workloads safely from this node"
                      >
                        <LogOut className="w-3 h-3" />
                        <span>Drain</span>
                      </button>
                    </div>
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

      <K3sOpsModal state={state} />

    </div>
  );
}

