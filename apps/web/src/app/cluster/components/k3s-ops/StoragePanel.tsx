'use client';

import {
  Settings,
  HardDrive,
} from 'lucide-react';
import Link from 'next/link';
import type { ClusterPageState } from '../../useClusterPage';

export default function StoragePanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, k3sStorage, handleStorageInstall } = state;
  return (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-orange-600/20 border border-orange-500/30 flex items-center justify-center">
                        <HardDrive className="w-4 h-4 text-orange-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Distributed Block Storage (Longhorn / OpenEBS)</h4>
                        <p className="text-[11px] text-slate-400">
                          Replicated block storage with automatic volume failover, CSI snapshots, and ReadWriteMany (RWX) NFS sharing.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Default StorageClass</span>
                        <span className="text-white font-mono font-semibold">{k3sStorage?.defaultStorageClass || 'local-path'}</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Longhorn Engine</span>
                        <span className={`font-semibold ${k3sStorage?.longhornActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sStorage?.longhornActive ? 'RUNNING' : 'NOT DEPLOYED'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">OpenEBS Engine</span>
                        <span className={`font-semibold ${k3sStorage?.openebsActive ? 'text-emerald-400' : 'text-slate-400'}`}>
                          {k3sStorage?.openebsActive ? 'RUNNING' : 'NOT DEPLOYED'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Active Claims (PVCs)</span>
                        <span className="text-white font-mono font-semibold">{k3sStorage?.totalPVCs || 0}</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <Link
                        href="/storage"
                        className="px-3.5 py-1.5 bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 border border-sky-500/40 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition"
                      >
                        <Settings className="w-3.5 h-3.5 text-sky-400" />
                        <span>OpenEBS Console &amp; VG Config</span>
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleStorageInstall('openebs')}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Deploy OpenEBS
                      </button>
                      <button
                        type="button"
                        onClick={() => handleStorageInstall('longhorn')}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <HardDrive className="w-3.5 h-3.5" />
                        <span>Deploy Longhorn (Replicated Block)</span>
                      </button>
                    </div>
                  </div>
                </div>
  );
}
