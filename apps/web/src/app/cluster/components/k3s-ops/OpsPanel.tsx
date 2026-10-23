'use client';

import {
  Layers,
  Zap,
  RotateCcw,
  Trash2,
  Wifi,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function OpsPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, handleK3sOp } = state;
  return (
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
  );
}
