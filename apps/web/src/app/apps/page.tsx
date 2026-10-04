'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { postArgoWebhook } from '@/lib/webhook';
import {
  Layers,
  Search,
  ExternalLink,
  Code,
  Play,
  RotateCw,
  Check,
  Globe,
  BookOpen,
  Cpu,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  GitBranch,
  Plus,
  X,
  Activity,
  Zap,
  Ship,
  FolderOpen,
} from 'lucide-react';
import { useTerminal } from '@/context/TerminalContext';
import { useAbilityContext } from '@/lib/ability';


interface AppItem {
  id: string;
  name: string;
  category: string;
  description: string;
  enablerVar: string;
  enabled: boolean;
  ingressUrl?: string;
  subdomain?: string;
  docsUrl?: string;
  estimatedMemoryMb?: number;
  dependencies?: string[];
  isLocalChart?: boolean;
  chartVersion?: string;
  chartPath?: string;
}

interface PresetItem {
  id: string;
  name: string;
  description: string;
  estimatedMemoryMb: number;
  apps: string[];
}

interface SystemInfo {
  totalMemMb: number;
  freeMemMb: number;
  usedMemMb: number;
  cpuCount: number;
}

interface ArgoAppStatus {
  name: string;
  healthStatus: string;
  syncStatus: string;
}

interface HealthProbe {
  appId: string;
  status: 'healthy' | 'starting' | 'unreachable';
  statusCode?: number;
  latencyMs: number;
}

const CATEGORIES = [
  'All',
  'DevOps & GitOps',
  'Security & Identity',
  'Databases & Storage',
  'Observability & Monitoring',
  'Collaboration & Business',
  'AI, ML & GPU',
  'Messaging & IoT',
  'Custom & Local Charts',
];

export default function AppsPage() {
  const { openTerminal } = useTerminal();
  const { can } = useAbilityContext();
  const [apps, setApps] = useState<AppItem[]>([]);
  const [presets, setPresets] = useState<PresetItem[]>([]);
  const [domain, setDomain] = useState('example.com');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // System, ArgoCD, Flux, and Health telemetry
  const [cdRunner, setCdRunner] = useState<'argocd' | 'flux' | 'both'>('argocd');
  const [switchingRunner, setSwitchingRunner] = useState(false);
  const [bootstrappingFlux, setBootstrappingFlux] = useState(false);
  const [fluxStatus, setFluxStatus] = useState<{
    isHealthy: boolean;
    activeControllers: number;
    totalControllers: number;
  } | null>(null);
  const [fluxReconciling, setFluxReconciling] = useState(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [argoApps, setArgoApps] = useState<Record<string, ArgoAppStatus>>({});
  const [healthMap, setHealthMap] = useState<Record<string, HealthProbe>>({});

  // Custom App Wizard modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customId, setCustomId] = useState('');
  const [customCategory, setCustomCategory] = useState('DevOps & GitOps');
  const [customDesc, setCustomDesc] = useState('');
  const [customSource, setCustomSource] = useState<'helm' | 'git'>('helm');
  const [customRepo, setCustomRepo] = useState('');
  const [customChart, setCustomChart] = useState('');
  const [customSubdomain, setCustomSubdomain] = useState('');
  const [submittingCustom, setSubmittingCustom] = useState(false);

  const fetchApps = async () => {
    try {
      const res = await fetch('/api/apps');
      const data = await res.json();
      setApps(data.apps || []);
      if (data.presets) setPresets(data.presets);
      if (data.domain) setDomain(data.domain);
      if (data.cdRunner) setCdRunner(data.cdRunner);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchRunner = async (runner: 'argocd' | 'flux' | 'both') => {
    if (runner === cdRunner) return;
    setSwitchingRunner(true);
    try {
      const res = await fetch('/api/flux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-runner', cdRunner: runner }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);
      setCdRunner(runner);
      setActionMessage(`GitOps Runner switched to: ${runner.toUpperCase()}`);
      setTimeout(() => setActionMessage(null), 4000);
      await fetchApps();
    } catch (err: any) {
      setActionMessage(`Failed to switch runner: ${err.message}`);
      setTimeout(() => setActionMessage(null), 5000);
    } finally {
      setSwitchingRunner(false);
    }
  };

  const handleBootstrapFlux = async () => {
    setBootstrappingFlux(true);
    try {
      const res = await fetch('/api/flux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bootstrap' }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);
      if (data.taskId) {
        openTerminal(data.taskId, 'Bootstrapping FluxCD Controllers');
      }
      setActionMessage('FluxCD bootstrap initiated via src/flux.sh. Provisioning controllers...');
      setTimeout(() => setActionMessage(null), 6000);
      setTimeout(() => fetchTelemetry(), 3000);
    } catch (err: any) {
      setActionMessage(`Flux bootstrap error: ${err.message}`);
      setTimeout(() => setActionMessage(null), 5000);
    } finally {
      setBootstrappingFlux(false);
    }
  };

  const handleReconcileFlux = async () => {
    setFluxReconciling(true);
    try {
      const res = await fetch('/api/flux', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reconcile-all' }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);
      if (data.taskId) {
        openTerminal(data.taskId, 'Reconciling Flux Resources');
      }
      setActionMessage(data.message || 'Flux reconciliation initiated across all Kustomizations and HelmReleases.');
      setTimeout(() => setActionMessage(null), 4000);
    } catch (err: any) {
      setActionMessage(`Flux reconcile error: ${err.message}`);
      setTimeout(() => setActionMessage(null), 5000);
    } finally {
      setFluxReconciling(false);
    }
  };

  const fetchTelemetry = async () => {
    // 1. System info
    fetch('/api/system')
      .then((res) => res.json())
      .then((data) => {
        if (data.system) setSystemInfo(data.system);
      })
      .catch(() => {});

    // 2. ArgoCD info
    fetch('/api/argo')
      .then((res) => res.json())
      .then((data) => {
        if (data.applications) {
          const map: Record<string, ArgoAppStatus> = {};
          for (const a of data.applications) {
            map[a.name] = a;
          }
          setArgoApps(map);
        }
      })
      .catch(() => {});

    // 3. Ingress health prober
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (data.probes) {
          const map: Record<string, HealthProbe> = {};
          for (const p of data.probes) {
            map[p.appId] = p;
          }
          setHealthMap(map);
        }
      })
      .catch(() => {});

    // 4. FluxCD status
    fetch('/api/flux')
      .then((res) => res.json())
      .then((data) => {
        if (data.controllers) {
          setFluxStatus({
            isHealthy: Boolean(data.isHealthy),
            activeControllers: data.activeControllers || 0,
            totalControllers: data.totalControllers || 0,
          });
        }
        if (data.cdRunner) {
          setCdRunner(data.cdRunner);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchApps();
    fetchTelemetry();
  }, []);

  const handleToggle = async (app: AppItem) => {
    setUpdatingId(app.id);
    const newStatus = !app.enabled;
    try {
      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enablerVar: app.enablerVar,
          enabled: newStatus,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setApps((prev) =>
          prev.map((a) => (a.id === app.id ? { ...a, enabled: newStatus } : a))
        );
        setActionMessage(`Updated ${app.name} -> ${newStatus ? 'ENABLED' : 'DISABLED'}`);
      }
    } catch (err: any) {
      setActionMessage(`Failed to update ${app.name}: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleApplyPreset = async (preset: PresetItem) => {
    setUpdatingId(`preset-${preset.id}`);
    try {
      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetId: preset.id }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchApps();
        setActionMessage(`Applied preset: ${preset.name} (${preset.apps.length} apps configured)`);
      }
    } catch (err: any) {
      setActionMessage(`Preset error: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeploy = async (app: AppItem) => {
    setUpdatingId(app.id);
    try {
      const res = await fetch(`/api/apps/${app.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deploy' }),
      });
      const data = await res.json();
      if (data.success) {
        if (data.taskId) {
          openTerminal(data.taskId, `Deploying ${app.name}`);
        }
        setActionMessage(`Triggered deployment for ${app.name} (Task: ${data.taskId})`);
      }
    } catch (err: any) {
      setActionMessage(`Deployment error: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleInstantSync = async (appId?: string) => {
    if (appId) setUpdatingId(appId);
    setActionMessage(appId ? `Dispatching hard refresh for ${appId}...` : 'Dispatching Git push webhook to ArgoCD...');
    try {
      const res = await postArgoWebhook(appId ? { action: 'accelerate', appName: appId, hardRefresh: true } : { action: 'webhook' });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error);
      setActionMessage(data.message || 'Hard refresh initiated! Sub-second sync completed.');
      setTimeout(() => setActionMessage(null), 4000);
      fetchTelemetry();
    } catch (err: any) {
      setActionMessage(`Instant sync error: ${err.message}`);
      setTimeout(() => setActionMessage(null), 5000);
    } finally {
      if (appId) setUpdatingId(null);
    }
  };


  const handleCreateCustomApp = async () => {
    if (!customName.trim() || !customRepo.trim()) return;
    setSubmittingCustom(true);
    const generatedId = customId.trim() || customName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    try {
      const res = await fetch('/api/apps/custom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: generatedId,
          name: customName.trim(),
          category: customCategory,
          description: customDesc.trim() || `Custom application: ${customName}`,
          sourceType: customSource,
          repoURL: customRepo.trim(),
          chart: customChart.trim() || undefined,
          subdomain: customSubdomain.trim() || generatedId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(`Scaffolded custom application: ${customName} (${generatedId})`);
        setShowAddModal(false);
        setCustomName('');
        setCustomId('');
        setCustomRepo('');
        setCustomChart('');
        setCustomSubdomain('');
        fetchApps();
      } else {
        setActionMessage(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setActionMessage(`Failed to scaffold app: ${err.message}`);
    } finally {
      setSubmittingCustom(false);
    }
  };

  // RAM Calculation
  const enabledApps = apps.filter((a) => a.enabled);
  const totalEstimatedRamMb = enabledApps.reduce((acc, a) => acc + (a.estimatedMemoryMb || 256), 0);
  const hostRamMb = systemInfo?.totalMemMb || 16384;
  const ramPercent = Math.min(100, Math.round((totalEstimatedRamMb / hostRamMb) * 100));
  const isHighRam = ramPercent > 80;

  // Enabled app map for dependency verification
  const enabledAppIds = new Set(enabledApps.map((a) => a.id));

  const filteredApps = apps.filter((app) => {
    const matchesCat = selectedCategory === 'All' || app.category === selectedCategory;
    const matchesSearch =
      app.name.toLowerCase().includes(search.toLowerCase()) ||
      app.description.toLowerCase().includes(search.toLowerCase()) ||
      app.id.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center space-x-2">
              <Layers className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">Service Catalog & App Store</h2>
            </div>
            {/* GitOps Engine Selector */}
            <div className="flex items-center gap-1.5 p-1 bg-slate-950/80 rounded-lg border border-slate-800 text-xs">
              <span className="text-[10px] text-slate-400 font-semibold px-1.5 uppercase tracking-wider">GitOps Engine:</span>
              <button
                type="button"
                onClick={() => handleSwitchRunner('argocd')}
                disabled={switchingRunner || !can('config:update')}
                className={`px-2.5 py-1 rounded font-semibold text-xs transition-all cursor-pointer flex items-center space-x-1 ${
                  cdRunner === 'argocd'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Use ArgoCD GitOps Continuous Delivery"
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>ArgoCD</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchRunner('flux')}
                disabled={switchingRunner || !can('config:update')}
                className={`px-2.5 py-1 rounded font-semibold text-xs transition-all cursor-pointer flex items-center space-x-1 ${
                  cdRunner === 'flux'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Use FluxCD GitOps Toolkit v2"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>FluxCD</span>
              </button>
              <button
                type="button"
                onClick={() => handleSwitchRunner('both')}
                disabled={switchingRunner || !can('config:update')}
                className={`px-2.5 py-1 rounded font-semibold text-xs transition-all cursor-pointer flex items-center space-x-1 ${
                  cdRunner === 'both'
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Dual GitOps Runner: Deploy to both ArgoCD and FluxCD"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Dual Runner</span>
              </button>
            </div>

            {/* Controller status indicator for Flux */}
            {(cdRunner === 'flux' || cdRunner === 'both') && fluxStatus && (
              <span
                className={`text-[11px] font-mono px-2 py-0.5 rounded border flex items-center space-x-1 ${
                  fluxStatus.isHealthy
                    ? 'bg-emerald-950/60 border-emerald-500/50 text-emerald-300'
                    : 'bg-amber-950/60 border-amber-500/50 text-amber-300'
                }`}
                title={`${fluxStatus.activeControllers}/${fluxStatus.totalControllers} Flux controllers running`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${fluxStatus.isHealthy ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                <span>Flux: {fluxStatus.activeControllers}/{fluxStatus.totalControllers} {fluxStatus.isHealthy ? 'Healthy' : 'Degraded'}</span>
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400">
            {cdRunner === 'flux'
              ? 'Enable or deploy cloud-native applications via FluxCD GitOps controller, with live health probing & resource sizing'
              : cdRunner === 'both'
              ? 'Enable or deploy applications via dual GitOps orchestration (ArgoCD & FluxCD), with live health probing & resource sizing'
              : 'Enable or deploy any of the cloud-native applications via ArgoCD, with live health probing & resource sizing'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {(cdRunner === 'flux' || cdRunner === 'both') && (!fluxStatus?.isHealthy || fluxStatus?.activeControllers === 0) && (
            <button
              onClick={() => handleBootstrapFlux()}
              disabled={bootstrappingFlux || !can('flux:sync')}
              className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
              title="Run src/flux.sh to install FluxCD controllers into flux-system"
            >
              <Play className={`w-3.5 h-3.5 ${bootstrappingFlux ? 'animate-spin' : ''}`} />
              <span>{bootstrappingFlux ? 'Bootstrapping Flux...' : 'Bootstrap Flux Controllers'}</span>
            </button>
          )}
          {(cdRunner === 'flux' || cdRunner === 'both') && (
            <button
              onClick={() => handleReconcileFlux()}
              disabled={fluxReconciling || !can('flux:sync')}
              className="px-3 py-1.5 bg-purple-600/90 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
              title="Force Flux GitRepository and Kustomization reconciliation"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${fluxReconciling ? 'animate-spin' : ''}`} />
              <span>Reconcile Flux</span>
            </button>
          )}
          {(cdRunner === 'argocd' || cdRunner === 'both') && (
            <button
              onClick={() => handleInstantSync()}
              disabled={!(can('argo:sync') || can('flux:sync'))}
              className="px-3 py-1.5 bg-amber-600/90 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
              title="Trigger synthetic Git push webhook to accelerate ArgoCD sync"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Dispatch Webhook</span>
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            disabled={!can('apps:deploy')}
            className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors shadow-sm cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Custom App</span>
          </button>
          <span className="text-xs px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-lg">
            {enabledApps.length} Enabled / {apps.length} Total
          </span>
        </div>

      </div>

      {/* Laptop Profiler & Memory Estimator Bar */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold text-white">Laptop RAM & Workload Estimator</h3>
          </div>
          <div className="text-xs font-mono text-slate-400">
            Workload: <span className="text-sky-400 font-bold">{(totalEstimatedRamMb / 1024).toFixed(1)} GB</span> /{' '}
            {(hostRamMb / 1024).toFixed(1)} GB Physical RAM ({ramPercent}%)
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-slate-800 rounded-full h-3 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              isHighRam ? 'bg-amber-500' : 'bg-gradient-to-r from-sky-500 to-indigo-500'
            }`}
            style={{ width: `${ramPercent}%` }}
          />
        </div>

        {isHighRam && (
          <div className="flex items-center space-x-2 text-xs text-amber-400 bg-amber-950/40 p-2.5 rounded-lg border border-amber-800/40">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              Workload exceeds 80% of host physical RAM. Consider using the <strong>Core / Minimal</strong> preset to prevent Docker node pressure.
            </span>
          </div>
        )}

        {/* Presets */}
        <div className="pt-2 border-t border-slate-800/80">
          <div className="text-xs font-semibold text-slate-400 mb-2 flex items-center space-x-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Deployment Presets:</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleApplyPreset(preset)}
                disabled={Boolean(updatingId) || !can('apps:deploy')}
                className="px-3 py-1.5 bg-slate-800/90 hover:bg-slate-700 hover:text-white border border-slate-700 rounded-lg text-xs font-medium text-slate-300 transition-colors flex items-center space-x-1.5 disabled:opacity-50"
                title={`${preset.description} (~${(preset.estimatedMemoryMb / 1024).toFixed(1)} GB)`}
              >
                <span>{preset.name}</span>
                <span className="text-[10px] text-slate-500 font-mono">
                  ~{(preset.estimatedMemoryMb / 1024).toFixed(1)}GB
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {actionMessage && (
        <div className="p-4 bg-sky-950/60 border border-sky-800 text-sky-300 text-sm rounded-lg flex items-center justify-between">
          <span>{actionMessage}</span>
          <Link href="/terminal" className="underline hover:text-white text-xs font-semibold">
            View Live Terminal →
          </Link>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search applications, descriptions, technologies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedCategory === cat
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {selectedCategory === 'Custom & Local Charts' && (
        <div className="p-4 bg-gradient-to-r from-sky-950/40 via-slate-900 to-indigo-950/30 border border-sky-800/50 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-sky-200 shadow-sm animate-fadeIn">
          <div className="flex items-center space-x-2.5">
            <Ship className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              These charts are discovered live from your configured directory. Learn how to structure and add your own charts in the <strong>Documentation</strong> or manage them in <strong>Helm Hub</strong>.
            </span>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <Link
              href="/docs#custom-charts-overview"
              className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg transition-colors flex items-center space-x-1 shadow-sm"
            >
              <BookOpen className="w-3 h-3" />
              <span>Read Docs</span>
            </Link>
            <Link
              href="/helm"
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors flex items-center space-x-1"
            >
              <FolderOpen className="w-3 h-3 text-sky-400" />
              <span>Helm Hub</span>
            </Link>
          </div>
        </div>
      )}

      {/* Apps Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredApps.map((app) => {
          const argoStatus = argoApps[app.id];
          const probe = healthMap[app.id];

          return (
            <div
              key={app.id}
              className={`p-5 bg-slate-900 border rounded-xl flex flex-col justify-between transition-all ${
                app.enabled ? 'border-slate-800 hover:border-slate-700' : 'border-slate-800/40 opacity-70'
              }`}
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">{app.name}</h3>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className="text-[10px] font-mono text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/40">
                        {app.category}
                      </span>
                      {app.isLocalChart && (
                        <span className="text-[10px] font-mono font-medium text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/40">
                          Local Chart {app.chartVersion ? `v${app.chartVersion}` : ''}
                        </span>
                      )}
                      {app.estimatedMemoryMb && (
                        <span className="text-[10px] font-mono text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                          {app.estimatedMemoryMb}MB
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Enable Switch */}
                  <button
                    onClick={() => handleToggle(app)}
                    disabled={updatingId === app.id || !can('apps:deploy', { appId: app.id })}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      app.enabled ? 'bg-sky-500' : 'bg-slate-800'
                    }`}
                    title={app.enabled ? 'Enabled in .env.enabler' : 'Disabled in .env.enabler'}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        app.enabled ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed min-h-[38px]">
                  {app.description}
                </p>

                {/* GitOps & ArgoCD Status + Live Health Probe */}
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                  {argoStatus && (
                    <>
                      <span
                        className={`px-1.5 py-0.5 rounded border ${
                          argoStatus.syncStatus === 'Synced'
                            ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40'
                            : 'bg-amber-950/60 text-amber-400 border-amber-800/40'
                        }`}
                      >
                        {argoStatus.syncStatus}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded border ${
                          argoStatus.healthStatus === 'Healthy'
                            ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40'
                            : 'bg-indigo-950/60 text-indigo-400 border-indigo-800/40'
                        }`}
                      >
                        {argoStatus.healthStatus}
                      </span>
                    </>
                  )}

                  {/* Live Health Probe Badge */}
                  {probe && app.enabled && (
                    <span
                      className={`px-1.5 py-0.5 rounded border flex items-center space-x-1 ${
                        probe.status === 'healthy'
                          ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40'
                          : probe.status === 'starting'
                          ? 'bg-amber-950/60 text-amber-400 border-amber-800/40'
                          : 'bg-rose-950/60 text-rose-400 border-rose-800/40'
                      }`}
                      title={probe.status === 'healthy' ? `Live probe 200 OK (${probe.latencyMs}ms)` : `Probe status: ${probe.status}`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${probe.status === 'healthy' ? 'bg-emerald-400 animate-pulse' : probe.status === 'starting' ? 'bg-amber-400' : 'bg-rose-400'}`}></span>
                      <span>{probe.status === 'healthy' ? `${probe.latencyMs}ms` : probe.status}</span>
                    </span>
                  )}
                </div>

                {/* Dependency Pills */}
                {app.dependencies && app.dependencies.length > 0 && (
                  <div className="flex flex-wrap gap-1 items-center pt-1">
                    <span className="text-[10px] text-slate-500">Requires:</span>
                    {app.dependencies.map((dep) => {
                      const isMet = enabledAppIds.has(dep);
                      return (
                        <span
                          key={dep}
                          className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                            isMet
                              ? 'bg-emerald-950/40 text-emerald-400 border-emerald-800/30'
                              : 'bg-amber-950/60 text-amber-400 border-amber-800/50'
                          }`}
                        >
                          {dep} {isMet ? '✓' : '⚠'}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="pt-4 mt-4 border-t border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Link
                    href={`/apps/${app.id}`}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                    title="Inspect Kubernetes Manifests & Overrides"
                  >
                    <Code className="w-4 h-4" />
                  </Link>
                  {app.docsUrl && (
                    <a
                      href={app.docsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                      title="Official Documentation"
                    >
                      <BookOpen className="w-4 h-4" />
                    </a>
                  )}
                  {app.ingressUrl && app.enabled && (
                    <a
                      href={app.ingressUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 bg-sky-950 hover:bg-sky-900 text-sky-400 border border-sky-800/50 rounded-md transition-colors"
                      title={`Open ${app.ingressUrl}`}
                    >
                      <Globe className="w-4 h-4" />
                    </a>
                  )}
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleInstantSync(app.id)}
                    disabled={updatingId === app.id || !app.enabled || !(can('argo:sync', { appId: app.id }) || can('flux:sync', { appId: app.id }))}
                    className="text-xs px-2.5 py-1.5 bg-amber-950/70 hover:bg-amber-600 hover:text-white text-amber-300 border border-amber-800/60 rounded-md transition-colors flex items-center space-x-1.5 disabled:opacity-40 disabled:hover:bg-amber-950/70 cursor-pointer"
                    title="Sub-Second Hard Refresh & Git Sync"
                  >
                    <Zap className="w-3 h-3 text-amber-400" />
                    <span>Instant Sync</span>
                  </button>
                  <button
                    onClick={() => handleDeploy(app)}
                    disabled={updatingId === app.id || !app.enabled || !can('apps:deploy', { appId: app.id })}
                    className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-sky-600 hover:text-white text-slate-300 border border-slate-700 rounded-md transition-colors flex items-center space-x-1.5 disabled:opacity-40 disabled:hover:bg-slate-800 cursor-pointer"
                  >
                    <Play className="w-3 h-3" />
                    <span>Deploy</span>
                  </button>
                </div>
              </div>

            </div>
          );
        })}
      </div>

      {/* Add Custom App Wizard Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-xl w-full max-w-lg p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Add Custom Application</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-400 mb-1">App Name</label>
                  <input
                    type="text"
                    placeholder="e.g. My Next.js Service"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-400 mb-1">App ID (Kebab-case)</label>
                  <input
                    type="text"
                    placeholder="e.g. my-service"
                    value={customId}
                    onChange={(e) => setCustomId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-400 mb-1">Category</label>
                  <select
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500"
                  >
                    {CATEGORIES.filter((c) => c !== 'All').map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-400 mb-1">Subdomain</label>
                  <input
                    type="text"
                    placeholder="e.g. myservice"
                    value={customSubdomain}
                    onChange={(e) => setCustomSubdomain(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1">Source Type</label>
                <div className="flex items-center space-x-4 pt-1">
                  <label className="flex items-center space-x-1.5 cursor-pointer text-slate-300">
                    <input
                      type="radio"
                      name="sourceType"
                      checked={customSource === 'helm'}
                      onChange={() => setCustomSource('helm')}
                      className="text-sky-500 focus:ring-0"
                    />
                    <span>Helm Chart Repository</span>
                  </label>
                  <label className="flex items-center space-x-1.5 cursor-pointer text-slate-300">
                    <input
                      type="radio"
                      name="sourceType"
                      checked={customSource === 'git'}
                      onChange={() => setCustomSource('git')}
                      className="text-sky-500 focus:ring-0"
                    />
                    <span>Git Repository</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-400 mb-1">
                  {customSource === 'helm' ? 'Helm Repo URL' : 'Git Repo URL'}
                </label>
                <input
                  type="text"
                  placeholder={customSource === 'helm' ? 'https://charts.bitnami.com/bitnami' : 'https://github.com/org/repo.git'}
                  value={customRepo}
                  onChange={(e) => setCustomRepo(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>

              {customSource === 'helm' && (
                <div>
                  <label className="block font-semibold text-slate-400 mb-1">Chart Name</label>
                  <input
                    type="text"
                    placeholder="e.g. nginx or redis"
                    value={customChart}
                    onChange={(e) => setCustomChart(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end space-x-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateCustomApp}
                disabled={submittingCustom || !customName.trim() || !customRepo.trim()}
                className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
              >
                {submittingCustom ? 'Scaffolding...' : 'Scaffold & Register'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
