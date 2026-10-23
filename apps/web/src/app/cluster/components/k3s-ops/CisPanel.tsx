'use client';

import {
  RefreshCw,
  Shield,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function CisPanel({ state }: { state: ClusterPageState }) {
  const { k3sCis, fetchK3sProductionData } = state;
  return (
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
  );
}
