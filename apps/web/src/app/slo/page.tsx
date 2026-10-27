'use client';

import { useState, useEffect } from 'react';
import {
  Target,
  Activity,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Zap,
  Sliders,
  Flame,
  Check,
  RotateCcw,
} from 'lucide-react';

interface ServiceSloRecord {
  id: string;
  serviceName: string;
  namespace: string;
  availabilityTarget: number;
  currentAvailability: number;
  latencyTargetP99Ms: number;
  currentLatencyP99Ms: number;
  errorBudgetRemainingPct: number;
  errorBudgetTotalMinutes: number;
  consumedMinutes: number;
  burnRate1h: number;
  burnRate6h: number;
  burnRate24h: number;
  status: 'HEALTHY' | 'WARNING' | 'CRITICAL_BURN' | 'EXHAUSTED';
  circuitBreakerTripped: boolean;
}

export default function SloCockpitPage() {
  const [slos, setSlos] = useState<ServiceSloRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchSlos = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/slo');
      const data = await res.json();
      setSlos(data.slos || []);
    } catch (err) {
      console.error('Failed to load SLO telemetry:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlos();
  }, []);

  const handleToggleCircuitBreaker = async (serviceId: string, currentTripped: boolean) => {
    setActionInProgress(serviceId);
    try {
      const res = await fetch('/api/slo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          action: 'toggle_circuit_breaker',
          tripped: !currentTripped,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(data.message);
        fetchSlos();
      }
    } catch (err) {
      console.error('Failed to toggle circuit breaker:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-rose-500/10 text-rose-400 rounded-xl border border-rose-500/20">
            <Target className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">SRE SLO & Error Budget Burn-Rate Cockpit</h1>
            <p className="text-sm text-slate-400">
              Track multi-window error budgets, monitor burn rates, and automated deployment freezes for Argo Rollouts
            </p>
          </div>
        </div>

        <button
          onClick={fetchSlos}
          disabled={loading}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {actionMessage && (
        <div className="p-3 bg-sky-500/10 border border-sky-500/20 rounded-xl text-xs text-sky-300 flex justify-between items-center">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
      )}

      {/* SRE Global Alerting Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Target Services Monitored</div>
          <div className="text-2xl font-bold text-slate-100">{slos.length} Critical Services</div>
          <div className="text-[11px] text-slate-500 mt-1">30-day rolling evaluation</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Deployments Frozen (Circuit Breaker)</div>
          <div className="text-2xl font-bold text-rose-400">
            {slos.filter((s) => s.circuitBreakerTripped).length} Active Halt
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Canary promotions paused</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Fleet Availability Parity</div>
          <div className="text-2xl font-bold text-emerald-400">99.78%</div>
          <div className="text-[11px] text-emerald-400 mt-1">Target: &gt;99.5% minimum</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Fast Burn Rate Alert</div>
          <div className="text-2xl font-bold text-amber-400">14.4x Max Cap</div>
          <div className="text-[11px] text-slate-500 mt-1">Google SRE Workbook spec</div>
        </div>
      </div>

      {/* Service SLO Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {slos.map((slo) => {
          const isHealthy = slo.status === 'HEALTHY';
          const isCritical = slo.status === 'CRITICAL_BURN' || slo.circuitBreakerTripped;

          return (
            <div
              key={slo.id}
              className={`bg-slate-900/40 border rounded-2xl p-6 transition flex flex-col justify-between space-y-6 ${
                isCritical ? 'border-rose-500/40 shadow-sm' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-base font-bold text-slate-100">{slo.serviceName}</h3>
                    <div className="text-xs text-slate-400 font-mono">namespace: {slo.namespace}</div>
                  </div>

                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                      isCritical
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        : isHealthy
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {isCritical ? 'CRITICAL FAST BURN' : isHealthy ? 'SLO HEALTHY' : 'WARNING'}
                  </span>
                </div>

                {/* Progress Gauge for Error Budget */}
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Remaining Error Budget</span>
                    <span className={`font-mono font-bold ${slo.errorBudgetRemainingPct > 50 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {slo.errorBudgetRemainingPct}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
                    <div
                      className={`h-full transition-all duration-500 ${
                        slo.errorBudgetRemainingPct > 50
                          ? 'bg-emerald-500'
                          : slo.errorBudgetRemainingPct > 25
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                      }`}
                      style={{ width: `${slo.errorBudgetRemainingPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                    <span>Consumed: {slo.consumedMinutes}m</span>
                    <span>Total Allowed: {slo.errorBudgetTotalMinutes}m</span>
                  </div>
                </div>

                {/* Multi-Window Burn Rates */}
                <div className="grid grid-cols-3 gap-3 p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl text-center">
                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">1h Burn</div>
                    <div
                      className={`text-sm font-bold font-mono mt-0.5 ${
                        slo.burnRate1h >= 5.0 ? 'text-rose-400' : slo.burnRate1h >= 2.0 ? 'text-amber-400' : 'text-slate-200'
                      }`}
                    >
                      {slo.burnRate1h}x
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">6h Burn</div>
                    <div
                      className={`text-sm font-bold font-mono mt-0.5 ${
                        slo.burnRate6h >= 5.0 ? 'text-rose-400' : slo.burnRate6h >= 2.0 ? 'text-amber-400' : 'text-slate-200'
                      }`}
                    >
                      {slo.burnRate6h}x
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">24h Burn</div>
                    <div
                      className={`text-sm font-bold font-mono mt-0.5 ${
                        slo.burnRate24h >= 5.0 ? 'text-rose-400' : slo.burnRate24h >= 2.0 ? 'text-amber-400' : 'text-slate-200'
                      }`}
                    >
                      {slo.burnRate24h}x
                    </div>
                  </div>
                </div>

                {/* SLI Telemetry Comparison */}
                <div className="grid grid-cols-2 gap-4 text-xs font-mono">
                  <div className="p-3 bg-slate-950/40 rounded-lg border border-slate-800/60">
                    <div className="text-[10px] text-slate-500">Availability SLI</div>
                    <div className="text-slate-200 mt-1">
                      {slo.currentAvailability}% <span className="text-slate-500">/ {slo.availabilityTarget}%</span>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-950/40 rounded-lg border border-slate-800/60">
                    <div className="text-[10px] text-slate-500">P99 Latency SLI</div>
                    <div className="text-slate-200 mt-1">
                      {slo.currentLatencyP99Ms}ms <span className="text-slate-500">/ {slo.latencyTargetP99Ms}ms</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Circuit Breaker Controls */}
              <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between">
                <div className="flex items-center space-x-2 text-xs">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      slo.circuitBreakerTripped ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'
                    }`}
                  ></span>
                  <span className="text-slate-400">
                    Circuit Breaker: {slo.circuitBreakerTripped ? 'TRIPPED (Rollouts Halted)' : 'STANDBY'}
                  </span>
                </div>

                <button
                  onClick={() => handleToggleCircuitBreaker(slo.id, slo.circuitBreakerTripped)}
                  disabled={actionInProgress === slo.id}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    slo.circuitBreakerTripped
                      ? 'bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700'
                      : 'bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  {slo.circuitBreakerTripped ? 'Reset Circuit Breaker' : 'Simulate Freeze'}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
