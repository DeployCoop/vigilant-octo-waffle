'use client';

import {
  Server,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function SshPanel({ state }: { state: ClusterPageState }) {
  const { k3sSshHost, setK3sSshHost, k3sSshPort, setK3sSshPort, k3sSshKey, setK3sSshKey, k3sTune, setK3sTune, k3sCopyRegistries, setK3sCopyRegistries, k3sCopyKubeconfig, setK3sCopyKubeconfig, k3sLoading, handleSshProvision } = state;
  return (
                <div className="space-y-3 p-4 bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="text-xs text-slate-400">
                    Remotely execute the join sequence on a target machine over SSH with sudo privileges:
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium text-slate-300">Target Host (user@ip)</label>
                      <input
                        type="text"
                        value={k3sSshHost}
                        onChange={(e) => setK3sSshHost(e.target.value)}
                        placeholder="ubuntu@192.168.1.50"
                        className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-300">SSH Port</label>
                      <input
                        type="text"
                        value={k3sSshPort}
                        onChange={(e) => setK3sSshPort(e.target.value)}
                        placeholder="22"
                        className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-300">SSH Key Path (Optional)</label>
                    <input
                      type="text"
                      value={k3sSshKey}
                      onChange={(e) => setK3sSshKey(e.target.value)}
                      placeholder="~/.ssh/id_rsa (defaults to standard SSH agent/keys)"
                      className="w-full text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-300 focus:outline-none focus:border-purple-500"
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
                      <span>Tune NVMe & Limits</span>
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
                      <span>Copy Kubeconfig</span>
                    </label>
                  </div>
                  <div className="pt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={handleSshProvision}
                      disabled={!k3sSshHost.trim() || k3sLoading}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-40 cursor-pointer"
                    >
                      <Server className="w-3.5 h-3.5" />
                      <span>{k3sLoading ? 'Provisioning...' : 'Provision Remote Node'}</span>
                    </button>
                  </div>
                </div>
  );
}
