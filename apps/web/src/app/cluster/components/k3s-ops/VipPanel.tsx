'use client';

import {
  Wifi,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function VipPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, k3sVip, handleVipSetup, handleVipTeardown } = state;
  return (
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
  );
}
