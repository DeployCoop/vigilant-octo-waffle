'use client';

import {
  Layers,
  PlusCircle,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function PoolPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, k3sPool, poolHypervisor, setPoolHypervisor, poolRole, setPoolRole, poolCpu, setPoolCpu, poolMem, setPoolMem, poolDisk, setPoolDisk, handlePoolProvision, handlePoolDrain } = state;
  return (
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
  );
}
