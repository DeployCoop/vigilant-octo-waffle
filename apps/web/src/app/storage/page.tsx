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
  Cpu,
  Server,
  Activity,
  Play,
  Settings,
  Shield,
  Zap,
  Tag,
  Check,
  Radio,
  FileCode,
  Gauge,
  Sliders,
  ExternalLink,
  ChevronRight,
  Boxes,
  Lock,
  CheckCircle,
  Clock,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { soundFx } from '@/lib/audio';
import { apiErrorMessage } from '@/lib/envelope';
import { useTerminal } from '@/context/TerminalContext';

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

interface OpenEBSEngineStatus {
  hostpath: boolean;
  lvm: boolean;
  zfs: boolean;
  rawfile: boolean;
  mayastor: boolean;
  nats: boolean;
  minio: boolean;
  loki: boolean;
  alloy: boolean;
  nfs: boolean;
}

interface HostVolumeGroup {
  vg_name: string;
  pv_count: string;
  lv_count: string;
  snap_count: string;
  vg_attr: string;
  vg_size: string;
  vg_free: string;
}

interface OpenEBSData {
  defaultStorageClass: string;
  storageClasses: string[];
  csiDrivers: string[];
  totalPVs: number;
  totalPVCs: number;
  longhornActive: boolean;
  openebsActive: boolean;
  lvmNodesRegistered?: number;
  topologyKey?: string;
  topologyNodes?: string[];
  engines?: OpenEBSEngineStatus;
  hostVolumeGroups?: HostVolumeGroup[];
  config?: {
    vg: string;
    fsType: string;
    thinProvision: string;
    shared: string;
    storageClass: string;
    isDefaultSc: string;
  };
}

export default function StoragePage() {
  const [storageClasses, setStorageClasses] = useState<StorageClassItem[]>([]);
  const [pvs, setPvs] = useState<PersistentVolumeItem[]>([]);
  const [pvcs, setPvcs] = useState<PersistentVolumeClaimItem[]>([]);
  const [openEBS, setOpenEBS] = useState<OpenEBSData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [activeTab, setActiveTab] = useState<'engines' | 'classes' | 'volumes' | 'deepdive'>('engines');
  const { openTerminal } = useTerminal();

  // Engine toggles state
  const [toggles, setToggles] = useState({
    lvm: true,
    hostpath: true,
    zfs: false,
    rawfile: false,
    mayastor: false,
    nats: false,
    minio: false,
    loki: false,
    alloy: false,
    nfs: false,
  });

  // LVM config parameters
  const [targetVg, setTargetVg] = useState('AirVG');
  const [fsType, setFsType] = useState<'ext4' | 'xfs' | 'btrfs'>('ext4');
  const [thinProvision, setThinProvision] = useState(false);
  const [sharedAccess, setSharedAccess] = useState(true);
  const [allowExpansion, setAllowExpansion] = useState(true);
  const [reclaimPolicy, setReclaimPolicy] = useState<'Delete' | 'Retain'>('Delete');
  const [setAsDefaultSc, setSetAsDefaultSc] = useState(false);
  const [topologyKey, setTopologyKey] = useState('openebs.io/lvm');
  const [topologyValue, setTopologyValue] = useState('true');

  const fetchStorage = async (silent = false) => {
    if (!silent) {
      setLoading(true);
      soundFx.playSonarPing();
    }
    try {
      const res = await fetch('/api/storage');
      const data = await res.json();
      setStorageClasses(data.storageClasses || []);
      setPvs(data.persistentVolumes || []);
      setPvcs(data.persistentVolumeClaims || []);
      if (data.openEBS) {
        setOpenEBS(data.openEBS);
        if (data.openEBS.engines) {
          setToggles((prev) => ({
            ...prev,
            ...data.openEBS.engines,
          }));
        }
        if (data.openEBS.config?.vg) {
          setTargetVg(data.openEBS.config.vg);
        }
        if (data.openEBS.config?.fsType) {
          setFsType(data.openEBS.config.fsType as any);
        }
        if (data.openEBS.config?.thinProvision) {
          setThinProvision(data.openEBS.config.thinProvision === 'yes');
        }
        if (data.openEBS.config?.shared) {
          setSharedAccess(data.openEBS.config.shared === 'yes');
        }
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStorage();
  }, []);

  const handleToggleEngine = (key: keyof typeof toggles) => {
    soundFx.playClick();
    setToggles((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleApplyConfig = async () => {
    soundFx.playClick();
    if (!confirm(`Deploy OpenEBS configuration with LVM targeting Volume Group '${targetVg}'?`)) return;

    setActionLoading(true);
    setMessage({ text: 'Dispatching OpenEBS configuration task...', type: 'info' });

    try {
      const res = await fetch('/api/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'configure-openebs',
          options: {
            vg: targetVg,
            fsType,
            thinProvision,
            shared: sharedAccess,
            enableLvm: toggles.lvm,
            enableHostpath: toggles.hostpath,
            enableZfs: toggles.zfs,
            enableRawfile: toggles.rawfile,
            enableMayastor: toggles.mayastor,
            enableNats: toggles.nats,
            enableMinio: toggles.minio,
            enableLoki: toggles.loki,
            enableAlloy: toggles.alloy,
            enableNfs: toggles.nfs,
            setDefaultSc: setAsDefaultSc,
            labelNodes: true,
          },
        }),
      });

      const data = await res.json();
      if (data.success) {
        soundFx.playSuccess();
        setMessage({ text: data.message, type: 'success' });
        if (data.taskId) {
          openTerminal(data.taskId, `OpenEBS Deploy (${targetVg})`);
        }
        setTimeout(() => fetchStorage(true), 4000);
      } else {
        soundFx.playError();
        setMessage({ text: apiErrorMessage(data, 'Failed to dispatch configuration'), type: 'error' });
      }
    } catch (err: any) {
      soundFx.playError();
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBenchmark = async () => {
    soundFx.playClick();
    setActionLoading(true);
    setMessage({ text: `Starting storage benchmark test on 'openebs-lvmpv' (Target VG: ${targetVg})...`, type: 'info' });

    try {
      const res = await fetch('/api/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'benchmark',
          storageClass: 'openebs-lvmpv',
        }),
      });

      const data = await res.json();
      if (data.success) {
        soundFx.playSuccess();
        setMessage({ text: data.message, type: 'success' });
        if (data.taskId) {
          openTerminal(data.taskId, 'OpenEBS LVM Benchmark');
        }
      } else {
        soundFx.playError();
        setMessage({ text: apiErrorMessage(data, 'Benchmark failed'), type: 'error' });
      }
    } catch (err: any) {
      soundFx.playError();
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleLabelNodes = async () => {
    soundFx.playClick();
    setActionLoading(true);
    try {
      const res = await fetch('/api/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'label-nodes',
          key: topologyKey,
          value: topologyValue,
        }),
      });
      const data = await res.json();
      if (data.success) {
        soundFx.playSuccess();
        setMessage({ text: data.message, type: 'success' });
        fetchStorage(true);
      } else {
        soundFx.playError();
        setMessage({ text: apiErrorMessage(data), type: 'error' });
      }
    } catch (err: any) {
      soundFx.playError();
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSetDefaultSc = async (scName: string) => {
    soundFx.playClick();
    setActionLoading(true);
    try {
      const res = await fetch('/api/storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-default-sc',
          storageClass: scName,
        }),
      });
      const data = await res.json();
      if (data.success) {
        soundFx.playSuccess();
        setMessage({ text: data.message, type: 'success' });
        fetchStorage(true);
      } else {
        soundFx.playError();
        setMessage({ text: apiErrorMessage(data), type: 'error' });
      }
    } catch (err: any) {
      soundFx.playError();
      setMessage({ text: err.message, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  };

  // Compute summary stats
  const boundPvcCount = pvcs.filter((p) => p.status === 'Bound').length;
  const activeEnginesCount = Object.values(openEBS?.engines || {}).filter(Boolean).length;
  const primaryVg = openEBS?.hostVolumeGroups?.[0];

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-16">
      {/* Top Cyberdeck Banner & HUD */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950/40 border border-slate-800 p-6 shadow-2xl">
        <div className="absolute top-0 right-0 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-96 h-96 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-inner">
                <HardDrive className="w-5 h-5 animate-pulse" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="text-2xl font-black text-white tracking-tight">OpenEBS Cyberdeck Control Fabric</h1>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono text-[10px] uppercase font-bold tracking-wider">
                    CSI 1.10 Online
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  Comprehensive storage orchestrator: LocalPV (LVM, Hostpath, ZFS, Rawfile), Replicated PV (Mayastor), MinIO &amp; NATS event fabric.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleBenchmark}
              disabled={actionLoading}
              className="px-3.5 py-2 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 rounded-xl text-xs font-semibold flex items-center space-x-2 transition shadow-sm cursor-pointer disabled:opacity-50"
              title="Execute a live volume creation and sequential/random I/O benchmark on openebs-lvmpv"
            >
              <Zap className="w-4 h-4 text-indigo-400" />
              <span>Test LVM Provisioning</span>
            </button>

            <button
              onClick={() => fetchStorage()}
              disabled={loading}
              className="px-3.5 py-2 bg-slate-800/80 hover:bg-slate-700/80 text-slate-200 border border-slate-700/70 rounded-xl text-xs font-semibold flex items-center space-x-2 transition cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
              <span>Sync Fabric</span>
            </button>
          </div>
        </div>

        {/* Global Telemetry HUD Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-800/60">
          <div className="p-3 bg-slate-900/60 border border-slate-800/70 rounded-xl">
            <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Active Target VG</span>
            <div className="flex items-center space-x-2 mt-0.5">
              <span className="text-base font-black text-sky-400 font-mono">{primaryVg?.vg_name || targetVg}</span>
              <span className="text-[10px] text-slate-400 font-mono">({primaryVg?.vg_free || '362G'} Free)</span>
            </div>
          </div>

          <div className="p-3 bg-slate-900/60 border border-slate-800/70 rounded-xl">
            <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Default StorageClass</span>
            <div className="text-base font-black text-white font-mono mt-0.5 truncate">
              {openEBS?.defaultStorageClass || 'openebs-hostpath'}
            </div>
          </div>

          <div className="p-3 bg-slate-900/60 border border-slate-800/70 rounded-xl">
            <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Active Engines</span>
            <div className="flex items-center space-x-2 mt-0.5">
              <span className="text-base font-black text-emerald-400 font-mono">{activeEnginesCount} Running</span>
              <span className="text-[10px] text-slate-500">/ 10 Modules</span>
            </div>
          </div>

          <div className="p-3 bg-slate-900/60 border border-slate-800/70 rounded-xl">
            <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">Bound Claims (PVC)</span>
            <div className="flex items-center space-x-2 mt-0.5">
              <span className="text-base font-black text-amber-400 font-mono">{boundPvcCount} Bound</span>
              <span className="text-[10px] text-slate-500">({pvcs.length} Total)</span>
            </div>
          </div>
        </div>
      </div>

      {/* User Alerts / Messages */}
      {message && (
        <div
          className={`p-4 rounded-xl border flex items-center justify-between text-xs font-medium ${
            message.type === 'success'
              ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
              : message.type === 'error'
              ? 'bg-rose-950/30 border-rose-500/30 text-rose-300'
              : 'bg-sky-950/30 border-sky-500/30 text-sky-300'
          }`}
        >
          <div className="flex items-center space-x-2.5">
            {message.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : message.type === 'error' ? (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            ) : (
              <Activity className="w-4 h-4 text-sky-400 shrink-0 animate-spin" />
            )}
            <span>{message.text}</span>
          </div>
          <button
            onClick={() => setMessage(null)}
            className="text-slate-400 hover:text-white px-2 py-0.5 text-[11px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex border-b border-slate-800 overflow-x-auto gap-2">
        <button
          onClick={() => {
            soundFx.playClick();
            setActiveTab('engines');
          }}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 tracking-wide flex items-center space-x-2 transition ${
            activeTab === 'engines'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-4 h-4" />
          <span>OpenEBS Fabric &amp; Engines</span>
        </button>

        <button
          onClick={() => {
            soundFx.playClick();
            setActiveTab('classes');
          }}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 tracking-wide flex items-center space-x-2 transition ${
            activeTab === 'classes'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>StorageClasses &amp; Topologies ({storageClasses.length})</span>
        </button>

        <button
          onClick={() => {
            soundFx.playClick();
            setActiveTab('volumes');
          }}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 tracking-wide flex items-center space-x-2 transition ${
            activeTab === 'volumes'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="w-4 h-4" />
          <span>PVs &amp; Claims ({pvcs.length})</span>
        </button>

        <button
          onClick={() => {
            soundFx.playClick();
            setActiveTab('deepdive');
          }}
          className={`px-4 py-2.5 text-xs font-bold border-b-2 tracking-wide flex items-center space-x-2 transition ${
            activeTab === 'deepdive'
              ? 'border-sky-500 text-sky-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileCode className="w-4 h-4" />
          <span>Architecture Deep Dive</span>
        </button>
      </div>

      {/* Tab 1: OpenEBS Engines & Configuration Matrix */}
      {activeTab === 'engines' && (
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
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        openEBS?.engines?.lvm
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {openEBS?.engines?.lvm ? 'RUNNING' : 'INACTIVE'}
                    </span>
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
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        openEBS?.engines?.hostpath
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {openEBS?.engines?.hostpath ? 'RUNNING' : 'INACTIVE'}
                    </span>
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
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        openEBS?.engines?.zfs
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {openEBS?.engines?.zfs ? 'RUNNING' : 'STANDBY'}
                    </span>
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
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        openEBS?.engines?.minio
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {openEBS?.engines?.minio ? 'RUNNING' : 'STANDBY'}
                    </span>
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
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        openEBS?.engines?.nats
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {openEBS?.engines?.nats ? 'RUNNING' : 'STANDBY'}
                    </span>
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
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase ${
                        openEBS?.engines?.nfs
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {openEBS?.engines?.nfs ? 'RUNNING' : 'STANDBY'}
                    </span>
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
      )}

      {/* Tab 2: StorageClasses & Topologies */}
      {activeTab === 'classes' && (
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
      )}

      {/* Tab 3: Persistent Volumes & Claims */}
      {activeTab === 'volumes' && (
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
      )}

      {/* Tab 4: Architecture Deep Dive */}
      {activeTab === 'deepdive' && (
        <div className="space-y-6">
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-6 text-xs text-slate-300 leading-relaxed">
            <div className="border-b border-slate-800 pb-4">
              <h2 className="text-base font-black text-white uppercase tracking-wider flex items-center space-x-2">
                <HardDrive className="w-5 h-5 text-sky-400" />
                <span>OpenEBS Architecture &amp; Engine Mechanics</span>
              </h2>
              <p className="text-slate-400 mt-1">
                Deep dive into Kubernetes Container Attached Storage (CAS), CSI controllers, kernel block devices, and storage topologies.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                  1. LocalPV LVM (Zero Network Latency)
                </h4>
                <p className="text-[11px] text-slate-400">
                  Carves out raw logical volumes directly from a designated host Linux Volume Group (<code className="text-slate-300 font-mono">AirVG</code> on <code className="text-slate-300 font-mono">/dev/sdb</code>).
                </p>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
                  <li><strong>Line-rate I/O</strong>: Bypasses network hops completely; reads/writes occur at native SSD bus speed.</li>
                  <li><strong>Driver</strong>: <code className="text-slate-300 font-mono">local.csi.openebs.io</code> with CSI Node DaemonSet and CSI Controller StatefulSet.</li>
                  <li><strong>Topology</strong>: Automatically binds pods to the node possessing the requested Volume Group.</li>
                  <li><strong>Expansion</strong>: Online volume resizing with zero pod downtime.</li>
                </ul>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                  2. LocalPV Hostpath (Directory Storage)
                </h4>
                <p className="text-[11px] text-slate-400">
                  File-based persistent storage on the host filesystem at <code className="text-slate-300 font-mono">/var/openebs/local</code>.
                </p>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
                  <li><strong>Ideal for</strong>: Databases with built-in replication (e.g. Postgres, Redis, SeaweedFS).</li>
                  <li><strong>Provisioner</strong>: <code className="text-slate-300 font-mono">openebs.io/local</code>.</li>
                  <li><strong>Resource footprint</strong>: Ultra-lightweight memory footprint (&lt;50MB RAM).</li>
                </ul>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider">
                  3. LocalPV ZFS (Data Integrity &amp; Snapshots)
                </h4>
                <p className="text-[11px] text-slate-400">
                  Creates dedicated ZFS datasets per PVC inside a Zpool (<code className="text-slate-300 font-mono">zfspool</code>).
                </p>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
                  <li><strong>Features</strong>: Transparent ZSTD/LZ4 compression, checksumming, copy-on-write snapshots.</li>
                  <li><strong>Driver</strong>: <code className="text-slate-300 font-mono">zfs.csi.openebs.io</code>.</li>
                  <li><strong>Isolation</strong>: Independent quota limits and I/O scheduler controls per dataset.</li>
                </ul>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                  4. Replicated PV Mayastor &amp; NATS Bus
                </h4>
                <p className="text-[11px] text-slate-400">
                  Distributed NVMe-over-TCP block storage engine written in Rust for synchronous multi-node replication.
                </p>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
                  <li><strong>Coordination</strong>: Powered by an integrated high-speed <strong>NATS message bus</strong>.</li>
                  <li><strong>High Availability</strong>: Automatic failover if a storage node disconnects.</li>
                  <li><strong>Kernel Integration</strong>: Utilizes SPDK user-space drivers and <code className="text-slate-300 font-mono">nvme_tcp</code>.</li>
                </ul>
              </div>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <h4 className="text-xs font-bold text-teal-400 uppercase tracking-wider">
                Storage Allocation Flow in K3s
              </h4>
              <p className="text-[11px] text-slate-400">
                When a workload requests a PVC with <code className="text-sky-400 font-mono">storageClassName: openebs-lvmpv</code>, the Kubernetes scheduler holds binding until the pod is assigned to a node (<code className="text-slate-300 font-mono">WaitForFirstConsumer</code>). The OpenEBS LVM CSI controller executes <code className="text-slate-300 font-mono">lvcreate</code> on host Volume Group <code className="text-slate-300 font-mono">{targetVg}</code>, formats the filesystem (<code className="text-slate-300 font-mono">{fsType}</code>), and the node daemon mounts the device at <code className="text-slate-300 font-mono">/var/lib/kubelet/pods/&lt;uuid&gt;/volumes/kubernetes.io~csi/...</code>.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
