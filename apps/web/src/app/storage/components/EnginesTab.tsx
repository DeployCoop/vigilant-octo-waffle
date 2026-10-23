'use client';

import {
  HardDrive,
  Database,
  AlertCircle,
  FolderLock,
  Layers,
  Cpu,
  Server,
  Activity,
  Settings,
  Tag,
  Boxes,
  Sparkles,
} from 'lucide-react';
import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { soundFx } from '@/lib/audio';
import type { OpenEBSData, OpenEBSEngineStatus } from '../page';

interface EnginesTabProps {
  openEBS: OpenEBSData | null;
  toggles: OpenEBSEngineStatus;
  targetVg: string;
  setTargetVg: Dispatch<SetStateAction<string>>;
  topologyKey: string;
  actionLoading: boolean;
  handleLabelNodes: () => void;
  handleToggleEngine: (key: keyof OpenEBSEngineStatus) => void;
  renderEngineBadge: (key: keyof OpenEBSEngineStatus) => ReactNode;
  fsType: 'ext4' | 'xfs' | 'btrfs';
  setFsType: Dispatch<SetStateAction<'ext4' | 'xfs' | 'btrfs'>>;
  reclaimPolicy: 'Delete' | 'Retain';
  setReclaimPolicy: Dispatch<SetStateAction<'Delete' | 'Retain'>>;
  thinProvision: boolean;
  setThinProvision: Dispatch<SetStateAction<boolean>>;
  sharedAccess: boolean;
  setSharedAccess: Dispatch<SetStateAction<boolean>>;
  setAsDefaultSc: boolean;
  setSetAsDefaultSc: Dispatch<SetStateAction<boolean>>;
  handleApplyConfig: () => void;
}

export default function EnginesTab({ openEBS, toggles, targetVg, setTargetVg, topologyKey, actionLoading, handleLabelNodes, handleToggleEngine, renderEngineBadge, fsType, setFsType, reclaimPolicy, setReclaimPolicy, thinProvision, setThinProvision, sharedAccess, setSharedAccess, setAsDefaultSc, setSetAsDefaultSc, handleApplyConfig }: EnginesTabProps) {
  return (
        <div className="space-y-6">
          {/* Host Volume Group Discovered Deck */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <Server className="w-4 h-4 text-emerald-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Discovered Host Volume Groups (LVM Physical Storage)
                  </h3>
                </div>
                <p className="text-xs text-slate-400">
                  OpenEBS LVM CSI driver scans the Linux kernel block layer to provision sub-millisecond line-rate block devices.
                </p>
              </div>

              <button
                onClick={handleLabelNodes}
                disabled={actionLoading}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition self-start sm:self-auto cursor-pointer"
                title="Ensure all nodes in the cluster have the topology selector label"
              >
                <Tag className="w-3.5 h-3.5 text-sky-400" />
                <span>Auto-Label All Nodes ({topologyKey})</span>
              </button>
            </div>

            {openEBS?.hostVolumeGroups && openEBS.hostVolumeGroups.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                {openEBS.hostVolumeGroups.map((vg) => {
                  const isSelected = targetVg === vg.vg_name;
                  return (
                    <div
                      key={vg.vg_name}
                      onClick={() => {
                        soundFx.playClick();
                        setTargetVg(vg.vg_name);
                      }}
                      className={`p-4 rounded-xl border transition cursor-pointer relative ${
                        isSelected
                          ? 'bg-sky-950/30 border-sky-500 shadow-md ring-1 ring-sky-500/50'
                          : 'bg-slate-950/80 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Database className={`w-4 h-4 ${isSelected ? 'text-sky-400' : 'text-slate-400'}`} />
                          <span className="text-sm font-black font-mono text-white">{vg.vg_name}</span>
                        </div>
                        {isSelected && (
                          <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-mono text-[10px] font-bold">
                            TARGET VG
                          </span>
                        )}
                      </div>

                      <div className="mt-3 space-y-1.5 text-xs">
                        <div className="flex justify-between text-slate-400">
                          <span>Total Capacity:</span>
                          <span className="font-mono text-slate-200">{vg.vg_size}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Free Space:</span>
                          <span className="font-mono text-emerald-400 font-semibold">{vg.vg_free}</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Active LVs:</span>
                          <span className="font-mono text-slate-200">{vg.lv_count} volumes</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Physical PVs:</span>
                          <span className="font-mono text-slate-200">{vg.pv_count} disk</span>
                        </div>
                      </div>

                      <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                        <span className="text-slate-500 font-mono">Driver: local.csi.openebs.io</span>
                        <span className={isSelected ? 'text-sky-400 font-semibold' : 'text-slate-400'}>
                          {isSelected ? 'Provisioning Active' : 'Click to Target'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 bg-slate-950 border border-slate-800/60 rounded-xl text-xs text-slate-400 flex items-center space-x-3">
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>No volume groups discovered via vgs yet. Defaulting to configured target: <strong>{targetVg}</strong></span>
              </div>
            )}
          </div>

          {/* Engine Toggle Matrix */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <Cpu className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  OpenEBS Engine &amp; Component Matrix (Toggleable Fabric)
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                Toggle individual storage engines, message bus, telemetry, and object stores. Each module can be independently enabled or disabled.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
              {/* 1. LVM LocalPV */}
              <div
                className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                  toggles.lvm
                    ? 'bg-slate-950 border-sky-500/50 shadow-sm'
                    : 'bg-slate-950/50 border-slate-800 opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                        <HardDrive className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-bold text-white">LocalPV LVM</span>
                    </div>
                    {renderEngineBadge('lvm')}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                    Provisions line-rate NVMe/SSD block storage directly out of Volume Group <strong>{targetVg}</strong>. Zero network latency.
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-500">local.csi.openebs.io</span>
                  <button
                    type="button"
                    onClick={() => handleToggleEngine('lvm')}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      toggles.lvm ? 'bg-sky-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        toggles.lvm ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 2. Hostpath LocalPV */}
              <div
                className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                  toggles.hostpath
                    ? 'bg-slate-950 border-emerald-500/50 shadow-sm'
                    : 'bg-slate-950/50 border-slate-800 opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                        <FolderLock className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-bold text-white">LocalPV Hostpath</span>
                    </div>
                    {renderEngineBadge('hostpath')}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                    Directory-based local volumes (/var/openebs/local). Currently powers Redis, SeaweedFS, and Supabase.
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-500">openebs.io/local</span>
                  <button
                    type="button"
                    onClick={() => handleToggleEngine('hostpath')}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      toggles.hostpath ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        toggles.hostpath ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 3. ZFS LocalPV */}
              <div
                className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                  toggles.zfs
                    ? 'bg-slate-950 border-purple-500/50 shadow-sm'
                    : 'bg-slate-950/50 border-slate-800 opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
                        <Boxes className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-bold text-white">LocalPV ZFS</span>
                    </div>
                    {renderEngineBadge('zfs')}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                    Dynamic ZFS dataset provisioner with inline compression, ARC caching, instantaneous snapshots, and quota enforcement.
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-500">zfs.csi.openebs.io</span>
                  <button
                    type="button"
                    onClick={() => handleToggleEngine('zfs')}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      toggles.zfs ? 'bg-purple-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        toggles.zfs ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 4. MinIO S3 Engine */}
              <div
                className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                  toggles.minio
                    ? 'bg-slate-950 border-amber-500/50 shadow-sm'
                    : 'bg-slate-950/50 border-slate-800 opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                        <Database className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-bold text-white">MinIO Object Store</span>
                    </div>
                    {renderEngineBadge('minio')}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                    S3-compatible bucket backend for persistent storage chunking, backups, and app artifacts. Backed by LVM PVs.
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-500">minio-standalone</span>
                  <button
                    type="button"
                    onClick={() => handleToggleEngine('minio')}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      toggles.minio ? 'bg-amber-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        toggles.minio ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 5. NATS Message Bus */}
              <div
                className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                  toggles.nats
                    ? 'bg-slate-950 border-cyan-500/50 shadow-sm'
                    : 'bg-slate-950/50 border-slate-800 opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                        <Activity className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-bold text-white">NATS Message Bus</span>
                    </div>
                    {renderEngineBadge('nats')}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                    High-speed distributed control plane message bus for Mayastor storage controllers and real-time state synchronization.
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-500">nats.io:4222</span>
                  <button
                    type="button"
                    onClick={() => handleToggleEngine('nats')}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      toggles.nats ? 'bg-cyan-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        toggles.nats ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* 6. RWX NFS Server */}
              <div
                className={`p-4 rounded-xl border transition flex flex-col justify-between ${
                  toggles.nfs
                    ? 'bg-slate-950 border-teal-500/50 shadow-sm'
                    : 'bg-slate-950/50 border-slate-800 opacity-60'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <div className="w-7 h-7 rounded-lg bg-teal-500/10 border border-teal-500/30 flex items-center justify-center text-teal-400">
                        <Layers className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-bold text-white">RWX NFS Provisioner</span>
                    </div>
                    {renderEngineBadge('nfs')}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
                    Multi-Pod ReadWriteMany (RWX) network filesystem server backed by underlying OpenEBS LVM persistent block storage.
                  </p>
                </div>
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-slate-500">nfs.csi.k8s.io</span>
                  <button
                    type="button"
                    onClick={() => handleToggleEngine('nfs')}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      toggles.nfs ? 'bg-teal-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        toggles.nfs ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* LVM StorageClass Customization Deck */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-2xl space-y-4">
            <div className="space-y-1">
              <div className="flex items-center space-x-2">
                <Settings className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  OpenEBS LVM StorageClass Configuration
                </h3>
              </div>
              <p className="text-xs text-slate-400">
                Specify kernel volume group target, filesystem format, thin provisioning, and multi-pod node sharing.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Target LVM Volume Group (volgroup)</label>
                <input
                  type="text"
                  value={targetVg}
                  onChange={(e) => setTargetVg(e.target.value)}
                  placeholder="AirVG"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-sky-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">Host VG: detected on /dev/sdb</span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Filesystem Type (fsType)</label>
                <select
                  value={fsType}
                  onChange={(e) => setFsType(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-500"
                >
                  <option value="ext4">ext4 (Standard &amp; High Reliability)</option>
                  <option value="xfs">xfs (High Scalability &amp; Direct I/O)</option>
                  <option value="btrfs">btrfs (CoW &amp; Snapshot Features)</option>
                </select>
                <span className="text-[10px] text-slate-500 mt-1 block">Formatted on volume creation</span>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Reclaim Policy</label>
                <select
                  value={reclaimPolicy}
                  onChange={(e) => setReclaimPolicy(e.target.value as any)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs focus:outline-none focus:border-sky-500"
                >
                  <option value="Delete">Delete (Reclaim disk space on PVC deletion)</option>
                  <option value="Retain">Retain (Keep LVM logical volume on PVC delete)</option>
                </select>
                <span className="text-[10px] text-slate-500 mt-1 block">Kubernetes PV reclaim behavior</span>
              </div>

              <div className="flex items-center space-x-3 p-3 bg-slate-950/70 border border-slate-800 rounded-lg">
                <input
                  type="checkbox"
                  id="thinProvision"
                  checked={thinProvision}
                  onChange={(e) => setThinProvision(e.target.checked)}
                  className="rounded border-slate-700 text-sky-600 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="thinProvision" className="cursor-pointer">
                  <div className="font-semibold text-white">Thin Provisioning</div>
                  <div className="text-[10px] text-slate-400">Allocate disk space on-demand (thinProvision=yes)</div>
                </label>
              </div>

              <div className="flex items-center space-x-3 p-3 bg-slate-950/70 border border-slate-800 rounded-lg">
                <input
                  type="checkbox"
                  id="sharedAccess"
                  checked={sharedAccess}
                  onChange={(e) => setSharedAccess(e.target.checked)}
                  className="rounded border-slate-700 text-sky-600 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="sharedAccess" className="cursor-pointer">
                  <div className="font-semibold text-white">Multi-Pod Node Sharing</div>
                  <div className="text-[10px] text-slate-400">Allow sharing volumes across pods on same node (shared=yes)</div>
                </label>
              </div>

              <div className="flex items-center space-x-3 p-3 bg-slate-950/70 border border-slate-800 rounded-lg">
                <input
                  type="checkbox"
                  id="setAsDefaultSc"
                  checked={setAsDefaultSc}
                  onChange={(e) => setSetAsDefaultSc(e.target.checked)}
                  className="rounded border-slate-700 text-sky-600 focus:ring-sky-500 w-4 h-4 cursor-pointer"
                />
                <label htmlFor="setAsDefaultSc" className="cursor-pointer">
                  <div className="font-semibold text-white">Cluster Default StorageClass</div>
                  <div className="text-[10px] text-slate-400">Make openebs-lvmpv the cluster default</div>
                </label>
              </div>
            </div>

            {/* Execution / Deploy Button */}
            <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="text-[11px] text-slate-400">
                Deploying will configure OpenEBS CSI drivers, ensure kernel modules, label nodes, and update StorageClass <code className="text-sky-400">openebs-lvmpv</code>.
              </div>

              <button
                type="button"
                onClick={handleApplyConfig}
                disabled={actionLoading}
                className="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-2 shadow-lg transition cursor-pointer disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4 text-sky-200" />
                <span>Save &amp; Deploy OpenEBS Configuration</span>
              </button>
            </div>
          </div>
        </div>
  );
}
