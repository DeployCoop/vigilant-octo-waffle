'use client';

import {
  Download,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function SyncPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, handleBackupSync, handleAirgapBundle } = state;
  return (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-fuchsia-600/20 border border-fuchsia-500/30 flex items-center justify-center">
                        <Download className="w-4 h-4 text-fuchsia-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Remote Disaster Recovery &amp; Airgap Release Bundler</h4>
                        <p className="text-[11px] text-slate-400">
                          Sync etcd snapshots with client-side OpenSSL AES-256 encryption to S3/GCS or package complete air-gapped installation bundles.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Client Encryption</span>
                        <span className="text-emerald-400 font-semibold">AES-256-CBC</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">DR Endpoints</span>
                        <span className="text-white font-mono font-semibold">S3, GCS, MinIO</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Airgap Package</span>
                        <span className="text-slate-300 font-semibold">tar.zst Archives</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Baremetal Restore</span>
                        <span className="text-fuchsia-400 font-semibold">ONE-LINE READY</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={handleAirgapBundle}
                        disabled={k3sLoading}
                        className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition disabled:opacity-50 cursor-pointer"
                      >
                        Build Airgap Bundle
                      </button>
                      <button
                        type="button"
                        onClick={handleBackupSync}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-fuchsia-600 hover:bg-fuchsia-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Push Encrypted S3/GCS Sync</span>
                      </button>
                    </div>
                  </div>
                </div>
  );
}
