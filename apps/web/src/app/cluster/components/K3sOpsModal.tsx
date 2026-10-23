'use client';

import {
  Server,
  Cpu,
  Layers,
  Activity,
  Copy,
  Check,
  Download,
  X,
  Shield,
  Zap,
  Wifi,
  HardDrive,
  Lock,
  ShieldCheck,
  ArrowUpCircle,
} from 'lucide-react';
import type { ClusterPageState } from '../useClusterPage';
import CommandPanel from './k3s-ops/CommandPanel';
import ScriptPanel from './k3s-ops/ScriptPanel';
import SshPanel from './k3s-ops/SshPanel';
import BatchPanel from './k3s-ops/BatchPanel';
import OpsPanel from './k3s-ops/OpsPanel';
import EtcdPanel from './k3s-ops/EtcdPanel';
import CertsPanel from './k3s-ops/CertsPanel';
import CisPanel from './k3s-ops/CisPanel';
import UpgradePanel from './k3s-ops/UpgradePanel';
import VipPanel from './k3s-ops/VipPanel';
import CniPanel from './k3s-ops/CniPanel';
import SecretsPanel from './k3s-ops/SecretsPanel';
import SecurityPanel from './k3s-ops/SecurityPanel';
import StoragePanel from './k3s-ops/StoragePanel';
import MonitoringPanel from './k3s-ops/MonitoringPanel';
import GpuPanel from './k3s-ops/GpuPanel';
import SyncPanel from './k3s-ops/SyncPanel';
import HealerPanel from './k3s-ops/HealerPanel';
import DrDrillPanel from './k3s-ops/DrDrillPanel';
import PoolPanel from './k3s-ops/PoolPanel';

export default function K3sOpsModal({ state }: { state: ClusterPageState }) {
  const { showK3sModal, setShowK3sModal, k3sRole, setK3sRole, k3sServerUrl, setK3sServerUrl, k3sToken, setK3sToken, k3sNodeName, setK3sNodeName, k3sNodeIp, setK3sNodeIp, k3sLabels, setK3sLabels, k3sActiveTab, setK3sActiveTab, copied, copyToClipboard } = state;
  return (
    <>
      {/* K3s Multi-Node Join Modal */}
      {showK3sModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-2xl p-6 space-y-6">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center space-x-2.5">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                  ['command', 'script', 'ssh', 'batch'].includes(k3sActiveTab)
                    ? 'bg-purple-600/20 border-purple-500/30 text-purple-400'
                    : k3sActiveTab === 'etcd'
                    ? 'bg-sky-600/20 border-sky-500/30 text-sky-400'
                    : k3sActiveTab === 'certs'
                    ? 'bg-amber-600/20 border-amber-500/30 text-amber-400'
                    : k3sActiveTab === 'cis'
                    ? 'bg-emerald-600/20 border-emerald-500/30 text-emerald-400'
                    : k3sActiveTab === 'upgrade'
                    ? 'bg-indigo-600/20 border-indigo-500/30 text-indigo-400'
                    : 'bg-purple-600/20 border-purple-500/30 text-purple-400'
                }`}>
                  {['command', 'script', 'ssh', 'batch'].includes(k3sActiveTab) && <Server className="w-4 h-4" />}
                  {k3sActiveTab === 'etcd' && <HardDrive className="w-4 h-4" />}
                  {k3sActiveTab === 'certs' && <Lock className="w-4 h-4" />}
                  {k3sActiveTab === 'cis' && <Shield className="w-4 h-4" />}
                  {k3sActiveTab === 'upgrade' && <ArrowUpCircle className="w-4 h-4" />}
                  {k3sActiveTab === 'ops' && <Zap className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    {['command', 'script', 'ssh', 'batch'].includes(k3sActiveTab)
                      ? 'Join Additional K3s Node'
                      : k3sActiveTab === 'etcd'
                      ? 'etcd Disaster Recovery & Snapshots'
                      : k3sActiveTab === 'certs'
                      ? 'TLS Certificate Health & Rotation'
                      : k3sActiveTab === 'cis'
                      ? 'CIS Kubernetes Benchmark Audit'
                      : k3sActiveTab === 'upgrade'
                      ? 'Zero-Downtime Rolling Upgrade'
                      : 'Cluster Operations & Maintenance'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {['command', 'script', 'ssh', 'batch'].includes(k3sActiveTab)
                      ? 'Add baremetal, VM, or cloud nodes into your K3s cluster'
                      : k3sActiveTab === 'etcd'
                      ? 'Automated scheduled snapshots, manual backups, defrag, and state recovery'
                      : k3sActiveTab === 'certs'
                      ? 'Audit internal certificate expiration dates and perform zero-downtime rotation'
                      : k3sActiveTab === 'cis'
                      ? 'Automated security benchmark check for kubeconfig permissions, token security, and sysctl'
                      : k3sActiveTab === 'upgrade'
                      ? 'Sequentially upgrade control-plane and worker fleets with automated pre-flight snapshot'
                      : 'Execute ping diagnostics, kernel limits tuning, and full cluster rebuilds'}
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

            {/* Navigation Tabs */}
            <div className="flex border-b border-slate-800 overflow-x-auto gap-1 pb-1">
              <button
                type="button"
                onClick={() => setK3sActiveTab('command')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap ${
                  k3sActiveTab === 'command'
                    ? 'bg-purple-950/60 text-purple-300 border-b-2 border-purple-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                One-Line
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('script')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap ${
                  k3sActiveTab === 'script'
                    ? 'bg-purple-950/60 text-purple-300 border-b-2 border-purple-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Join Script
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('ssh')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap ${
                  k3sActiveTab === 'ssh'
                    ? 'bg-purple-950/60 text-purple-300 border-b-2 border-purple-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                SSH Join
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('batch')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap ${
                  k3sActiveTab === 'batch'
                    ? 'bg-purple-950/60 text-purple-300 border-b-2 border-purple-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Batch Provision
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('etcd')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'etcd'
                    ? 'bg-sky-950/60 text-sky-300 border-b-2 border-sky-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <HardDrive className="w-3 h-3 text-sky-400" />
                <span>etcd Snapshots</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('certs')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'certs'
                    ? 'bg-amber-950/60 text-amber-300 border-b-2 border-amber-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Lock className="w-3 h-3 text-amber-400" />
                <span>TLS Certs</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('cis')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'cis'
                    ? 'bg-emerald-950/60 text-emerald-300 border-b-2 border-emerald-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Shield className="w-3 h-3 text-emerald-400" />
                <span>CIS Audit</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('upgrade')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'upgrade'
                    ? 'bg-indigo-950/60 text-indigo-300 border-b-2 border-indigo-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ArrowUpCircle className="w-3 h-3 text-indigo-400" />
                <span>Rolling Upgrade</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('vip')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'vip'
                    ? 'bg-cyan-950/60 text-cyan-300 border-b-2 border-cyan-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Wifi className="w-3 h-3 text-cyan-400" />
                <span>Floating VIP</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('cni')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'cni'
                    ? 'bg-teal-950/60 text-teal-300 border-b-2 border-teal-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Cpu className="w-3 h-3 text-teal-400" />
                <span>Cilium eBPF</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('secrets')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'secrets'
                    ? 'bg-rose-950/60 text-rose-300 border-b-2 border-rose-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Lock className="w-3 h-3 text-rose-400" />
                <span>Secrets-at-Rest</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('security')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'security'
                    ? 'bg-red-950/60 text-red-300 border-b-2 border-red-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ShieldCheck className="w-3 h-3 text-red-400" />
                <span>CVE Scanner</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('storage')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'storage'
                    ? 'bg-orange-950/60 text-orange-300 border-b-2 border-orange-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <HardDrive className="w-3 h-3 text-orange-400" />
                <span>Distributed Storage</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('monitoring')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'monitoring'
                    ? 'bg-blue-950/60 text-blue-300 border-b-2 border-blue-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Activity className="w-3 h-3 text-blue-400" />
                <span>VictoriaMetrics</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('gpu')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'gpu'
                    ? 'bg-emerald-950/60 text-emerald-300 border-b-2 border-emerald-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Zap className="w-3 h-3 text-emerald-400" />
                <span>GPU & Edge AI</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('sync')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'sync'
                    ? 'bg-fuchsia-950/60 text-fuchsia-300 border-b-2 border-fuchsia-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Download className="w-3 h-3 text-fuchsia-400" />
                <span>Remote DR & Airgap</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('healer')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'healer'
                    ? 'bg-rose-950/60 text-rose-300 border-b-2 border-rose-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Activity className="w-3 h-3 text-rose-400" />
                <span>Self-Healing Watchdog</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('dr-drill')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'dr-drill'
                    ? 'bg-emerald-950/60 text-emerald-300 border-b-2 border-emerald-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span>DR Game Day</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('pool')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'pool'
                    ? 'bg-sky-950/60 text-sky-300 border-b-2 border-sky-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Layers className="w-3 h-3 text-sky-400" />
                <span>Hybrid Node Pool</span>
              </button>
              <button
                type="button"
                onClick={() => setK3sActiveTab('ops')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-t-lg transition whitespace-nowrap flex items-center space-x-1.5 ${
                  k3sActiveTab === 'ops'
                    ? 'bg-purple-950/60 text-purple-300 border-b-2 border-purple-500'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Zap className="w-3 h-3 text-purple-400" />
                <span>Cluster Ops</span>
              </button>
            </div>

            {/* If Join Tab, render Role Selection and Connection Inputs */}
            {['command', 'script', 'ssh', 'batch'].includes(k3sActiveTab) && (
              <>
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
              </>
            )}

            {/* Tab Contents */}
            <div className="space-y-3">

              {k3sActiveTab === 'command' && <CommandPanel state={state} />}

              {k3sActiveTab === 'script' && <ScriptPanel state={state} />}

              {k3sActiveTab === 'ssh' && <SshPanel state={state} />}

              {k3sActiveTab === 'batch' && <BatchPanel state={state} />}

              {k3sActiveTab === 'ops' && <OpsPanel state={state} />}

              {/* etcd Snapshots Tab */}
              {k3sActiveTab === 'etcd' && <EtcdPanel state={state} />}

              {/* TLS Certificates Tab */}
              {k3sActiveTab === 'certs' && <CertsPanel state={state} />}

              {/* CIS Hardening Benchmark Tab */}
              {k3sActiveTab === 'cis' && <CisPanel state={state} />}

              {/* Rolling Upgrade Tab */}
              {k3sActiveTab === 'upgrade' && <UpgradePanel state={state} />}

              {/* Floating VIP Tab */}
              {k3sActiveTab === 'vip' && <VipPanel state={state} />}

              {/* Cilium eBPF Tab */}
              {k3sActiveTab === 'cni' && <CniPanel state={state} />}

              {/* Secrets-at-Rest Tab */}
              {k3sActiveTab === 'secrets' && <SecretsPanel state={state} />}

              {/* Security & Trivy Tab */}
              {k3sActiveTab === 'security' && <SecurityPanel state={state} />}

              {/* Distributed Storage Tab */}
              {k3sActiveTab === 'storage' && <StoragePanel state={state} />}

              {/* VictoriaMetrics Observability Tab */}
              {k3sActiveTab === 'monitoring' && <MonitoringPanel state={state} />}

              {/* GPU Acceleration & AI Tab */}
              {k3sActiveTab === 'gpu' && <GpuPanel state={state} />}

              {/* Remote DR & Airgap Tab */}
              {k3sActiveTab === 'sync' && <SyncPanel state={state} />}

              {/* Autonomous Self-Healing Watchdog Tab */}
              {k3sActiveTab === 'healer' && <HealerPanel state={state} />}

              {/* Disaster Recovery Game Day Drill Tab */}
              {k3sActiveTab === 'dr-drill' && <DrDrillPanel state={state} />}

              {/* Hybrid Node Pool Tab */}
              {k3sActiveTab === 'pool' && <PoolPanel state={state} />}
            </div>

            <div className="pt-2 flex justify-between items-center text-xs text-slate-500 border-t border-slate-800">
              <span>
                CLI alternative:{' '}
                <code className="text-purple-300 bg-slate-950 px-1.5 py-0.5 rounded font-mono">
                  {k3sActiveTab === 'etcd'
                    ? './up k3s:etcd list'
                    : k3sActiveTab === 'certs'
                    ? './up k3s:certs'
                    : k3sActiveTab === 'cis'
                    ? './up k3s:cis'
                    : k3sActiveTab === 'upgrade'
                    ? './up k3s:upgrade'
                    : k3sActiveTab === 'ops'
                    ? './src/k3s_ops.sh --ping'
                    : `./src/k3s_add_node.sh --role ${k3sRole}`}
                </code>
              </span>
              <button
                type="button"
                onClick={() => setShowK3sModal(false)}
                className="px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition font-medium cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
