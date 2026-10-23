'use client';

import type { PersistentVolumeClaimItem, PersistentVolumeItem } from '../page';

interface VolumesTabProps {
  pvcs: PersistentVolumeClaimItem[];
  pvs: PersistentVolumeItem[];
}

export default function VolumesTab({ pvcs, pvs }: VolumesTabProps) {
  return (
        <div className="space-y-6">
          {/* Claims (PVCs) Table */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Persistent Volume Claims (PVCs)</h3>
                <p className="text-xs text-slate-400">Applications and services bound to storage volumes.</p>
              </div>
            </div>

            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono text-[10px]">
                    <th className="py-2.5 px-3">Claim Name</th>
                    <th className="py-2.5 px-3">Namespace</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Capacity</th>
                    <th className="py-2.5 px-3">StorageClass</th>
                    <th className="py-2.5 px-3">Bound Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {pvcs.length > 0 ? (
                    pvcs.map((pvc) => (
                      <tr key={`${pvc.namespace}/${pvc.name}`} className="hover:bg-slate-800/30 transition">
                        <td className="py-3 px-3 font-bold text-white">{pvc.name}</td>
                        <td className="py-3 px-3">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {pvc.namespace}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              pvc.status === 'Bound'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}
                          >
                            {pvc.status}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-slate-200">{pvc.capacity || 'Pending'}</td>
                        <td className="py-3 px-3 text-sky-400">{pvc.storageClass}</td>
                        <td className="py-3 px-3 text-slate-400 truncate max-w-[200px]" title={pvc.volume}>
                          {pvc.volume}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500 font-sans">
                        No Persistent Volume Claims found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Persistent Volumes (PVs) */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Cluster Persistent Volumes (PVs)</h3>
              <p className="text-xs text-slate-400">Underlying disk allocations managed by CSI controllers.</p>
            </div>

            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono text-[10px]">
                    <th className="py-2.5 px-3">Volume Identifier</th>
                    <th className="py-2.5 px-3">Capacity</th>
                    <th className="py-2.5 px-3">Access Mode</th>
                    <th className="py-2.5 px-3">StorageClass</th>
                    <th className="py-2.5 px-3">Bound Claim</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {pvs.map((pv) => (
                    <tr key={pv.name} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-3 font-bold text-white truncate max-w-[220px]" title={pv.name}>
                        {pv.name}
                      </td>
                      <td className="py-3 px-3 text-slate-200 font-semibold">{pv.capacity}</td>
                      <td className="py-3 px-3 text-slate-400">{pv.accessModes?.join(', ')}</td>
                      <td className="py-3 px-3 text-sky-400">{pv.storageClass}</td>
                      <td className="py-3 px-3 text-slate-300">{pv.claim}</td>
                      <td className="py-3 px-3">
                        <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-[10px] font-bold">
                          {pv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
  );
}
