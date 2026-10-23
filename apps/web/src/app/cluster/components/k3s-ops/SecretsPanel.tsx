'use client';

import {
  Lock,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function SecretsPanel({ state }: { state: ClusterPageState }) {
  const { k3sLoading, k3sSecrets, handleSecretsRotate } = state;
  return (
                <div className="space-y-4">
                  <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
                    <div className="flex items-center space-x-2.5">
                      <div className="w-8 h-8 rounded-lg bg-rose-600/20 border border-rose-500/30 flex items-center justify-center">
                        <Lock className="w-4 h-4 text-rose-400" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-white">Secrets-at-Rest AES Key Rotation</h4>
                        <p className="text-[11px] text-slate-400">
                          Automated cryptographic rotation of Kubernetes secrets stored in etcd with zero-downtime rolling reload.
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-xs">
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Encryption Status</span>
                        <span className={`font-semibold ${k3sSecrets?.encryptionAtRestEnabled ? 'text-emerald-400' : 'text-amber-400'}`}>
                          {k3sSecrets?.encryptionAtRestEnabled ? 'ENABLED' : 'DISABLED'}
                        </span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Active Cipher</span>
                        <span className="text-white font-mono font-semibold uppercase">{k3sSecrets?.activeProvider || 'aescbc'}</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Managed Keys</span>
                        <span className="text-white font-mono font-semibold">{k3sSecrets?.keyCount || 1}</span>
                      </div>
                      <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg">
                        <span className="text-slate-500 block text-[10px] uppercase font-bold">Last Rotated</span>
                        <span className="text-slate-300 font-mono text-[11px] truncate block">{k3sSecrets?.lastRotated || 'recent'}</span>
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={handleSecretsRotate}
                        disabled={k3sLoading}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer shadow-sm"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Rotate Encryption Key &amp; Re-encrypt Secrets</span>
                      </button>
                    </div>
                  </div>
                </div>
  );
}
