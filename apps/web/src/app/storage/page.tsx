'use client';

import { useState, useEffect } from 'react';
import {
  HardDrive,
  RefreshCw,
  Database,
  CheckCircle2,
  AlertCircle,
  FolderLock,
  Layers,
} from 'lucide-react';

interface StorageClassItem {
  name: string;
  provisioner: string;
  reclaimPolicy: string;
  volumeBindingMode: string;
  isDefault: boolean;
}

interface PersistentVolumeItem {
  name: string;
  capacity: string;
  accessModes: string[];
  reclaimPolicy: string;
  status: string;
  claim: string;
  storageClass: string;
}

interface PersistentVolumeClaimItem {
  name: string;
  namespace: string;
  status: string;
  volume: string;
  capacity: string;
  accessModes: string[];
  storageClass: string;
}

export default function StoragePage() {
  const [storageClasses, setStorageClasses] = useState<StorageClassItem[]>([]);
  const [pvs, setPvs] = useState<PersistentVolumeItem[]>([]);
  const [pvcs, setPvcs] = useState<PersistentVolumeClaimItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchStorage = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/storage');
      const data = await res.json();
      setStorageClasses(data.storageClasses || []);
      setPvs(data.persistentVolumes || []);
      setPvcs(data.persistentVolumeClaims || []);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStorage();
  }, []);

  const boundPvcCount = pvcs.filter((p) => p.status === 'Bound').length;

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <HardDrive className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Storage Allocation & Volumes</h2>
          </div>
          <p className="text-sm text-slate-400">
            Real-time inspection of StorageClasses, Persistent Volumes, and PVC claim bindings
          </p>
        </div>

        <button
          onClick={fetchStorage}
          disabled={loading}
          className="text-xs px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg flex items-center space-x-2 self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Storage</span>
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Storage Classes</div>
          <div className="text-2xl font-bold text-white">{storageClasses.length}</div>
        </div>
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Persistent Volumes (PVs)</div>
          <div className="text-2xl font-bold text-sky-400">{pvs.length}</div>
        </div>
        <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">PVC Claims (Bound / Total)</div>
          <div className="text-2xl font-bold text-emerald-400">
            {boundPvcCount} / {pvcs.length}
          </div>
        </div>
      </div>

      {/* Storage Classes */}
      <div className="space-y-4">
        <h3 className="text-base font-bold text-white flex items-center space-x-2">
          <FolderLock className="w-4 h-4 text-sky-400" />
          <span>Storage Classes</span>
        </h3>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-5 py-3 font-semibold">Name</th>
                <th className="px-5 py-3 font-semibold">Provisioner</th>
                <th className="px-5 py-3 font-semibold">Reclaim Policy</th>
                <th className="px-5 py-3 font-semibold">Volume Binding Mode</th>
                <th className="px-5 py-3 font-semibold">Default</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {storageClasses.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-6 text-center text-slate-500">
                    No StorageClasses detected.
                  </td>
                </tr>
              ) : (
                storageClasses.map((sc) => (
                  <tr key={sc.name} className="hover:bg-slate-800/40">
                    <td className="px-5 py-3.5 font-bold text-slate-200">{sc.name}</td>
                    <td className="px-5 py-3.5 text-slate-400">{sc.provisioner}</td>
                    <td className="px-5 py-3.5 text-slate-300">{sc.reclaimPolicy}</td>
                    <td className="px-5 py-3.5 text-slate-400">{sc.volumeBindingMode}</td>
                    <td className="px-5 py-3.5">
                      {sc.isDefault ? (
                        <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded font-sans text-[11px] font-semibold">
                          Default
                        </span>
                      ) : (
                        <span className="text-slate-600">-</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Persistent Volume Claims (PVCs) */}
      <div className="space-y-4">
        <h3 className="text-base font-bold text-white flex items-center space-x-2">
          <Database className="w-4 h-4 text-emerald-400" />
          <span>Persistent Volume Claims (PVCs)</span>
        </h3>

        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-5 py-3 font-semibold">Claim Name</th>
                <th className="px-5 py-3 font-semibold">Namespace</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold">Capacity</th>
                <th className="px-5 py-3 font-semibold">Volume</th>
                <th className="px-5 py-3 font-semibold">Storage Class</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {pvcs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-slate-500">
                    No PersistentVolumeClaims found in cluster.
                  </td>
                </tr>
              ) : (
                pvcs.map((pvc) => (
                  <tr key={`${pvc.namespace}/${pvc.name}`} className="hover:bg-slate-800/40">
                    <td className="px-5 py-3.5 font-bold text-slate-200">{pvc.name}</td>
                    <td className="px-5 py-3.5 text-slate-400">{pvc.namespace}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                          pvc.status === 'Bound'
                            ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/50'
                            : 'bg-amber-950/80 text-amber-400 border border-amber-800/50'
                        }`}
                      >
                        {pvc.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sky-400 font-semibold">{pvc.capacity || 'N/A'}</td>
                    <td className="px-5 py-3.5 text-slate-400 truncate max-w-xs">{pvc.volume || '-'}</td>
                    <td className="px-5 py-3.5 text-slate-400">{pvc.storageClass || '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
