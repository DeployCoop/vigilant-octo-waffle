'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Network,
  RefreshCw,
  Layers,
  ArrowRight,
  ExternalLink,
  Cpu,
  Globe,
  Info,
  CheckCircle2,
  AlertCircle,
  X,
  Wifi,
  HardDrive,
  Zap,
  Shield,
} from 'lucide-react';

interface TopologyNode {
  id: string;
  name: string;
  category: string;
  layer: 1 | 2 | 3 | 4;
  layerName: string;
  enabled: boolean;
  subdomain?: string;
  ingressUrl?: string;
  estimatedMemoryMb?: number;
  dependencies: string[];
}

interface TopologyEdge {
  id: string;
  source: string;
  target: string;
  type: string;
}

interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  layers: { layer: 1 | 2 | 3 | 4; name: string; nodeCount: number }[];
}

export default function TopologyPage() {
  const [data, setData] = useState<TopologyGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedLayer, setSelectedLayer] = useState<number | 'all'>('all');
  const [onlyEnabled, setOnlyEnabled] = useState(false);
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null);
  const [infra, setInfra] = useState<any>({
    vip: null,
    cni: null,
    storage: null,
    gpu: null,
  });

  const fetchTopology = async () => {
    setLoading(true);
    try {
      const [res, vipRes, cniRes, storRes, gpuRes] = await Promise.all([
        fetch('/api/topology'),
        fetch('/api/cluster/k3s?action=vip'),
        fetch('/api/cluster/k3s?action=cni'),
        fetch('/api/cluster/k3s?action=storage'),
        fetch('/api/cluster/k3s?action=gpu'),
      ]);
      const [json, vip, cni, storage, gpu] = await Promise.all([
        res.json(),
        vipRes.json(),
        cniRes.json(),
        storRes.json(),
        gpuRes.json(),
      ]);
      setData(json);
      setInfra({ vip, cni, storage, gpu });
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTopology();
  }, []);

  const nodes = data?.nodes || [];
  const edges = data?.edges || [];

  const filteredNodes = nodes.filter((n) => {
    if (selectedLayer !== 'all' && n.layer !== selectedLayer) return false;
    if (onlyEnabled && !n.enabled) return false;
    return true;
  });

  const getLayerColor = (layer: number) => {
    switch (layer) {
      case 1:
        return 'from-sky-500/20 to-sky-600/10 border-sky-500/30 text-sky-400';
      case 2:
        return 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-400';
      case 3:
        return 'from-violet-500/20 to-violet-600/10 border-violet-500/30 text-violet-400';
      case 4:
      default:
        return 'from-amber-500/20 to-amber-600/10 border-amber-500/30 text-amber-400';
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Network className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Interactive Architecture & Topology</h2>
          </div>
          <p className="text-sm text-slate-400">
            Layered dependency graph mapping ingress routing, foundational databases, identity gateways, and application workloads
          </p>
        </div>

        <button
          onClick={fetchTopology}
          disabled={loading}
          className="text-xs px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg flex items-center space-x-2 self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Graph</span>
        </button>
      </div>

      {/* Infrastructure Fabric Status Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
          <div className="flex items-center space-x-1.5 text-xs text-slate-400 font-semibold">
            <Wifi className="w-3.5 h-3.5 text-cyan-400" />
            <span>High-Availability VIP</span>
          </div>
          <div className="text-sm font-bold text-white font-mono">{infra.vip?.vip || '192.168.1.100'}</div>
          <div className="text-[10px] text-slate-500">
            {infra.vip?.reachable ? 'Online (kube-vip)' : 'Standby / Local ARP'}
          </div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
          <div className="flex items-center space-x-1.5 text-xs text-slate-400 font-semibold">
            <Cpu className="w-3.5 h-3.5 text-teal-400" />
            <span>Network &amp; Security</span>
          </div>
          <div className="text-sm font-bold text-white uppercase">{infra.cni?.activeCni || 'Flannel CNI'}</div>
          <div className="text-[10px] text-slate-500">
            {infra.cni?.ebpfMode ? 'Kernel eBPF & Hubble' : 'Standard iptables'}
          </div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
          <div className="flex items-center space-x-1.5 text-xs text-slate-400 font-semibold">
            <HardDrive className="w-3.5 h-3.5 text-orange-400" />
            <span>Distributed Storage</span>
          </div>
          <div className="text-sm font-bold text-white uppercase">{infra.storage?.defaultStorageClass || 'local-path'}</div>
          <div className="text-[10px] text-slate-500">
            {infra.storage?.longhornActive ? 'Longhorn Block Replicas' : 'Host local-path CSI'}
          </div>
        </div>

        <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-xl space-y-1">
          <div className="flex items-center space-x-1.5 text-xs text-slate-400 font-semibold">
            <Zap className="w-3.5 h-3.5 text-emerald-400" />
            <span>Hardware Accelerators</span>
          </div>
          <div className="text-sm font-bold text-emerald-400 truncate">{infra.gpu?.gpuModel || 'NVIDIA RTX 3060'}</div>
          <div className="text-[10px] text-slate-500">
            {infra.gpu?.vramMegabytes ? `${infra.gpu.vramMegabytes} MiB VRAM (CUDA 12.4)` : '12288 MiB VRAM'}
          </div>
        </div>
      </div>

      {/* Filter and Layer Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-900 border border-slate-800 rounded-xl text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-500 font-semibold mr-1">Layer:</span>
          <button
            onClick={() => setSelectedLayer('all')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
              selectedLayer === 'all'
                ? 'bg-sky-500 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            All Layers ({nodes.length})
          </button>
          {[1, 2, 3, 4].map((layerNum) => {
            const count = nodes.filter((n) => n.layer === layerNum).length;
            const names = [
              '',
              '1. Core & Ingress',
              '2. Storage & DBs',
              '3. Gateways & Control',
              '4. Workloads',
            ];
            return (
              <button
                key={layerNum}
                onClick={() => setSelectedLayer(layerNum)}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  selectedLayer === layerNum
                    ? 'bg-sky-500 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {names[layerNum]} ({count})
              </button>
            );
          })}
        </div>

        <label className="flex items-center space-x-2 cursor-pointer text-slate-300 select-none">
          <input
            type="checkbox"
            checked={onlyEnabled}
            onChange={(e) => setOnlyEnabled(e.target.checked)}
            className="rounded border-slate-700 text-sky-500 focus:ring-0"
          />
          <span>Show Enabled Only</span>
        </label>
      </div>

      {/* Layer Columns / Canvas View */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((layerNum) => {
          const layerTitle = [
            '',
            'Layer 1: Core & Ingress',
            'Layer 2: Storage & Persistence',
            'Layer 3: Gateways & Control',
            'Layer 4: Workloads & Apps',
          ][layerNum];

          const layerNodes = filteredNodes.filter((n) => n.layer === layerNum);

          return (
            <div
              key={layerNum}
              className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col space-y-3"
            >
              <div className="pb-3 border-b border-slate-800 flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  {layerTitle}
                </h3>
                <span className="text-[10px] font-mono text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
                  {layerNodes.length}
                </span>
              </div>

              <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[650px] pr-1">
                {layerNodes.map((node) => {
                  const isSelected = selectedNode?.id === node.id;

                  return (
                    <div
                      key={node.id}
                      onClick={() => setSelectedNode(node)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'border-sky-500 bg-sky-950/40 ring-1 ring-sky-500'
                          : node.enabled
                          ? 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                          : 'bg-slate-950/30 border-slate-900 opacity-60'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1">
                        <div>
                          <div className="font-semibold text-xs text-white flex items-center space-x-1.5">
                            <span>{node.name}</span>
                            {node.enabled ? (
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                            ) : null}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{node.category}</div>
                        </div>

                        {node.estimatedMemoryMb && (
                          <span className="text-[10px] font-mono text-slate-500">
                            {node.estimatedMemoryMb}MB
                          </span>
                        )}
                      </div>

                      {node.dependencies.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center space-x-1 text-[10px] text-slate-400">
                          <ArrowRight className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
                          <span className="truncate">Depends on: {node.dependencies.join(', ')}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Node Detail Drawer */}
      {selectedNode && (
        <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-3">
              <div className="p-2.5 bg-slate-800 rounded-lg text-sky-400 border border-slate-700">
                <Network className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{selectedNode.name}</h3>
                <p className="text-xs text-slate-400">{selectedNode.layerName} · {selectedNode.category}</p>
              </div>
            </div>

            <button
              onClick={() => setSelectedNode(null)}
              className="p-1 text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 text-xs">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <span className="text-slate-500 block mb-1">Status</span>
              <span className={`font-semibold ${selectedNode.enabled ? 'text-emerald-400' : 'text-slate-500'}`}>
                {selectedNode.enabled ? 'Enabled in Cluster' : 'Disabled'}
              </span>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <span className="text-slate-500 block mb-1">RAM Footprint</span>
              <span className="font-mono text-sky-400 font-bold">
                {selectedNode.estimatedMemoryMb ? `${selectedNode.estimatedMemoryMb} MB` : 'N/A'}
              </span>
            </div>

            <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg">
              <span className="text-slate-500 block mb-1">Endpoint</span>
              {selectedNode.ingressUrl ? (
                <a
                  href={selectedNode.ingressUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-400 hover:underline flex items-center space-x-1"
                >
                  <span className="truncate">{selectedNode.ingressUrl}</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>
              ) : (
                <span className="text-slate-600">No public ingress</span>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-3 pt-2">
            <Link
              href={`/apps/${selectedNode.id}`}
              className="text-xs px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg transition-colors flex items-center space-x-1.5"
            >
              <span>Inspect Manifests & Overrides</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
