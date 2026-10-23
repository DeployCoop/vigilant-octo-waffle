'use client';

import {
  Zap,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function GpuPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, k3sGpu, k3sModelCache, handleGpuSetup, handleModelCacheSetup } = state;
  return (
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
  );
}
