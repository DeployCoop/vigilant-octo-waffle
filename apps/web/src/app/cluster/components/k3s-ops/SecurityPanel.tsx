'use client';

import {
  ShieldCheck,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function SecurityPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, k3sSecurity, handleSecurityScan } = state;
  return (
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
  );
}
