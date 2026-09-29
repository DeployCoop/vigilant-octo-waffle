'use client';

import { useState, useEffect } from 'react';
import {
  RotateCcw,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Play,
  RefreshCw,
  GitBranch,
  Layers,
  ArrowRight,
  Shield,
  Activity,
  Globe,
  Network,
  Download,
  Terminal,
  Radio,
} from 'lucide-react';

interface RolloutInfo {
  name: string;
  namespace: string;
  status: 'Healthy' | 'Progressing' | 'Paused' | 'Degraded';
  canaryWeight: number;
  currentStep: number;
  totalSteps: number;
  stableRevision: string;
  canaryRevision: string;
  replicas: {
    desired: number;
    stable: number;
    canary: number;
  };
  strategy: 'canary' | 'blue-green';
  lastUpdated: string;
}

interface GatewayRoute {
  name: string;
  namespace: string;
  hostnames?: string[];
  rules?: any[];
}

interface GatewayStatusData {
  crdsInstalled: boolean;
  defaultGatewayExists: boolean;
  gatewayStatus: string;
  gatewayAddress: string;
  routesCount: number;
  routes: GatewayRoute[];
}

export default function RolloutsStudioPage() {
  const [mode, setMode] = useState<'argo' | 'gateway'>('argo');
  const [rollouts, setRollouts] = useState<RolloutInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRollout, setActiveRollout] = useState<RolloutInfo | null>(null);
  const [sliderWeight, setSliderWeight] = useState<number>(20);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Gateway API State
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatusData | null>(null);
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [gwNotice, setGwNotice] = useState<string | null>(null);
  const [gwActionLoading, setGwActionLoading] = useState(false);
  const [gwForm, setGwForm] = useState({
    name: 'vow-canary',
    namespace: 'default',
    hostname: 'app.cluster.local',
    stableService: 'web-stable',
    canaryService: 'web-canary',
    stableWeight: 80,
    canaryWeight: 20,
    pathPrefix: '/',
    dryRun: false,
  });

  const loadRollouts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rollouts');
      const data = await res.json();
      const list: RolloutInfo[] = data.rollouts || [];
      setRollouts(list);
      if (list.length > 0 && !activeRollout) {
        setActiveRollout(list[0]);
        setSliderWeight(list[0].canaryWeight);
      } else if (activeRollout) {
        const updated = list.find((r) => r.name === activeRollout.name && r.namespace === activeRollout.namespace);
        if (updated) {
          setActiveRollout(updated);
          setSliderWeight(updated.canaryWeight);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadGatewayStatus = async () => {
    setGatewayLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s?action=gateway');
      if (res.ok) {
        const data = await res.json();
        setGatewayStatus(data);
      }
    } catch (err) {
      console.error('Failed to load gateway status:', err);
    } finally {
      setGatewayLoading(false);
    }
  };

  useEffect(() => {
    loadRollouts();
    loadGatewayStatus();
  }, []);

  const handleSetWeight = async (weight: number) => {
    if (!activeRollout) return;
    setActionLoading(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/rollouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_weight',
          name: activeRollout.name,
          namespace: activeRollout.namespace,
          weight,
        }),
      });
      const data = await res.json();
      setActionNotice(data.message || `Updated canary weight to ${weight}%`);
      loadRollouts();
    } catch (err: any) {
      setActionNotice(`Error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handlePromote = async (full = false) => {
    if (!activeRollout) return;
    setActionLoading(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/rollouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promote',
          name: activeRollout.name,
          namespace: activeRollout.namespace,
          full,
        }),
      });
      const data = await res.json();
      setActionNotice(data.message || (full ? 'Promoted to full stable!' : 'Promoted to next step!'));
      loadRollouts();
    } catch (err: any) {
      setActionNotice(`Promotion failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAbort = async () => {
    if (!activeRollout) return;
    setActionLoading(true);
    setActionNotice(null);
    try {
      const res = await fetch('/api/rollouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'abort',
          name: activeRollout.name,
          namespace: activeRollout.namespace,
        }),
      });
      const data = await res.json();
      setActionNotice(data.message || 'Canary rollout aborted. Pointed 100% traffic to stable.');
      loadRollouts();
    } catch (err: any) {
      setActionNotice(`Abort error: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleInstallGatewayCrds = async () => {
    setGwActionLoading(true);
    setGwNotice(null);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gateway-install-crds' }),
      });
      const data = await res.json();
      setGwNotice(data.message || 'Gateway API CRDs installation initiated');
      setTimeout(loadGatewayStatus, 2000);
    } catch (err: any) {
      setGwNotice(`Error: ${err.message}`);
    } finally {
      setGwActionLoading(false);
    }
  };

  const handleDeployGateway = async () => {
    setGwActionLoading(true);
    setGwNotice(null);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'gateway-deploy',
          namespace: gwForm.namespace,
          gatewayName: 'default-gateway',
        }),
      });
      const data = await res.json();
      setGwNotice(data.message || 'Gateway deployment initiated');
      setTimeout(loadGatewayStatus, 2000);
    } catch (err: any) {
      setGwNotice(`Error: ${err.message}`);
    } finally {
      setGwActionLoading(false);
    }
  };

  const handleApplyGatewayCanary = async () => {
    setGwActionLoading(true);
    setGwNotice(null);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'gateway-canary',
          name: gwForm.name,
          namespace: gwForm.namespace,
          hostname: gwForm.hostname,
          stableService: gwForm.stableService,
          stableWeight: gwForm.stableWeight,
          canaryService: gwForm.canaryService,
          canaryWeight: gwForm.canaryWeight,
          pathPrefix: gwForm.pathPrefix,
          dryRun: gwForm.dryRun,
        }),
      });
      const data = await res.json();
      setGwNotice(data.message || `Applied Gateway canary route (${gwForm.stableWeight}% / ${gwForm.canaryWeight}%)`);
      setTimeout(loadGatewayStatus, 1500);
    } catch (err: any) {
      setGwNotice(`Error applying canary: ${err.message}`);
    } finally {
      setGwActionLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-3">
            <Sliders className="w-6 h-6 text-sky-400" />
            <span>Traffic Shifter & Progressive Rollouts</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Progressive delivery & L7 ingress traffic management via Argo Rollouts and Kubernetes Gateway API v1.1+.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Mode Switcher Tabs */}
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-1">
            <button
              onClick={() => setMode('argo')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                mode === 'argo'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Argo Rollouts</span>
            </button>
            <button
              onClick={() => setMode('gateway')}
              className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-medium transition cursor-pointer ${
                mode === 'gateway'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              <span>Gateway API v1.1+ Canary</span>
            </button>
          </div>

          <button
            onClick={() => {
              if (mode === 'argo') loadRollouts();
              else loadGatewayStatus();
            }}
            disabled={loading || gatewayLoading}
            className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading || gatewayLoading ? 'animate-spin text-sky-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {mode === 'argo' ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Rollouts List */}
        <div className="md:col-span-1 bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Active Deployments</span>
            <span className="text-xs text-slate-500">{rollouts.length}</span>
          </div>

          <div className="space-y-1">
            {rollouts.map((r) => (
              <button
                key={`${r.namespace}/${r.name}`}
                onClick={() => {
                  setActiveRollout(r);
                  setSliderWeight(r.canaryWeight);
                }}
                className={`w-full text-left p-3 rounded-lg text-xs transition cursor-pointer ${
                  activeRollout?.name === r.name && activeRollout?.namespace === r.namespace
                    ? 'bg-sky-500/10 text-sky-300 border border-sky-500/30 font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200 truncate">{r.name}</span>
                  <span className="text-[10px] font-mono text-sky-400 bg-sky-950 px-1.5 py-0.5 rounded border border-sky-800/40">
                    {r.canaryWeight}%
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between">
                  <span>{r.namespace}</span>
                  <span className="capitalize">{r.status}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Selected Rollout Controller */}
        <div className="md:col-span-3 space-y-6">
          {activeRollout ? (
            <>
              {/* Traffic Split Visual Gauge */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-800">
                  <div>
                    <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                      <span>{activeRollout.name}</span>
                      <span className="text-xs font-mono font-normal text-slate-400">({activeRollout.namespace})</span>
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">Strategy: {activeRollout.strategy.toUpperCase()} • Step {activeRollout.currentStep} of {activeRollout.totalSteps}</p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handlePromote(false)}
                      disabled={actionLoading}
                      className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium border border-slate-700 transition cursor-pointer"
                    >
                      Step Promote (+25%)
                    </button>
                    <button
                      onClick={() => handlePromote(true)}
                      disabled={actionLoading}
                      className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                    >
                      Full Promote (100%)
                    </button>
                    <button
                      onClick={handleAbort}
                      disabled={actionLoading}
                      className="px-3 py-1.5 bg-rose-950/80 hover:bg-rose-900 text-rose-300 border border-rose-800/60 rounded-lg text-xs font-medium transition cursor-pointer"
                    >
                      Abort Canary
                    </button>
                  </div>
                </div>

                {/* Visual Ratio Bar */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-sky-400 font-semibold">
                      Stable: {100 - activeRollout.canaryWeight}% ({activeRollout.stableRevision})
                    </span>
                    <span className="text-purple-400 font-semibold">
                      Canary: {activeRollout.canaryWeight}% ({activeRollout.canaryRevision})
                    </span>
                  </div>

                  <div className="w-full h-4 bg-slate-950 rounded-full overflow-hidden flex border border-slate-800">
                    <div
                      style={{ width: `${100 - activeRollout.canaryWeight}%` }}
                      className="bg-sky-500 h-full transition-all duration-300"
                    />
                    <div
                      style={{ width: `${activeRollout.canaryWeight}%` }}
                      className="bg-purple-500 h-full transition-all duration-300"
                    />
                  </div>
                </div>

                {/* Live Traffic Weight Slider */}
                <div className="bg-slate-950/80 rounded-xl p-5 border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Adjust Canary Traffic Weight
                    </label>
                    <span className="font-mono text-sm text-purple-400 font-bold">{sliderWeight}% Traffic</span>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={sliderWeight}
                    onChange={(e) => setSliderWeight(parseInt(e.target.value))}
                    className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
                  />

                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSetWeight(sliderWeight)}
                      disabled={actionLoading || sliderWeight === activeRollout.canaryWeight}
                      className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                    >
                      {actionLoading ? 'Shifting Traffic...' : 'Apply Traffic Split'}
                    </button>
                  </div>
                </div>

                {actionNotice && (
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-sky-300">
                    {actionNotice}
                  </div>
                )}
              </div>

              {/* Replica Sets Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-2">
                  <span className="text-xs text-sky-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Stable Pods ({activeRollout.stableRevision})</span>
                  </span>
                  <div className="text-2xl font-bold text-slate-100">{activeRollout.replicas.stable} Replicas</div>
                  <p className="text-xs text-slate-500">Handling {100 - activeRollout.canaryWeight}% of user ingress connections</p>
                </div>

                <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-2">
                  <span className="text-xs text-purple-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>Canary Pods ({activeRollout.canaryRevision})</span>
                  </span>
                  <div className="text-2xl font-bold text-slate-100">{activeRollout.replicas.canary} Replicas</div>
                  <p className="text-xs text-slate-500">Handling {activeRollout.canaryWeight}% of progressive canary traffic</p>
                </div>
              </div>
            </>
          ) : (
            <div className="p-16 text-center text-xs text-slate-500">
              Select an active deployment or rollout from the sidebar.
            </div>
          )}
        </div>
      </div>
      ) : (
        /* Gateway API v1.1+ Canary Traffic Controller */
        <div className="space-y-6">
          {/* Status Ribbon */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-1.5">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Network className="w-4 h-4 text-purple-400" />
                <span>Gateway API CRDs</span>
              </span>
              <div className="flex items-center justify-between">
                <span className={`text-sm font-bold ${gatewayStatus?.crdsInstalled ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {gatewayStatus?.crdsInstalled ? 'Installed (v1.1+)' : 'Not Installed'}
                </span>
                {!gatewayStatus?.crdsInstalled && (
                  <button
                    onClick={handleInstallGatewayCrds}
                    disabled={gwActionLoading}
                    className="px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-[10px] font-medium transition cursor-pointer"
                  >
                    Install CRDs
                  </button>
                )}
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-1.5">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Radio className="w-4 h-4 text-sky-400" />
                <span>Default Gateway</span>
              </span>
              <div className="flex items-center justify-between">
                <span className={`text-sm font-bold ${gatewayStatus?.defaultGatewayExists ? 'text-emerald-400' : 'text-slate-400'}`}>
                  {gatewayStatus?.defaultGatewayExists ? 'Active' : 'Not Configured'}
                </span>
                {!gatewayStatus?.defaultGatewayExists && (
                  <button
                    onClick={handleDeployGateway}
                    disabled={gwActionLoading}
                    className="px-2 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-[10px] font-medium transition cursor-pointer"
                  >
                    Deploy Gateway
                  </button>
                )}
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-1.5">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Globe className="w-4 h-4 text-indigo-400" />
                <span>Ingress Endpoint</span>
              </span>
              <div className="text-sm font-mono font-bold text-slate-200 truncate">
                {gatewayStatus?.gatewayAddress || '127.0.0.1'}
              </div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-1.5">
              <span className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span>HTTPRoutes</span>
              </span>
              <div className="text-sm font-mono font-bold text-slate-200">
                {gatewayStatus?.routesCount ?? 0} Active Routes
              </div>
            </div>
          </div>

          {/* Traffic Shifter Card */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                  <span>L7 HTTPRoute Weighted Traffic Splitter</span>
                  <span className="text-xs font-mono font-normal text-purple-400 bg-purple-950 px-2 py-0.5 rounded border border-purple-800/40">
                    gateway.networking.k8s.io/v1
                  </span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Dynamically split HTTP request traffic between stable and canary backend services with sub-second convergence.
                </p>
              </div>

              {/* Quick Preset Buttons */}
              <div className="flex items-center space-x-1.5">
                {[
                  { label: '100% Stable', stable: 100, canary: 0 },
                  { label: '90 / 10', stable: 90, canary: 10 },
                  { label: '80 / 20', stable: 80, canary: 20 },
                  { label: '50 / 50', stable: 50, canary: 50 },
                  { label: '100% Canary', stable: 0, canary: 100 },
                ].map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() =>
                      setGwForm((prev) => ({
                        ...prev,
                        stableWeight: preset.stable,
                        canaryWeight: preset.canary,
                      }))
                    }
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded text-[11px] font-medium border border-slate-700/60 transition cursor-pointer"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Visual Ratio Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-sky-400 font-semibold flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block" />
                  <span>Stable Service: {gwForm.stableWeight}% ({gwForm.stableService})</span>
                </span>
                <span className="text-purple-400 font-semibold flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block" />
                  <span>Canary Service: {gwForm.canaryWeight}% ({gwForm.canaryService})</span>
                </span>
              </div>

              <div className="w-full h-5 bg-slate-950 rounded-full overflow-hidden flex border border-slate-800 shadow-inner">
                <div
                  style={{ width: `${gwForm.stableWeight}%` }}
                  className="bg-sky-500 h-full transition-all duration-300 flex items-center justify-center text-[10px] font-mono font-bold text-slate-950"
                >
                  {gwForm.stableWeight > 10 ? `${gwForm.stableWeight}%` : ''}
                </div>
                <div
                  style={{ width: `${gwForm.canaryWeight}%` }}
                  className="bg-purple-500 h-full transition-all duration-300 flex items-center justify-center text-[10px] font-mono font-bold text-white"
                >
                  {gwForm.canaryWeight > 10 ? `${gwForm.canaryWeight}%` : ''}
                </div>
              </div>
            </div>

            {/* Live Slider */}
            <div className="bg-slate-950/80 rounded-xl p-5 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Canary Traffic Proportion
                </label>
                <span className="font-mono text-sm text-purple-400 font-bold">{gwForm.canaryWeight}% Canary Traffic</span>
              </div>

              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={gwForm.canaryWeight}
                onChange={(e) => {
                  const canary = parseInt(e.target.value);
                  setGwForm((prev) => ({
                    ...prev,
                    canaryWeight: canary,
                    stableWeight: 100 - canary,
                  }));
                }}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
            </div>

            {/* HTTPRoute Parameters Form */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  HTTPRoute Name
                </label>
                <input
                  type="text"
                  value={gwForm.name}
                  onChange={(e) => setGwForm({ ...gwForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500/60"
                  placeholder="vow-canary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Namespace
                </label>
                <input
                  type="text"
                  value={gwForm.namespace}
                  onChange={(e) => setGwForm({ ...gwForm, namespace: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500/60"
                  placeholder="default"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Hostname / Domain
                </label>
                <input
                  type="text"
                  value={gwForm.hostname}
                  onChange={(e) => setGwForm({ ...gwForm, hostname: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500/60"
                  placeholder="app.cluster.local"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Stable Service Name
                </label>
                <input
                  type="text"
                  value={gwForm.stableService}
                  onChange={(e) => setGwForm({ ...gwForm, stableService: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500/60"
                  placeholder="web-stable"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Canary Service Name
                </label>
                <input
                  type="text"
                  value={gwForm.canaryService}
                  onChange={(e) => setGwForm({ ...gwForm, canaryService: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500/60"
                  placeholder="web-canary"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Path Prefix
                </label>
                <input
                  type="text"
                  value={gwForm.pathPrefix}
                  onChange={(e) => setGwForm({ ...gwForm, pathPrefix: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500/60"
                  placeholder="/"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <label className="flex items-center space-x-2 text-xs text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={gwForm.dryRun}
                  onChange={(e) => setGwForm({ ...gwForm, dryRun: e.target.checked })}
                  className="rounded border-slate-800 bg-slate-950 text-purple-600 focus:ring-0"
                />
                <span>Dry Run (manifest validation only, do not apply to cluster)</span>
              </label>

              <button
                onClick={handleApplyGatewayCanary}
                disabled={gwActionLoading}
                className="px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer flex items-center space-x-2 shadow-lg shadow-purple-500/20"
              >
                {gwActionLoading ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Applying Route...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Apply Gateway Canary Split</span>
                  </>
                )}
              </button>
            </div>

            {gwNotice && (
              <div className="p-3 bg-slate-950 border border-purple-800/40 rounded-lg text-xs font-mono text-purple-300 flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />
                <span>{gwNotice}</span>
              </div>
            )}
          </div>

          {/* Discovered HTTPRoutes Table */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                <Network className="w-4 h-4 text-purple-400" />
                <span>Discovered Gateway HTTPRoutes ({gatewayStatus?.routes?.length || 0})</span>
              </span>
              <button
                onClick={loadGatewayStatus}
                disabled={gatewayLoading}
                className="text-xs text-slate-400 hover:text-slate-200 transition cursor-pointer flex items-center space-x-1"
              >
                <RefreshCw className={`w-3 h-3 ${gatewayLoading ? 'animate-spin' : ''}`} />
                <span>Reload</span>
              </button>
            </div>

            {gatewayStatus?.routes && gatewayStatus.routes.length > 0 ? (
              <div className="divide-y divide-slate-800/60">
                {gatewayStatus.routes.map((rt, idx) => (
                  <div key={idx} className="py-3 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-xs text-slate-200 flex items-center space-x-2">
                        <span>{rt.name}</span>
                        <span className="text-[10px] font-mono text-slate-500 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                          {rt.namespace}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                        Hostnames: {rt.hostnames?.join(', ') || '*'}
                      </div>
                    </div>
                    <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[10px] font-mono">
                      Active
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-xs text-slate-500">
                No custom HTTPRoutes detected. Configure and apply your first canary route above.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
