'use client';

import type { StorageClassItem } from '../page';

interface ClassesTabProps {
  storageClasses: StorageClassItem[];
  actionLoading: boolean;
  handleSetDefaultSc: (scName: string) => void;
}

export default function ClassesTab({ storageClasses, actionLoading, handleSetDefaultSc }: ClassesTabProps) {
  return (
        <div className="space-y-4">
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Kubernetes StorageClasses</h3>
                <p className="text-xs text-slate-400">
                  Registered storage providers with dynamic volume binding and allocation rules.
                </p>
              </div>
            </div>

            <div className="overflow-x-auto pt-2">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 uppercase font-mono text-[10px]">
                    <th className="py-2.5 px-3">StorageClass Name</th>
                    <th className="py-2.5 px-3">Provisioner CSI Driver</th>
                    <th className="py-2.5 px-3">Reclaim Policy</th>
                    <th className="py-2.5 px-3">Volume Binding</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {storageClasses.map((sc) => (
                    <tr key={sc.name} className="hover:bg-slate-800/30 transition">
                      <td className="py-3 px-3">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-white text-xs">{sc.name}</span>
                          {sc.isDefault && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-sans font-bold">
                              DEFAULT
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-sky-400">{sc.provisioner}</td>
                      <td className="py-3 px-3 text-slate-300">{sc.reclaimPolicy}</td>
                      <td className="py-3 px-3 text-slate-400">{sc.volumeBindingMode}</td>
                      <td className="py-3 px-3 text-right">
                        {!sc.isDefault ? (
                          <button
                            onClick={() => handleSetDefaultSc(sc.name)}
                            disabled={actionLoading}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-[11px] font-sans font-medium transition cursor-pointer"
                          >
                            Set Default
                          </button>
                        ) : (
                          <span className="text-[11px] text-emerald-400 font-sans font-semibold">Active Default</span>
                        )}
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
