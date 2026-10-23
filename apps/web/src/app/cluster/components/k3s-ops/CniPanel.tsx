'use client';

import {
  Cpu,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function CniPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, k3sCni, handleCniInstall } = state;
  return (
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
  );
}
