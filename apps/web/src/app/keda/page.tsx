'use client';

import { useState, useEffect } from 'react';
import {
  TrendingUp,
  Zap,
  Activity,
  Play,
  RefreshCw,
  Server,
  Layers,
  CheckCircle2,
  Sliders,
  Flame,
} from 'lucide-react';

interface KedaScaledObject {
  id: string;
  name: string;
  namespace: string;
  targetWorkload: string;
  minReplicas: number;
  maxReplicas: number;
  currentReplicas: number;
  triggerType: 'redis_queue' | 'postgres_connections' | 'traefik_rps' | 'cron_schedule';
  triggerMetadata: {
    metricName: string;
    threshold: string;
    currentValue: string;
  };
  status: 'Active' | 'Ready' | 'Paused';
}

interface LoadTestResult {
  executedAt: string;
  targetWorkload: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  peakRps: number;
  initialReplicas: number;
  peakReplicas: number;
  scaleToZeroVerified: boolean;
  replicaScalingHistory: Array<{ second: number; replicas: number; currentRps: number }>;
}

export default function KedaAutoscalerPage() {
  const [scaledObjects, setScaledObjects] = useState<KedaScaledObject[]>([]);
  const [loading, setLoading] = useState(true);

  // Load test state
  const [targetWorkload, setTargetWorkload] = useState('nextcloud-worker');
  const [virtualUsers, setVirtualUsers] = useState(25);
  const [durationSeconds, setDurationSeconds] = useState(15);
  const [targetRps, setTargetRps] = useState(300);
  const [pattern, setPattern] = useState<'SPIKE' | 'RAMP' | 'CONSTANT'>('SPIKE');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<LoadTestResult | null>(null);

  const fetchScaledObjects = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/keda');
      const data = await res.json();
      setScaledObjects(data.scaledObjects || []);
    } catch (err) {
      console.error('Failed to load ScaledObjects:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScaledObjects();
  }, []);

  const handleLaunchLoad = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/keda', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetWorkload,
          virtualUsers,
          durationSeconds,
          targetRps,
          pattern,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTestResult(data.result);
        fetchScaledObjects();
      }
    } catch (err) {
      console.error('Load test failed:', err);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-sky-500/10 text-sky-400 rounded-xl border border-sky-500/20">
            <TrendingUp className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">OctoScale: KEDA Event-Driven Autoscaler</h1>
            <p className="text-sm text-slate-400">
              Autoscale workloads on Redis queue lengths, database queries, and HTTP RPS with scale-to-zero verification
            </p>
          </div>
        </div>

        <button
          onClick={fetchScaledObjects}
          disabled={loading}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* ScaledObjects Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {scaledObjects.map((obj) => (
          <div
            key={obj.id}
            className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-4 hover:border-slate-700 transition"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-base font-bold text-slate-100">{obj.name}</h3>
                <div className="text-xs text-slate-400 font-mono mt-0.5">
                  Target: <span className="text-sky-400">{obj.targetWorkload}</span> ({obj.namespace})
                </div>
              </div>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                {obj.status}
              </span>
            </div>

            <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-2 text-xs font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Trigger Source:</span>
                <span className="text-violet-400 font-semibold">{obj.triggerType}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Metric Threshold:</span>
                <span className="text-slate-200">{obj.triggerMetadata.threshold}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Live Metric Value:</span>
                <span className="text-amber-400">{obj.triggerMetadata.currentValue}</span>
              </div>
            </div>

            <div className="flex justify-between items-center text-xs pt-2 border-t border-slate-800/60 font-mono">
              <span className="text-slate-400">Replicas Range:</span>
              <span className="text-slate-200 font-bold">
                {obj.minReplicas} (min) ➔ {obj.currentReplicas} (live) ➔ {obj.maxReplicas} (max)
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Synthetic Traffic Generator & Live Scaling Graph */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-6">
        <div className="flex items-center space-x-2">
          <Flame className="w-5 h-5 text-amber-400" />
          <h2 className="text-base font-bold text-slate-100">Synthetic Traffic Cannon & Scale-to-Zero Verification</h2>
        </div>
        <p className="text-xs text-slate-400">
          Inject configurable virtual user request storms to verify automated horizontal scaling and scale-to-zero responsiveness.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-end text-xs">
          <div>
            <label className="block text-slate-400 mb-1 font-medium">Target Scaled Workload</label>
            <select
              value={targetWorkload}
              onChange={(e) => setTargetWorkload(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500 font-mono"
            >
              <option value="nextcloud-worker">nextcloud-worker (Scale-to-Zero)</option>
              <option value="keycloak">keycloak (HTTP RPS Scaler)</option>
              <option value="postgres-read-replica">postgres-read-replica (Connection Scaler)</option>
            </select>
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Virtual Users: {virtualUsers}</label>
            <input
              type="range"
              min={5}
              max={100}
              value={virtualUsers}
              onChange={(e) => setVirtualUsers(Number(e.target.value))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Peak RPS</label>
            <input
              type="number"
              value={targetRps}
              onChange={(e) => setTargetRps(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 font-mono outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Traffic Curve Pattern</label>
            <select
              value={pattern}
              onChange={(e) => setPattern(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-sky-500"
            >
              <option value="SPIKE">Traffic Spike Burst</option>
              <option value="RAMP">Linear Ramp Up</option>
              <option value="CONSTANT">Sustained Constant Load</option>
            </select>
          </div>

          <div>
            <button
              onClick={handleLaunchLoad}
              disabled={testing}
              className="w-full flex items-center justify-center space-x-2 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-lg shadow-sm transition"
            >
              {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>{testing ? 'Injecting Load...' : 'Fire Traffic Cannon'}</span>
            </button>
          </div>
        </div>

        {/* Test Result Scaling Chart */}
        {testResult && (
          <div className="space-y-4 pt-4 border-t border-slate-800">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <span className="text-slate-500">Total Injected Requests:</span>
                <div className="text-base font-bold text-slate-200 mt-0.5">{testResult.totalRequests.toLocaleString()}</div>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <span className="text-slate-500">Replicas Scaled:</span>
                <div className="text-base font-bold text-sky-400 mt-0.5">
                  {testResult.initialReplicas} ➔ {testResult.peakReplicas} Pods
                </div>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <span className="text-slate-500">P95 Latency:</span>
                <div className="text-base font-bold text-emerald-400 mt-0.5">{testResult.p95LatencyMs} ms</div>
              </div>
              <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
                <span className="text-slate-500">Scale-to-Zero Tested:</span>
                <div className="text-base font-bold text-violet-400 mt-0.5">
                  {testResult.scaleToZeroVerified ? 'VERIFIED (0 Pods Idle)' : 'N/A (Min 1)'}
                </div>
              </div>
            </div>

            {/* Step Timeline Graphic */}
            <div className="space-y-2">
              <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Seconds Timeline: Traffic (RPS) vs Autoscaled Replicas
              </div>
              <div className="h-28 bg-slate-950 border border-slate-800 rounded-xl p-3 flex items-end space-x-1.5 overflow-x-auto">
                {testResult.replicaScalingHistory.map((step) => {
                  const heightPct = Math.min(100, Math.max(10, Math.round((step.currentRps / testResult.peakRps) * 100)));
                  return (
                    <div key={step.second} className="flex-1 min-w-[20px] flex flex-col items-center justify-end h-full">
                      <div className="text-[9px] font-mono text-sky-400 font-bold mb-1">{step.replicas}p</div>
                      <div
                        className="w-full bg-gradient-to-t from-sky-600 to-indigo-500 rounded-t"
                        style={{ height: `${heightPct}%` }}
                        title={`Second ${step.second}: ${step.currentRps} RPS, ${step.replicas} replicas`}
                      />
                      <div className="text-[8px] font-mono text-slate-600 mt-1">{step.second}s</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
