'use client';

import {
  Activity,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function MonitoringPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, k3sMonitoring, handleMonitoringInstall, handleAlertTest } = state;
  return (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                        <Activity className="w-4 h-4 text-blue-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">VictoriaMetrics &amp; Proactive Alerting Suite</h4>
                        <p className="text-[11px] text-slate-400">
                          Lightweight metrics collection (1/5th RAM footprint) with pre-configured alerting for etcd latency, quorum loss, and cert expiry.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Server Engine</span>
                        <span className={`font-semibold ${k3sMonitoring?.victoriaMetricsActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sMonitoring?.victoriaMetricsActive ? 'RUNNING' : 'NOT DEPLOYED'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Telemetry Relay</span>
                        <span className={`font-semibold ${k3sMonitoring?.vmagentActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sMonitoring?.vmagentActive ? 'ACTIVE' : 'STANDBY'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Alert Rules</span>
                        <span className="text-white font-mono font-semibold">{k3sMonitoring?.alertRulesDeployed || 4} Rules</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">etcd Scrape Port</span>
                        <span className="text-emerald-400 font-mono font-semibold">2379/2381 OK</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleAlertTest}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Send Canary Test Alert
                      </button>
                      <button
                        type="button"
                        onClick={handleMonitoringInstall}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Activity className="w-3.5 h-3.5" />
                        <span>Deploy VictoriaMetrics Stack</span>
                      </button>
                    </div>
                  </div>
                </div>
  );
}
