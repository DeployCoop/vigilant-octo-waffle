'use client';

import { useState, useEffect } from 'react';
import {
  HardDrive,
  RefreshCw,
  Database,
  AlertCircle,
  Layers,
  Activity,
  Zap,
  FileCode,
  Sliders,
  CheckCircle,
} from 'lucide-react';
import { soundFx } from '@/lib/audio';
import { apiErrorMessage } from '@/lib/envelope';
import { useTerminal } from '@/context/TerminalContext';
import EnginesTab from './components/EnginesTab';
import ClassesTab from './components/ClassesTab';
import VolumesTab from './components/VolumesTab';
import DeepDiveTab from './components/DeepDiveTab';

export interface StorageClassItem {
  name: string;
  provisioner: string;
  reclaimPolicy: string;
  volumeBindingMode: string;
  isDefault: boolean;
}

export interface PersistentVolumeItem {
  name: string;
  capacity: string;
  accessModes: string[];
  reclaimPolicy: string;
  status: string;
  claim: string;
  storageClass: string;
}

export interface PersistentVolumeClaimItem {
  name: string;
  namespace: string;
  status: string;
  volume: string;
  capacity: string;
  accessModes: string[];
  storageClass: string;
}

export interface OpenEBSEngineStatus {
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

export interface HostVolumeGroup {
  vg_name: string;
  pv_count: string;
  lv_count: string;
  snap_count: string;
  vg_attr: string;
  vg_size: string;
  vg_free: string;
}

export interface OpenEBSData {
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
  engineStates?: Record<string, 'running' | 'error' | 'stopped'>;
  configuredEngines?: OpenEBSEngineStatus;
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
        const enginesToDisplay = data.openEBS.configuredEngines || data.openEBS.engines;
        if (enginesToDisplay) {
          setToggles((prev) => ({
            ...prev,
            ...enginesToDisplay,
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
        if (data.openEBS.config?.isDefaultSc) {
          setSetAsDefaultSc(data.openEBS.config.isDefaultSc === 'true');
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

  const renderEngineBadge = (key: keyof OpenEBSEngineStatus) => {
    const isRunning = Boolean(openEBS?.engines?.[key]);
    const state = openEBS?.engineStates?.[key];

    if (isRunning) {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
          RUNNING
        </span>
      );
    }
    if (state === 'error') {
      return (
        <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-rose-500/10 text-rose-400 border border-rose-500/30 animate-pulse">
          ERROR
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase bg-slate-800 text-slate-400">
        STANDBY
      </span>
    );
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
        <EnginesTab
          openEBS={openEBS}
          toggles={toggles}
          targetVg={targetVg}
          setTargetVg={setTargetVg}
          topologyKey={topologyKey}
          actionLoading={actionLoading}
          handleLabelNodes={handleLabelNodes}
          handleToggleEngine={handleToggleEngine}
          renderEngineBadge={renderEngineBadge}
          fsType={fsType}
          setFsType={setFsType}
          reclaimPolicy={reclaimPolicy}
          setReclaimPolicy={setReclaimPolicy}
          thinProvision={thinProvision}
          setThinProvision={setThinProvision}
          sharedAccess={sharedAccess}
          setSharedAccess={setSharedAccess}
          setAsDefaultSc={setAsDefaultSc}
          setSetAsDefaultSc={setSetAsDefaultSc}
          handleApplyConfig={handleApplyConfig}
        />
      )}

      {/* Tab 2: StorageClasses & Topologies */}
      {activeTab === 'classes' && (
        <ClassesTab
          storageClasses={storageClasses}
          actionLoading={actionLoading}
          handleSetDefaultSc={handleSetDefaultSc}
        />
      )}

      {/* Tab 3: Persistent Volumes & Claims */}
      {activeTab === 'volumes' && (
        <VolumesTab pvcs={pvcs} pvs={pvs} />
      )}

      {/* Tab 4: Architecture Deep Dive */}
      {activeTab === 'deepdive' && (
        <DeepDiveTab targetVg={targetVg} fsType={fsType} />
      )}
    </div>
  );
}