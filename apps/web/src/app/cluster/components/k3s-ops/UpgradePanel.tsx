'use client';

import {
  ShieldCheck,
  ArrowUpCircle,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function UpgradePanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, upgradeVersion, setUpgradeVersion, upgradeDryRun, setUpgradeDryRun, handleUpgrade } = state;
  return (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                        <ArrowUpCircle className="w-4 h-4 text-indigo-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Zero-Downtime Rolling Upgrade</h4>
                        <p className="text-[11px] text-slate-400">
                          Upgrades control plane and worker nodes sequentially with pre-flight etcd backup and safe pod eviction.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-slate-300">Target K3s Version (Optional)</label>
                        <input
                          type="text"
                          value={upgradeVersion}
                          onChange={(e) => setUpgradeVersion(e.target.value)}
                          placeholder="e.g. v1.31.2+k3s1 (defaults to latest stable)"
                          className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>

                      <div className="flex flex-col justify-end">
                        <label className="flex items-center space-x-2 p-2 bg-slate-900 border border-slate-800 rounded-lg cursor-pointer">
                          <input
                            type="checkbox"
                            checked={upgradeDryRun}
                            onChange={(e) => setUpgradeDryRun(e.target.checked)}
                            className="rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-0"
                          />
                          <div className="text-xs">
                            <span className="font-semibold text-slate-200">Dry-Run Simulation</span>
                            <span className="block text-[11px] text-slate-400">Verify upgrade sequence without applying changes</span>
                          </div>
                        </label>
                      </div>
                    </div>

                    <div className="p-3 bg-indigo-950/30 border border-indigo-900/40 rounded-lg space-y-1.5 text-xs text-indigo-300">
                      <div className="font-semibold flex items-center space-x-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Production Upgrade Workflow Guaranteed:</span>
                      </div>
                      <ol className="list-decimal list-inside space-y-0.5 text-[11px] text-slate-400 ml-1">
                        <li>Automated pre-upgrade snapshot saved to <code className="text-slate-300">/var/lib/rancher/k3s/server/db/snapshots</code></li>
                        <li>Server node cordoned &amp; workloads safely evicted respecting PodDisruptionBudgets</li>
                        <li>K3s binary installed and server service restarted</li>
                        <li>Worker agent fleet cordoned, upgraded, and uncordoned sequentially</li>
                      </ol>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleUpgrade}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <ArrowUpCircle className="w-3.5 h-3.5" />
                        <span>{upgradeDryRun ? 'Run Upgrade Dry-Run' : 'Execute Rolling Upgrade'}</span>
                      </button>
                    </div>
                  </div>
                </div>
  );
}
