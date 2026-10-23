'use client';

import {
  Layers,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function BatchPanel({ state }: { state: ClusterPageState }) {
  const { k3sBatchTargets, setK3sBatchTargets, k3sTargetsFile, setK3sTargetsFile, k3sParallel, setK3sParallel, k3sTune, setK3sTune, k3sCopyRegistries, setK3sCopyRegistries, k3sCopyKubeconfig, setK3sCopyKubeconfig, k3sLoading, handleBatchJoin } = state;
  return (
                <div className="space-y-4 p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-400">
                    Batch provision and join multiple nodes in parallel using a targets file or direct host list:
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">Targets File Path</label>
                      <input
                        type="text"
                        value={k3sTargetsFile}
                        onChange={(e) => setK3sTargetsFile(e.target.value)}
                        placeholder="targets or targets.txt"
                        className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">Parallel Jobs (-j)</label>
                      <input
                        type="number"
                        value={k3sParallel}
                        onChange={(e) => setK3sParallel(e.target.value)}
                        min="1"
                        max="100"
                        placeholder="10"
                        className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">Or Direct Targets List (one host/IP per line)</label>
                    <textarea
                      value={k3sBatchTargets}
                      onChange={(e) => setK3sBatchTargets(e.target.value)}
                      rows={3}
                      placeholder="root@192.168.1.50&#10;root@192.168.1.51&#10;192.168.1.52"
                      className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg p-2 text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-800">
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={k3sTune}
                        onChange={(e) => setK3sTune(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0"
                      />
                      <span>Auto-tune NVMe & Limits</span>
                    </label>
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={k3sCopyRegistries}
                        onChange={(e) => setK3sCopyRegistries(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0"
                      />
                      <span>Deploy Registries</span>
                    </label>
                    <label className="flex items-center space-x-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={k3sCopyKubeconfig}
                        onChange={(e) => setK3sCopyKubeconfig(e.target.checked)}
                        className="rounded bg-slate-900 border-slate-700 text-purple-600 focus:ring-0"
                      />
                      <span>Sync Kubeconfig</span>
                    </label>
                  </div>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleBatchJoin}
                      disabled={k3sLoading}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-40 cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>{k3sLoading ? 'Provisioning...' : 'Provision All Targets'}</span>
                    </button>
                  </div>
                </div>
  );
}
