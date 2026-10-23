'use client';

import {
  RefreshCw,
  Trash2,
  HardDrive,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function EtcdPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, k3sEtcd, snapshotName, setSnapshotName, fetchK3sProductionData, handleSnapshotOp, handleTakeSnapshot } = state;
  return (
                <div className="space-y-4">
                  {/* Snapshot Create Bar */}
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                        <HardDrive className="w-4 h-4 text-sky-400" />
                        <span>Create etcd Snapshot</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => handleSnapshotOp('defrag')}
                          disabled={k3sLoading}
                          className="px-2.5 py-1 text-xs font-medium text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded border border-slate-700 transition cursor-pointer"
                          title="Defragment etcd database storage"
                        >
                          etcd Defrag
                        </button>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={snapshotName}
                        onChange={(e) => setSnapshotName(e.target.value)}
                        placeholder="Snapshot name (optional, e.g. pre-migration-v1)"
                        className="flex-1 text-xs font-mono bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-sky-500"
                      />
                      <button
                        type="button"
                        onClick={handleTakeSnapshot}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <HardDrive className="w-3.5 h-3.5" />
                        <span>Save Snapshot</span>
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Saved to <code className="text-slate-400 font-mono">/var/lib/rancher/k3s/server/db/snapshots</code>. Cron auto-snapshots run every 12 hours.
                    </p>
                  </div>

                  {/* Snapshot List Table */}
                  <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950">
                    <div className="p-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">Existing Snapshots ({k3sEtcd?.snapshots?.length || 0})</span>
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
                      {k3sEtcd?.snapshots && k3sEtcd.snapshots.length > 0 ? (
                        k3sEtcd.snapshots.map((snap: any) => (
                          <div key={snap.name} className="p-3 flex items-center justify-between text-xs hover:bg-slate-900/40">
                            <div className="space-y-0.5">
                              <div className="font-mono text-slate-200 font-medium">{snap.name}</div>
                              <div className="text-[11px] text-slate-500 flex items-center space-x-2">
                                <span>Size: {snap.size || 'N/A'}</span>
                                <span>•</span>
                                <span>{snap.created_at || snap.date || 'Local storage'}</span>
                              </div>
                            </div>
                            <div className="flex items-center space-x-2">
                              <button
                                type="button"
                                onClick={() => handleSnapshotOp('restore', snap.name)}
                                disabled={k3sLoading}
                                className="px-2 py-1 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 border border-amber-800/60 rounded text-[11px] font-medium transition cursor-pointer"
                                title="Restore cluster state from this snapshot"
                              >
                                Restore
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSnapshotOp('delete', snap.name)}
                                disabled={k3sLoading}
                                className="p-1 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                                title="Delete snapshot"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="p-6 text-center text-xs text-slate-500">
                          No snapshots found. Snapshots created via K3s CLI, cron, or manual save will appear here.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
  );
}
