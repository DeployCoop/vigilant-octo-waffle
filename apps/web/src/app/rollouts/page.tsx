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

export default function RolloutsStudioPage() {
  const [rollouts, setRollouts] = useState<RolloutInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRollout, setActiveRollout] = useState<RolloutInfo | null>(null);
  const [sliderWeight, setSliderWeight] = useState<number>(20);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

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

  useEffect(() => {
    loadRollouts();
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-3">
            <Sliders className="w-6 h-6 text-sky-400" />
            <span>Argo Rollouts Studio & Canary Traffic Shifter</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Progressive delivery controller: dynamically split ingress traffic between Stable and Canary revisions with instant promotion & rollback.
          </p>
        </div>

        <button
          onClick={loadRollouts}
          disabled={loading}
          className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
          <span>Refresh Rollouts</span>
        </button>
      </div>

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
    </div>
  );
}
