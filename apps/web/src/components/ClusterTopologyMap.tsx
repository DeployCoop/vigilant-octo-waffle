'use client';

import React, { useState } from 'react';
import {
  Server,
  Cpu,
  Layers,
  Activity,
  Terminal,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  X,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { soundFx } from '@/lib/audio';
import { useTerminal } from '@/context/TerminalContext';

interface NodeItem {
  name: string;
  status: string;
  roles?: string[];
  role?: string;
  osImage?: string;
  internalIp?: string;
  version?: string;
}

interface PodItem {
  name: string;
  namespace: string;
  node: string;
  status: string;
  ready: string;
  restarts: number;
}

interface ClusterTopologyMapProps {
  nodes?: NodeItem[];
  pods?: PodItem[];
  onRefresh?: () => void;
  loading?: boolean;
}

export const ClusterTopologyMap: React.FC<ClusterTopologyMapProps> = ({
  nodes = [],
  pods = [],
  onRefresh,
  loading = false,
}) => {
  const [selectedNode, setSelectedNode] = useState<NodeItem | null>(null);
  const [selectedPod, setSelectedPod] = useState<PodItem | null>(null);
  const { openTerminal } = useTerminal();

  const getNodeRoles = (node?: NodeItem | null): string[] => {
    if (!node) return [];
    if (Array.isArray(node.roles)) return node.roles;
    if (node.role) return [node.role];
    return [];
  };

  const isMasterNode = (node: NodeItem) => {
    const roles = getNodeRoles(node);
    const name = (node.name || '').toLowerCase();
    return (
      roles.some((r) => r.includes('control') || r.includes('master') || r.includes('server')) ||
      name.includes('server') ||
      name.includes('master') ||
      name.includes('control')
    );
  };

  const handleNodeClick = (node: NodeItem) => {
    soundFx.playClick();
    setSelectedNode(node);
    setSelectedPod(null);
  };

  const handlePodClick = (pod: PodItem) => {
    soundFx.playClick();
    setSelectedPod(pod);
  };

  const closeDrawer = () => {
    soundFx.playClick();
    setSelectedNode(null);
    setSelectedPod(null);
  };

  const safeNodes = Array.isArray(nodes) ? nodes : [];
  const masterNode = safeNodes.find(isMasterNode) || safeNodes[0];
  const workerNodes = safeNodes.filter((n) => n.name !== masterNode?.name);

  // Group pods by node
  const podsByNode: Record<string, PodItem[]> = {};
  for (const pod of (pods || [])) {
    const n = pod.node || 'unassigned';
    if (!podsByNode[n]) podsByNode[n] = [];
    podsByNode[n].push(pod);
  }

  return (
    <div className="relative w-full rounded-2xl glass-panel p-5 overflow-hidden border border-cyan-500/20 shadow-[0_0_30px_rgba(56,189,248,0.08)]">
      {/* Background Radar Grid Overlay */}
      <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none" />

      {/* Header bar */}
      <div className="flex items-center justify-between mb-4 relative z-10">
        <div className="flex items-center gap-2.5">
          <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-500/40">
            <Layers className="w-4 h-4 text-cyan-400" />
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping opacity-75" />
            <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-mono font-bold text-slate-100 flex items-center gap-2">
              CLUSTER TOPOLOGY & ORBITAL NODE MAP
              <span className="px-2 py-0.5 rounded text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                LIVE 2D TOPOLOGY
              </span>
            </h3>
            <p className="text-xs text-slate-400 font-mono">
              Click any node or pod satellite to inspect live state and stream logs
            </p>
          </div>
        </div>

        {onRefresh && (
          <button
            onClick={() => {
              soundFx.playSonarPing();
              onRefresh();
            }}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 text-xs font-mono text-slate-300 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            <span>SWEEP SCAN</span>
          </button>
        )}
      </div>

      {/* Main Visual Topology Area */}
      <div className="relative min-h-[260px] flex items-center justify-around py-6 px-4 z-10">
        {safeNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 border border-dashed border-cyan-500/30 rounded-2xl bg-slate-900/60 text-center max-w-md my-4">
            <div className="w-12 h-12 rounded-xl bg-cyan-950/80 border border-cyan-500/40 flex items-center justify-center text-cyan-400 mb-3 shadow-[0_0_15px_rgba(56,189,248,0.2)]">
              <Server className="w-6 h-6 animate-pulse" />
            </div>
            <h4 className="text-sm font-mono font-bold text-slate-100 uppercase tracking-wider">
              CLUSTER STANDBY / OFFLINE
            </h4>
            <p className="text-xs text-slate-400 font-mono mt-1.5 leading-relaxed">
              No active Kubernetes nodes detected. Click &apos;Run Full Deployment&apos; or &apos;Create Cluster&apos; to bring nodes and workloads online.
            </p>
          </div>
        ) : (
          <>
            {/* Decorative connecting energy beams */}
            <div className="absolute inset-x-12 top-1/2 -translate-y-1/2 h-[2px] bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent pointer-events-none" />

            {/* Master / Control-Plane Node */}
            {masterNode && (
              <div className="flex flex-col items-center relative group">
                {/* Orbital Pulses */}
                <div className="absolute -inset-4 rounded-full border border-cyan-500/20 animate-sonar pointer-events-none" />
                <div className="absolute -inset-8 rounded-full border border-dashed border-cyan-500/10 animate-orbit-cw pointer-events-none" />

                <button
                  onClick={() => handleNodeClick(masterNode)}
                  className={`relative z-10 flex flex-col items-center p-4 rounded-2xl transition-all duration-300 ${
                    selectedNode?.name === masterNode.name
                      ? 'bg-cyan-950/90 border-2 border-cyan-400 shadow-[0_0_25px_rgba(56,189,248,0.4)] scale-105'
                      : 'bg-slate-900/90 border border-cyan-500/40 hover:border-cyan-400 hover:shadow-[0_0_15px_rgba(56,189,248,0.25)]'
                  }`}
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/30 flex items-center justify-center border border-cyan-500/40 mb-2">
                    <Server className="w-6 h-6 text-cyan-300" />
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-100">{masterNode.name}</span>
                  <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest mt-0.5">
                    CONTROL PLANE
                  </span>
                  <span className="mt-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    {masterNode.status || 'Ready'}
                  </span>
                </button>

                {/* Satellites (Pods around Master) */}
                <div className="flex items-center gap-1.5 mt-3">
                  {(podsByNode[masterNode.name] || []).slice(0, 5).map((pod) => (
                    <button
                      key={pod.name}
                      onClick={() => handlePodClick(pod)}
                      title={`${pod.namespace}/${pod.name} (${pod.status})`}
                      className={`w-3.5 h-3.5 rounded-full transition-transform hover:scale-125 border ${
                        pod.status === 'Running'
                          ? 'bg-emerald-400 border-emerald-300 shadow-[0_0_6px_#10b981]'
                          : 'bg-amber-400 border-amber-300'
                      }`}
                    />
                  ))}
                  {(podsByNode[masterNode.name] || []).length > 5 && (
                    <span className="text-[9px] font-mono text-slate-400">
                      +{podsByNode[masterNode.name].length - 5}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Worker Nodes */}
            {workerNodes.length > 0 ? (
              workerNodes.map((node) => (
                <div key={node.name} className="flex flex-col items-center relative group">
                  <button
                    onClick={() => handleNodeClick(node)}
                    className={`relative z-10 flex flex-col items-center p-3.5 rounded-xl transition-all duration-300 ${
                      selectedNode?.name === node.name
                        ? 'bg-purple-950/90 border-2 border-purple-400 shadow-[0_0_20px_rgba(168,85,247,0.4)] scale-105'
                        : 'bg-slate-900/90 border border-slate-700/80 hover:border-purple-400 hover:shadow-[0_0_12px_rgba(168,85,247,0.2)]'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-indigo-600/30 flex items-center justify-center border border-purple-500/40 mb-1.5">
                      <Cpu className="w-5 h-5 text-purple-300" />
                    </div>
                    <span className="text-xs font-mono font-bold text-slate-100">{node.name}</span>
                    <span className="text-[9px] font-mono text-purple-400 uppercase tracking-wider mt-0.5">
                      WORKER NODE
                    </span>
                    <span className="mt-1 px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      {node.status || 'Ready'}
                    </span>
                  </button>

                  {/* Satellites (Pods around Worker) */}
                  <div className="flex items-center gap-1.5 mt-2.5">
                    {(podsByNode[node.name] || []).slice(0, 4).map((pod) => (
                      <button
                        key={pod.name}
                        onClick={() => handlePodClick(pod)}
                        title={`${pod.namespace}/${pod.name} (${pod.status})`}
                        className={`w-3 h-3 rounded-full transition-transform hover:scale-125 border ${
                          pod.status === 'Running'
                            ? 'bg-emerald-400 border-emerald-300 shadow-[0_0_6px_#10b981]'
                            : 'bg-amber-400 border-amber-300'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              ))
            ) : masterNode ? (
              <div className="flex flex-col items-center justify-center p-4 border border-dashed border-slate-700/60 rounded-xl bg-slate-900/40">
                <span className="text-xs font-mono text-slate-400">Single-Node K3s Cluster</span>
                <span className="text-[10px] font-mono text-slate-500 mt-0.5">Control Plane & Workloads Colocated</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* Slide-out Inspector Drawer */}
      {(selectedNode || selectedPod) && (
        <div className="relative mt-4 p-4 rounded-xl bg-slate-950/90 border border-cyan-500/40 shadow-xl z-20 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <span className="text-xs font-mono font-bold text-slate-100 uppercase">
                {selectedNode ? `NODE TELEMETRY: ${selectedNode.name}` : `POD TELEMETRY: ${selectedPod?.name}`}
              </span>
            </div>
            <button
              onClick={closeDrawer}
              className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {selectedNode && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
              <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">STATUS</span>
                <span className="text-emerald-400 font-bold">{selectedNode.status || 'Ready'}</span>
              </div>
              <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">ROLES</span>
                <span className="text-cyan-300">{getNodeRoles(selectedNode).join(', ') || 'worker'}</span>
              </div>
              <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">POD DENSITY</span>
                <span className="text-purple-300">{(podsByNode[selectedNode.name] || []).length} active pods</span>
              </div>
              <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                <span className="text-slate-400 block text-[10px]">OS / KERNEL</span>
                <span className="text-slate-300 truncate block">{selectedNode.osImage || 'Linux'}</span>
              </div>
            </div>
          )}

          {selectedPod && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">NAMESPACE</span>
                  <span className="text-cyan-300 font-bold">{selectedPod.namespace}</span>
                </div>
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">PHASE</span>
                  <span className="text-emerald-400 font-bold">{selectedPod.status}</span>
                </div>
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">READY</span>
                  <span className="text-slate-200">{selectedPod.ready}</span>
                </div>
                <div className="p-2 rounded bg-slate-900/60 border border-slate-800">
                  <span className="text-slate-400 block text-[10px]">RESTARTS</span>
                  <span className={selectedPod.restarts > 0 ? 'text-amber-400' : 'text-slate-400'}>
                    {selectedPod.restarts}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 mt-2">
                <button
                  onClick={() => {
                    soundFx.playClick();
                    openTerminal(`kubectl logs ${selectedPod.name} -n ${selectedPod.namespace} --tail=100 -f`);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-600/30 hover:bg-cyan-600/50 border border-cyan-500/50 text-xs font-mono text-cyan-200 transition-all"
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>STREAM CONTAINER LOGS</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
