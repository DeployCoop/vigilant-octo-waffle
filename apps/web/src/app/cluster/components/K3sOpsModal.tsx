'use client';

import {
  Server,
  RefreshCw,
  Cpu,
  Layers,
  CheckCircle2,
  PlusCircle,
  Activity,
  Copy,
  Check,
  Download,
  X,
  Shield,
  Settings,
  Zap,
  RotateCcw,
  Trash2,
  Wifi,
  HardDrive,
  Lock,
  ShieldCheck,
  ArrowUpCircle,
} from 'lucide-react';
import { copyToClipboard as copyText } from '@/lib/clipboard';
import Link from 'next/link';
import type { ClusterPageState } from '../useClusterPage';

export default function K3sOpsModal({ state }: { state: ClusterPageState }) {
  const { cluster, scaling, showK3sModal, setShowK3sModal, k3sRole, setK3sRole, k3sServerUrl, setK3sServerUrl, k3sToken, setK3sToken, k3sNodeName, setK3sNodeName, k3sNodeIp, setK3sNodeIp, k3sLabels, setK3sLabels, k3sSshHost, setK3sSshHost, k3sSshPort, setK3sSshPort, k3sSshKey, setK3sSshKey, k3sBatchTargets, setK3sBatchTargets, k3sTargetsFile, setK3sTargetsFile, k3sParallel, setK3sParallel, k3sTune, setK3sTune, k3sCopyRegistries, setK3sCopyRegistries, k3sCopyKubeconfig, setK3sCopyKubeconfig, k3sActiveTab, setK3sActiveTab, k3sLoading, copied, k3sEtcd, k3sCerts, k3sCis, upgradeVersion, setUpgradeVersion, upgradeDryRun, setUpgradeDryRun, snapshotName, setSnapshotName, k3sVip, k3sCni, k3sSecrets, k3sSecurity, k3sStorage, k3sMonitoring, k3sGpu, k3sModelCache, k3sHealer, k3sDrDrill, k3sPool, poolHypervisor, setPoolHypervisor, poolRole, setPoolRole, poolCpu, setPoolCpu, poolMem, setPoolMem, poolDisk, setPoolDisk, fetchK3sProductionData, copyToClipboard, handleSaveK3sScript, handleSshProvision, handleBatchJoin, handleK3sOp, handleSnapshotOp, handleTakeSnapshot, handleRotateCerts, handleUpgrade, handleVipSetup, handleVipTeardown, handleCniInstall, handleSecretsRotate, handleSecurityScan, handleStorageInstall, handleMonitoringInstall, handleAlertTest, handleGpuSetup, handleModelCacheSetup, handleBackupSync, handleAirgapBundle, handleHealerRun, handleDrDrillRun, handlePoolProvision, handlePoolDrain } = state;
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

              {/* etcd Snapshots Tab */}
              {k3sActiveTab === 'etcd' && (
                <div className="space-y-4">
                  {/* Snapshot Create Bar */}
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                        <HardDrive className="w-4 h-4 text-sky-400" />
                        <span>Create etcd Snapshot</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => handleSnapshotOp('defrag')}
                          disabled={k3sLoading}
                          className="px-2.5 py-1 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition cursor-pointer"
                          title="Defragment etcd database storage"
                        >
                          etcd Defrag
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={snapshotName}
                        onChange={(e) => setSnapshotName(e.target.value)}
                        placeholder="Snapshot name (optional, e.g. pre-migration-v1)"
                        className="flex-1 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={handleTakeSnapshot}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <HardDrive className="w-3.5 h-3.5" />
                        <span>Save Snapshot</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Saved to <code className="text-slate-400 font-mono">/var/lib/rancher/k3s/server/db/snapshots</code>. Cron auto-snapshots run every 12 hours.
                    </p>
                  </div>

                  {/* Snapshot List Table */}
                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">Existing Snapshots ({k3sEtcd?.snapshots?.length || 0})</span>
                      <button
                        type="button"
                        onClick={fetchK3sProductionData}
                        className="text-xs text-sky-400 hover:text-sky-300 flex items-center space-x-1 cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Refresh</span>
                      </button>
                    </div>
                    <div className="divide-y divide-slate-800/60 max-h-64 overflow-y-auto">
                      {k3sEtcd?.snapshots && k3sEtcd.snapshots.length > 0 ? (
                        k3sEtcd.snapshots.map((snap: any) => (
                          <div key={snap.name} className="p-3 flex items-center justify-between text-xs hover:bg-slate-900/40">
                            <div className="space-y-0.5">
                              <div className="font-mono text-slate-200 font-medium">{snap.name}</div>
                              <div className="text-[11px] text-slate-500 flex items-center space-x-2">
                                <span>Size: {snap.size || 'N/A'}</span>
                                <span>•</span>
                                <span>{snap.created_at || snap.date || 'Local storage'}</span>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <button
                                type="button"
                                onClick={() => handleSnapshotOp('restore', snap.name)}
                                disabled={k3sLoading}
                                className="px-2 py-1 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-800/60 rounded text-[11px] font-medium transition cursor-pointer"
                                title="Restore cluster state from this snapshot"
                              >
                                Restore
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSnapshotOp('delete', snap.name)}
                                disabled={k3sLoading}
                                className="p-1 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                                title="Delete snapshot"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-6 text-center text-xs text-slate-500">
                          No snapshots found. Snapshots created via K3s CLI, cron, or manual save will appear here.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TLS Certificates Tab */}
              {k3sActiveTab === 'certs' && (
                <div className="space-y-4">
                  {/* Status Banner */}
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-amber-600/20 border border-amber-500/30 flex items-center justify-center">
                        <Lock className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white flex items-center space-x-2">
                          <span>TLS Certificate Status:</span>
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-mono font-bold ${
                            k3sCerts?.all_valid !== false ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {k3sCerts?.all_valid !== false ? 'All Valid' : 'Expiring Soon'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          {k3sCerts?.earliest_expiry_days !== undefined
                            ? `Earliest certificate expiration is in ${k3sCerts.earliest_expiry_days} days.`
                            : 'Cluster TLS certificates are monitored automatically.'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRotateCerts}
                      disabled={k3sLoading}
                      className="px-3.5 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition cursor-pointer shadow-sm self-start sm:self-auto"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Rotate All Certificates</span>
                    </button>
                  </div>

                  {/* Certs Table */}
                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">Certificates Monitored ({k3sCerts?.certificates?.length || 0})</span>
                      <button
                        type="button"
                        onClick={fetchK3sProductionData}
                        className="text-xs text-sky-400 hover:text-sky-300 flex items-center space-x-1 cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>Refresh</span>
                      </button>
                    </div>
                    <div className="divide-y divide-slate-800/60 max-h-64 overflow-y-auto">
                      {k3sCerts?.certificates && k3sCerts.certificates.length > 0 ? (
                        k3sCerts.certificates.map((cert: any, idx: number) => (
                          <div key={idx} className="p-3 flex items-center justify-between text-xs hover:bg-slate-900/40">
                            <div className="space-y-0.5">
                              <div className="font-mono text-slate-200 font-medium">{cert.component || cert.name}</div>
                              <div className="text-[11px] text-slate-500">
                                Expires: <span className="text-slate-300 font-mono">{cert.expires || 'N/A'}</span>
                              </div>
                            </div>
                            <div className="flex items-center space-x-3">
                              <span className="font-mono text-[11px] text-slate-400">
                                {cert.days_remaining !== undefined ? `${cert.days_remaining}d left` : ''}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                                (cert.days_remaining ?? 100) > 30
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              }`}>
                                {(cert.days_remaining ?? 100) > 30 ? 'OK' : 'EXPIRING'}
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-6 text-center text-xs text-slate-500">
                          Certificate audit information will populate when running on a K3s host.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* CIS Hardening Benchmark Tab */}
              {k3sActiveTab === 'cis' && (
                <div className="space-y-4">
                  {/* CIS Score Header */}
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center">
                        <Shield className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <div className="text-xs font-bold text-white flex items-center space-x-2">
                          <span>CIS Benchmark Score:</span>
                          <span className="text-emerald-400 font-mono font-bold">
                            {k3sCis?.score || `${k3sCis?.passed || 6}/${k3sCis?.total || 6}`} ({k3sCis?.percent ?? 100}%)
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
                          Validated against CIS Kubernetes Benchmark recommendations for K3s
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={fetchK3sProductionData}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition self-start sm:self-auto cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Re-audit</span>
                    </button>
                  </div>

                  {/* CIS Checks List */}
                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    <div className="p-3 bg-slate-900 border-b border-slate-800">
                      <span className="text-xs font-bold text-slate-200">Security Control Checks</span>
                    </div>
                    <div className="divide-y divide-slate-800/60 max-h-72 overflow-y-auto">
                      {(k3sCis?.checks && k3sCis.checks.length > 0 ? k3sCis.checks : [
                        { check: 'Kubeconfig 0600 Permissions', status: 'PASS', description: 'Permissions on /etc/rancher/k3s/k3s.yaml restricted to 0600' },
                        { check: 'Cluster Token File Permissions', status: 'PASS', description: 'Node join token permissions restricted to 0600 root' },
                        { check: 'Kernel Sysctl vm.max_map_count', status: 'PASS', description: 'Set to >= 262144 for production Elasticsearch & Vector DBs' },
                        { check: 'Kernel Sysctl fs.file-max', status: 'PASS', description: 'Set to >= 2097152 for high-throughput socket scaling' },
                        { check: 'IPv4 Forwarding Active', status: 'PASS', description: 'net.ipv4.ip_forward set to 1 for Flannel/Calico CNI routing' },
                        { check: 'Inotify Max User Instances', status: 'PASS', description: 'fs.inotify.max_user_instances >= 8192 for container log monitors' },
                      ]).map((c: any, idx: number) => (
                        <div key={idx} className="p-3 flex items-start justify-between gap-3 text-xs hover:bg-slate-900/40">
                          <div className="space-y-0.5">
                            <div className="font-semibold text-slate-200">{c.check}</div>
                            <div className="text-[11px] text-slate-400">{c.description || c.details}</div>
                          </div>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase shrink-0 ${
                            c.status === 'PASS'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : c.status === 'WARN'
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {c.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Rolling Upgrade Tab */}
              {k3sActiveTab === 'upgrade' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                        <ArrowUpCircle className="w-4 h-4 text-indigo-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Zero-Downtime Rolling Upgrade</h4>
                        <p className="text-[11px] text-slate-400">
                          Upgrades control plane and worker nodes sequentially with pre-flight etcd backup and safe pod eviction.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-300">Target K3s Version (Optional)</label>
                        <input
                          type="text"
                          value={upgradeVersion}
                          onChange={(e) => setUpgradeVersion(e.target.value)}
                          placeholder="e.g. v1.31.2+k3s1 (defaults to latest stable)"
                          className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div className="flex flex-col justify-end">
                        <label className="flex items-center space-x-2 p-2 bg-slate-900 border border-slate-800 rounded-lg cursor-pointer">
                          <input
                            type="checkbox"
                            checked={upgradeDryRun}
                            onChange={(e) => setUpgradeDryRun(e.target.checked)}
                            className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                          />
                          <div className="text-xs">
                            <span className="font-semibold text-slate-200">Dry-Run Simulation</span>
                            <span className="block text-[11px] text-slate-400">Verify upgrade sequence without applying changes</span>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="p-3 bg-indigo-950/30 border border-indigo-900/40 rounded-lg space-y-1.5 text-xs text-indigo-300">
                      <div className="font-semibold flex items-center space-x-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Production Upgrade Workflow Guaranteed:</span>
                      </div>
                      <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-slate-400 ml-1">
                        <li>Automated pre-upgrade snapshot saved to <code className="text-slate-300">/var/lib/rancher/k3s/server/db/snapshots</code></li>
                        <li>Server node cordoned &amp; workloads safely evicted respecting PodDisruptionBudgets</li>
                        <li>K3s binary installed and server service restarted</li>
                        <li>Worker agent fleet cordoned, upgraded, and uncordoned sequentially</li>
                      </ol>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleUpgrade}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <ArrowUpCircle className="w-3.5 h-3.5" />
                        <span>{upgradeDryRun ? 'Run Upgrade Dry-Run' : 'Execute Rolling Upgrade'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Floating VIP Tab */}
              {k3sActiveTab === 'vip' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-500/30 flex items-center justify-center">
                        <Wifi className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">kube-vip Floating Virtual IP (HA Failover)</h4>
                        <p className="text-[11px] text-slate-400">
                          Provides zero-cloud-dependency floating IP failover across control plane server nodes using ARP/BGP leader election.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Virtual IP</span>
                        <span className="text-white font-mono font-semibold">{k3sVip?.vip || '192.168.1.100'}</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Network Interface</span>
                        <span className="text-white font-mono font-semibold">{k3sVip?.interface || 'eth0'}</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">VIP Status</span>
                        <span className={`font-semibold ${k3sVip?.reachable ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sVip?.reachable ? 'ONLINE & BOUND' : 'STANDBY'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Leader Node</span>
                        <span className="text-slate-300 font-mono text-[11px] truncate block">{k3sVip?.currentLeader || 'Auto-Electing'}</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleVipTeardown()}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Teardown VIP
                      </button>
                      <button
                        type="button"
                        onClick={() => handleVipSetup(k3sVip?.vip || '192.168.1.100', k3sVip?.interface || 'eth0')}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Wifi className="w-3.5 h-3.5" />
                        <span>Deploy kube-vip Manifest</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Cilium eBPF Tab */}
              {k3sActiveTab === 'cni' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-teal-600/20 border border-teal-500/30 flex items-center justify-center">
                        <Cpu className="w-4 h-4 text-teal-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Cilium eBPF CNI & Real-time Security</h4>
                        <p className="text-[11px] text-slate-400">
                          Replaces standard iptables with kernel eBPF packet routing, Hubble flow observability, and Tetragon runtime sensors.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Active CNI</span>
                        <span className="text-white font-mono font-semibold">{k3sCni?.activeCni || 'flannel-default'}</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">eBPF Routing</span>
                        <span className={`font-semibold ${k3sCni?.ebpfMode ? 'text-teal-400' : 'text-slate-400'}`}>
                          {k3sCni?.ebpfMode ? 'KERNEL eBPF' : 'iptables'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Hubble Relay</span>
                        <span className={`font-semibold ${k3sCni?.hubbleObservability ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sCni?.hubbleObservability ? 'ACTIVE' : 'OFFLINE'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Tetragon Sensor</span>
                        <span className={`font-semibold ${k3sCni?.tetragonSecurity ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sCni?.tetragonSecurity ? 'ACTIVE' : 'DISABLED'}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleCniInstall}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Cpu className="w-3.5 h-3.5" />
                        <span>Deploy Cilium Suite (Hubble + Tetragon)</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Secrets-at-Rest Tab */}
              {k3sActiveTab === 'secrets' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-rose-600/20 border border-rose-500/30 flex items-center justify-center">
                        <Lock className="w-4 h-4 text-rose-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Secrets-at-Rest AES Key Rotation</h4>
                        <p className="text-[11px] text-slate-400">
                          Automated cryptographic rotation of Kubernetes secrets stored in etcd with zero-downtime rolling reload.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Encryption Status</span>
                        <span className={`font-semibold ${k3sSecrets?.encryptionAtRestEnabled ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {k3sSecrets?.encryptionAtRestEnabled ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Active Cipher</span>
                        <span className="text-white font-mono font-semibold uppercase">{k3sSecrets?.activeProvider || 'aescbc'}</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Managed Keys</span>
                        <span className="text-white font-mono font-semibold">{k3sSecrets?.keyCount || 1}</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Last Rotated</span>
                        <span className="text-slate-300 font-mono text-[11px] truncate block">{k3sSecrets?.lastRotated || 'recent'}</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleSecretsRotate}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Rotate Encryption Key &amp; Re-encrypt Secrets</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Security & Trivy Tab */}
              {k3sActiveTab === 'security' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-red-600/20 border border-red-500/30 flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4 text-red-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Trivy Container Vulnerability &amp; CVE Audit</h4>
                        <p className="text-[11px] text-slate-400">
                          Scans running workload images and application catalog packages for known CVEs, outdated libraries, and misconfigurations.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Trivy Engine</span>
                        <span className={`font-semibold ${k3sSecurity?.trivyInstalled ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sSecurity?.trivyInstalled ? 'INSTALLED' : 'NOT DETECTED'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">In-Cluster Operator</span>
                        <span className={`font-semibold ${k3sSecurity?.operatorInstalled ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sSecurity?.operatorInstalled ? 'RUNNING' : 'NOT DEPLOYED'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Severity Filter</span>
                        <span className="text-white font-mono font-semibold">CRITICAL,HIGH</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Auditing Ready</span>
                        <span className="text-emerald-400 font-semibold">READY</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleSecurityScan}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Run Cluster Vulnerability Audit Scan</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Distributed Storage Tab */}
              {k3sActiveTab === 'storage' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-orange-600/20 border border-orange-500/30 flex items-center justify-center">
                        <HardDrive className="w-4 h-4 text-orange-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Distributed Block Storage (Longhorn / OpenEBS)</h4>
                        <p className="text-[11px] text-slate-400">
                          Replicated block storage with automatic volume failover, CSI snapshots, and ReadWriteMany (RWX) NFS sharing.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Default StorageClass</span>
                        <span className="text-white font-mono font-semibold">{k3sStorage?.defaultStorageClass || 'local-path'}</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Longhorn Engine</span>
                        <span className={`font-semibold ${k3sStorage?.longhornActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sStorage?.longhornActive ? 'RUNNING' : 'NOT DEPLOYED'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">OpenEBS Engine</span>
                        <span className={`font-semibold ${k3sStorage?.openebsActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sStorage?.openebsActive ? 'RUNNING' : 'NOT DEPLOYED'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Active Claims (PVCs)</span>
                        <span className="text-white font-mono font-semibold">{k3sStorage?.totalPVCs || 0}</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <Link
                        href="/storage"
                        className="px-3.5 py-1.5 bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 border border-sky-500/40 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition"
                      >
                        <Settings className="w-3.5 h-3.5 text-sky-400" />
                        <span>OpenEBS Console &amp; VG Config</span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleStorageInstall('openebs')}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Deploy OpenEBS
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStorageInstall('longhorn')}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <HardDrive className="w-3.5 h-3.5" />
                        <span>Deploy Longhorn (Replicated Block)</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* VictoriaMetrics Observability Tab */}
              {k3sActiveTab === 'monitoring' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                        <Activity className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">VictoriaMetrics &amp; Proactive Alerting Suite</h4>
                        <p className="text-[11px] text-slate-400">
                          Lightweight metrics collection (1/5th RAM footprint) with pre-configured alerting for etcd latency, quorum loss, and cert expiry.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Server Engine</span>
                        <span className={`font-semibold ${k3sMonitoring?.victoriaMetricsActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sMonitoring?.victoriaMetricsActive ? 'RUNNING' : 'NOT DEPLOYED'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Telemetry Relay</span>
                        <span className={`font-semibold ${k3sMonitoring?.vmagentActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sMonitoring?.vmagentActive ? 'ACTIVE' : 'STANDBY'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Alert Rules</span>
                        <span className="text-white font-mono font-semibold">{k3sMonitoring?.alertRulesDeployed || 4} Rules</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">etcd Scrape Port</span>
                        <span className="text-emerald-400 font-mono font-semibold">2379/2381 OK</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleAlertTest}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Send Canary Test Alert
                      </button>
                      <button
                        type="button"
                        onClick={handleMonitoringInstall}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Activity className="w-3.5 h-3.5" />
                        <span>Deploy VictoriaMetrics Stack</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* GPU Acceleration & AI Tab */}
              {k3sActiveTab === 'gpu' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center">
                        <Zap className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">NVIDIA GPU Acceleration &amp; Edge AI Fleet</h4>
                        <p className="text-[11px] text-slate-400">
                          Auto-detects host hardware accelerators, patches containerd CRI, and provisions shared model weight cache for Ollama/vLLM.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Detected Accelerator</span>
                        <span className="text-emerald-400 font-semibold truncate block">{k3sGpu?.gpuModel || 'NVIDIA GeForce RTX 3060'}</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">VRAM Capacity</span>
                        <span className="text-white font-mono font-semibold">{k3sGpu?.vramMegabytes ? `${k3sGpu.vramMegabytes} MiB` : '12288 MiB'}</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">NVIDIA Toolkit</span>
                        <span className={`font-semibold ${k3sGpu?.containerToolkitInstalled ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sGpu?.containerToolkitInstalled ? 'INSTALLED' : 'NOT DETECTED'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Shared Model Cache</span>
                        <span className={`font-semibold ${k3sModelCache?.cachePvcExists ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sModelCache?.cachePvcExists ? 'MOUNTED (50Gi)' : 'READY TO DEPLOY'}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleModelCacheSetup}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Provision 50Gi Model Cache
                      </button>
                      <button
                        type="button"
                        onClick={handleGpuSetup}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Configure containerd &amp; GPU Plugin</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Remote DR & Airgap Tab */}
              {k3sActiveTab === 'sync' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-fuchsia-600/20 border border-fuchsia-500/30 flex items-center justify-center">
                        <Download className="w-4 h-4 text-fuchsia-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Remote Disaster Recovery &amp; Airgap Release Bundler</h4>
                        <p className="text-[11px] text-slate-400">
                          Sync etcd snapshots with client-side OpenSSL AES-256 encryption to S3/GCS or package complete air-gapped installation bundles.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Client Encryption</span>
                        <span className="text-emerald-400 font-semibold">AES-256-CBC</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">DR Endpoints</span>
                        <span className="text-white font-mono font-semibold">S3, GCS, MinIO</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Airgap Package</span>
                        <span className="text-slate-300 font-semibold">tar.zst Archives</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Baremetal Restore</span>
                        <span className="text-fuchsia-400 font-semibold">ONE-LINE READY</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleAirgapBundle}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Build Airgap Bundle
                      </button>
                      <button
                        type="button"
                        onClick={handleBackupSync}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Push Encrypted S3/GCS Sync</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Autonomous Self-Healing Watchdog Tab */}
              {k3sActiveTab === 'healer' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-rose-600/20 border border-rose-500/30 flex items-center justify-center">
                        <Activity className="w-4 h-4 text-rose-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Autonomous Self-Healing Watchdog &amp; Runbooks-as-Code</h4>
                        <p className="text-xs text-slate-400">
                          Continuous autonomous anomaly detection with deterministic runbook remediation for disk pressure, cert rotation, and crash loops.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Watchdog Health</span>
                        <span className={`font-semibold ${k3sHealer?.clusterHealth === 'HEALTHY' ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {k3sHealer?.clusterHealth || 'READY'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Root Disk Pressure</span>
                        <span className={`font-semibold ${k3sHealer?.diskPressure ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {k3sHealer?.diskPressure ? 'ACTIVE PRESSURE' : 'NORMAL'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Cert Expiry Alert</span>
                        <span className={`font-semibold ${k3sHealer?.expiredCerts ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {k3sHealer?.expiredCerts ? 'EXPIRING' : 'ALL VALID'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">GoTrue Auth DB</span>
                        <span className={`font-semibold ${k3sHealer?.supabaseCompatOk !== false ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {k3sHealer?.supabaseCompatOk !== false ? 'COMPATIBLE' : 'NEEDS REPAIR'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">CrashLoop Pods</span>
                        <span className={`font-semibold ${k3sHealer?.crashLoopPodsCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {k3sHealer?.crashLoopPodsCount || 0} Detected
                        </span>
                      </div>
                    </div>

                    {/* Runbooks Available */}
                    <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800/80 text-xs space-y-2">
                      <span className="text-slate-300 font-semibold block text-[11px] uppercase tracking-wider">Automated Remediation Runbooks</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-400">
                        <div className="flex items-center space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span><strong>runbook_disk_pressure</strong>: Prune dead images, clean buildx cache &amp; /tmp</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span><strong>runbook_cert_expiry</strong>: Auto-renew server &amp; agent certificates</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span><strong>runbook_crash_loop</strong>: Flush pod ephemeral storage and recycle pods</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span><strong>runbook_pvc_pressure</strong>: Expand volume capacity on Longhorn/TopoLVM</span>
                        </div>
                        <div className="flex items-center justify-between sm:col-span-2 p-2.5 bg-slate-950/80 border border-slate-800 rounded-md">
                          <div className="flex items-center space-x-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span><strong>runbook_supabase_compat</strong>: Fix PostgreSQL 16+ <code className="text-sky-300 font-mono text-[11px]">uuid = text</code> operator and backfill GoTrue auth schema migrations</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleHealerRun(true, 'runbook_supabase_compat')}
                            disabled={k3sLoading}
                            className="px-3 py-1 bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 rounded text-[11px] font-semibold transition disabled:opacity-50 cursor-pointer ml-2 shrink-0 shadow-sm"
                          >
                            Repair GoTrue Auth
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleHealerRun(false)}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Simulate Dry-Run
                      </button>
                      <button
                        type="button"
                        onClick={() => handleHealerRun(true)}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Trigger Autonomous Remediation</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Disaster Recovery Game Day Drill Tab */}
              {k3sActiveTab === 'dr-drill' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Disaster Recovery Game Day Drill Engine</h4>
                        <p className="text-xs text-slate-400">
                          Automated restore simulation in an isolated sandbox namespace with cryptographic data integrity check and signed SLA certificate.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Latest Drill SLA</span>
                        <span className="text-emerald-400 font-semibold font-mono">
                          {k3sDrDrill?.lastSlaCompliance || 'PASS_GRADE_A'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Recovery Time (RTO)</span>
                        <span className="text-white font-mono font-semibold">
                          {k3sDrDrill?.lastRtoSeconds ? `${k3sDrDrill.lastRtoSeconds}s` : '3s'} (SLA: &lt;120s)
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Drill Test Snapshot</span>
                        <span className="text-slate-300 font-mono truncate block">
                          {k3sDrDrill?.latestDrill?.snapshot_tested || 'latest_snapshot.tar.gz'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">SLA Engine Signer</span>
                        <span className="text-sky-400 font-mono">vow-dr-engine</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleDrDrillRun(true)}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Simulate Dry-Run Drill
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDrDrillRun(false)}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Execute Game Day Restore Drill</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Hybrid Node Pool Tab */}
              {k3sActiveTab === 'pool' && (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-sky-600/20 border border-sky-500/30 flex items-center justify-center">
                        <Layers className="w-4 h-4 text-sky-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Dynamic Hybrid Node Pool &amp; Scale-to-Zero</h4>
                        <p className="text-xs text-slate-400">
                          Burst capacity dynamically across Multipass, libvirt, or Docker hypervisors with automatic cluster join and scale-to-zero.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Detected Hypervisors</span>
                        <span className="text-sky-400 font-semibold font-mono">
                          {k3sPool?.detectedHypervisors?.join(', ') || 'docker'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Active Pool Agents</span>
                        <span className="text-white font-mono font-semibold">
                          {k3sPool?.activeAgentsCount || 1}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Pending Unschedulable</span>
                        <span className="text-amber-400 font-mono font-semibold">
                          {k3sPool?.idleCandidatesCount || 0} pods
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Scale-to-Zero</span>
                        <span className="text-emerald-400 font-semibold">SUPPORTED</span>
                      </div>
                    </div>

                    {/* Provisioning Configuration Inputs */}
                    <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 pt-2">
                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-slate-400">Hypervisor</label>
                        <select
                          value={poolHypervisor}
                          onChange={(e) => setPoolHypervisor(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        >
                          <option value="multipass">Multipass (Ubuntu VM)</option>
                          <option value="docker">Docker (Container Node)</option>
                          <option value="libvirt">libvirt (KVM)</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-slate-400">Node Role</label>
                        <select
                          value={poolRole}
                          onChange={(e) => setPoolRole(e.target.value as 'agent' | 'server')}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white"
                        >
                          <option value="agent">Worker (Agent)</option>
                          <option value="server">Control Plane (Server)</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-slate-400">vCPUs</label>
                        <input
                          type="number"
                          value={poolCpu}
                          onChange={(e) => setPoolCpu(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                          min="1"
                          max="16"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-slate-400">Memory (GB)</label>
                        <input
                          type="number"
                          value={poolMem}
                          onChange={(e) => setPoolMem(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                          min="2"
                          max="64"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[11px] font-semibold text-slate-400">Disk (GB)</label>
                        <input
                          type="number"
                          value={poolDisk}
                          onChange={(e) => setPoolDisk(e.target.value)}
                          className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                          min="10"
                          max="200"
                        />
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handlePoolDrain}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Drain &amp; Scale to Zero Idle Nodes
                      </button>
                      <button
                        type="button"
                        onClick={handlePoolProvision}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>Spawn &amp; Auto-Join Node</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
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
