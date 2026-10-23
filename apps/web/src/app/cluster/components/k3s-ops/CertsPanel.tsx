'use client';

import {
  RefreshCw,
  RotateCcw,
  Lock,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function CertsPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, k3sCerts, fetchK3sProductionData, handleRotateCerts } = state;
  return (
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
  );
}
