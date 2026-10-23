'use client';

import {
  CheckCircle2,
  Activity,
  Zap,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function HealerPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, k3sHealer, handleHealerRun } = state;
  return (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-rose-600/20 border border-rose-500/30 flex items-center justify-center">
                        <Activity className="w-4 h-4 text-rose-400" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white">Autonomous Self-Healing Watchdog &amp; Runbooks-as-Code</h4>
                        <p className="text-xs text-slate-400">
                          Continuous autonomous anomaly detection with deterministic runbook remediation for disk pressure, cert rotation, and crash loops.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Watchdog Health</span>
                        <span className={`font-semibold ${k3sHealer?.clusterHealth === 'HEALTHY' ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {k3sHealer?.clusterHealth || 'READY'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Root Disk Pressure</span>
                        <span className={`font-semibold ${k3sHealer?.diskPressure ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {k3sHealer?.diskPressure ? 'ACTIVE PRESSURE' : 'NORMAL'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Cert Expiry Alert</span>
                        <span className={`font-semibold ${k3sHealer?.expiredCerts ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {k3sHealer?.expiredCerts ? 'EXPIRING' : 'ALL VALID'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">GoTrue Auth DB</span>
                        <span className={`font-semibold ${k3sHealer?.supabaseCompatOk !== false ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {k3sHealer?.supabaseCompatOk !== false ? 'COMPATIBLE' : 'NEEDS REPAIR'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">CrashLoop Pods</span>
                        <span className={`font-semibold ${k3sHealer?.crashLoopPodsCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                          {k3sHealer?.crashLoopPodsCount || 0} Detected
                        </span>
                      </div>
                    </div>

                    {/* Runbooks Available */}
                    <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800/80 text-xs space-y-2">
                      <span className="text-slate-300 font-semibold block text-[11px] uppercase tracking-wider">Automated Remediation Runbooks</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-400">
                        <div className="flex items-center space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span><strong>runbook_disk_pressure</strong>: Prune dead images, clean buildx cache &amp; /tmp</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span><strong>runbook_cert_expiry</strong>: Auto-renew server &amp; agent certificates</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span><strong>runbook_crash_loop</strong>: Flush pod ephemeral storage and recycle pods</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                          <span><strong>runbook_pvc_pressure</strong>: Expand volume capacity on Longhorn/TopoLVM</span>
                        </div>
                        <div className="flex items-center justify-between sm:col-span-2 p-2.5 bg-slate-950/80 border border-slate-800 rounded-md">
                          <div className="flex items-center space-x-2">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                            <span><strong>runbook_supabase_compat</strong>: Fix PostgreSQL 16+ <code className="text-sky-300 font-mono text-[11px]">uuid = text</code> operator and backfill GoTrue auth schema migrations</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleHealerRun(true, 'runbook_supabase_compat')}
                            disabled={k3sLoading}
                            className="px-3 py-1 bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/60 rounded text-[11px] font-semibold transition disabled:opacity-50 cursor-pointer ml-2 shrink-0 shadow-sm"
                          >
                            Repair GoTrue Auth
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleHealerRun(false)}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Simulate Dry-Run
                      </button>
                      <button
                        type="button"
                        onClick={() => handleHealerRun(true)}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Zap className="w-3.5 h-3.5" />
                        <span>Trigger Autonomous Remediation</span>
                      </button>
                    </div>
                  </div>
                </div>
  );
}
