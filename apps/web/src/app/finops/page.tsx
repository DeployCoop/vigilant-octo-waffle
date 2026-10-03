'use client';

import { useState, useEffect } from 'react';
import {
  DollarSign,
  BatteryCharging,
  Zap,
  Leaf,
  Cloud,
  RefreshCw,
  TrendingDown,
  Layers,
  Server,
  ArrowUpRight,
  ShieldAlert,
  Cpu,
} from 'lucide-react';

interface CloudProviderCost {
  provider: 'aws' | 'gcp' | 'azure';
  displayName: string;
  monthlyTotalUsd: number;
  breakdown: {
    compute: number;
    memory: number;
    storage: number;
    controlPlaneFee: number;
  };
  recommendedInstance: string;
}

interface WorkloadCost {
  namespace: string;
  name: string;
  cpuMillicores: number;
  memoryMb: number;
  estimatedMonthlyUsd: number;
}

interface LaptopWattage {
  estimatedCurrentWatts: number;
  hourlyKwh: number;
  batteryDrainPerHourPercent: number;
  batterySaverActive: boolean;
  co2GramsPerHour: number;
}

interface GpuPowerAnalytics {
  gpuModel: string;
  powerUsageWatts: number;
  powerLimitWatts: number;
  gpuUtilizationPct: number;
  vramUsedMb: number;
  vramTotalMb: number;
  estimatedCostPer1MTokensUsd: number;
}

interface RightSizingRecommendation {
  workload: string;
  namespace: string;
  container: string;
  currentCpuRequest: string;
  p95CpuUsage: string;
  recommendedCpuRequest: string;
  currentMemRequest: string;
  p95MemUsage: string;
  recommendedMemRequest: string;
  potentialMonthlySavingsUsd: number;
}

interface FinOpsReport {
  timestamp: string;
  totalWorkloads: number;
  cloudEstimates: {
    aws: CloudProviderCost;
    gcp: CloudProviderCost;
    azure: CloudProviderCost;
  };
  workloads: WorkloadCost[];
  wattage: LaptopWattage;
  recommendations: string[];
  k3sFinOps?: {
    totalMonthlyEstimatedClusterCostUsd: number;
    overProvisioningWasteCostUsd: number;
    potentialSavingsPercentage: number;
    rightSizingRecommendations: RightSizingRecommendation[];
    gpuPowerAnalytics: GpuPowerAnalytics | null;
  };
}

export default function FinOpsPage() {
  const [report, setReport] = useState<FinOpsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [batterySaver, setBatterySaver] = useState(false);
  const [applyingWorkload, setApplyingWorkload] = useState<string | null>(null);
  const [patchSuccess, setPatchSuccess] = useState<string | null>(null);

  const loadData = async (isSaver: boolean) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/finops?batterySaver=${isSaver}`);
      const data = await res.json();
      setReport(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleApplyRightSizing = async (workload: string, namespace: string) => {
    setApplyingWorkload(workload);
    setPatchSuccess(null);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'finops-apply',
          workload,
          namespace,
        }),
      });
      const data = await res.json();
      setPatchSuccess(data.message || `Applied right-sizing to ${workload}`);
      await loadData(batterySaver);
    } catch (err: any) {
      console.error(err);
    } finally {
      setApplyingWorkload(null);
    }
  };

  useEffect(() => {
    loadData(batterySaver);
  }, [batterySaver]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-3">
            <DollarSign className="w-6 h-6 text-emerald-400" />
            <span>FinOps Cloud Run-Rate & Laptop Battery Estimator</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time cloud pricing parity across AWS, GCP, and Azure, plus host laptop wattage draw & battery preservation telemetry.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Battery Saver Mode Switch */}
          <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-xs">
            <BatteryCharging className={`w-4 h-4 ${batterySaver ? 'text-emerald-400' : 'text-slate-400'}`} />
            <span className="text-slate-300 font-medium">Battery Saver Mode</span>
            <button
              onClick={() => setBatterySaver(!batterySaver)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                batterySaver ? 'bg-emerald-500' : 'bg-slate-700'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  batterySaver ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <button
            onClick={() => loadData(batterySaver)}
            disabled={loading}
            className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Refresh FinOps</span>
          </button>
        </div>
      </div>

      {report && (
        <>
          {/* Laptop Power Draw Banner */}
          <div className="bg-gradient-to-r from-emerald-950/40 to-slate-900/60 border border-emerald-800/40 rounded-xl p-5">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <span className="text-xs uppercase font-bold text-emerald-400 tracking-wider flex items-center space-x-1.5">
                  <Zap className="w-3.5 h-3.5" />
                  <span>Host Power Draw</span>
                </span>
                <div className="text-3xl font-black text-slate-100">{report.wattage.estimatedCurrentWatts} W</div>
                <p className="text-[11px] text-slate-400">Total physical laptop energy consumption</p>
              </div>

              <div className="space-y-1">
                <span className="text-xs uppercase font-bold text-sky-400 tracking-wider flex items-center space-x-1.5">
                  <BatteryCharging className="w-3.5 h-3.5" />
                  <span>Battery Drainage</span>
                </span>
                <div className="text-3xl font-black text-slate-100">{report.wattage.batteryDrainPerHourPercent}% / hr</div>
                <p className="text-[11px] text-slate-400">Estimated runtime on 70Wh battery</p>
              </div>

              <div className="space-y-1">
                <span className="text-xs uppercase font-bold text-purple-400 tracking-wider flex items-center space-x-1.5">
                  <Leaf className="w-3.5 h-3.5" />
                  <span>Carbon Footprint</span>
                </span>
                <div className="text-3xl font-black text-slate-100">{report.wattage.co2GramsPerHour} g CO₂/hr</div>
                <p className="text-[11px] text-slate-400">Estimated environmental operational cost</p>
              </div>

              <div className="space-y-1">
                <span className="text-xs uppercase font-bold text-amber-400 tracking-wider flex items-center space-x-1.5">
                  <TrendingDown className="w-3.5 h-3.5" />
                  <span>Saver Optimization</span>
                </span>
                <div className="text-3xl font-black text-slate-100">{report.wattage.batterySaverActive ? 'Active' : 'Off'}</div>
                <p className="text-[11px] text-slate-400">{report.wattage.batterySaverActive ? 'Saving ~40% energy consumption' : 'Run rates at standard power'}</p>
              </div>
            </div>
          </div>

          {/* Host NVIDIA GPU Power & Real-Time Token Economics Banner */}
          {report.k3sFinOps?.gpuPowerAnalytics && (
            <div className="bg-gradient-to-r from-purple-950/40 via-indigo-950/30 to-slate-900/60 border border-purple-800/40 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs uppercase font-bold text-purple-400 tracking-wider flex items-center space-x-2">
                  <Cpu className="w-4 h-4 text-purple-400" />
                  <span>Host GPU FinOps & Edge AI Economics ({report.k3sFinOps.gpuPowerAnalytics.gpuModel})</span>
                </span>
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-purple-900/60 text-purple-300 border border-purple-700">
                  Real-Time Telemetry
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <span className="text-xs text-slate-400">Current Power Draw</span>
                  <div className="text-2xl font-black text-slate-100">
                    {report.k3sFinOps.gpuPowerAnalytics.powerUsageWatts} W
                    <span className="text-xs font-normal text-slate-400 ml-1">/ {report.k3sFinOps.gpuPowerAnalytics.powerLimitWatts} W cap</span>
                  </div>
                  <p className="text-[11px] text-slate-500">GPU Compute Utilization: {report.k3sFinOps.gpuPowerAnalytics.gpuUtilizationPct}%</p>
                </div>

                <div className="space-y-1">
                  <span className="text-xs text-slate-400">VRAM Allocation</span>
                  <div className="text-2xl font-black text-purple-300">
                    {report.k3sFinOps.gpuPowerAnalytics.vramUsedMb} MiB
                    <span className="text-xs font-normal text-slate-400 ml-1">/ {report.k3sFinOps.gpuPowerAnalytics.vramTotalMb} MiB</span>
                  </div>
                  <p className="text-[11px] text-slate-500">Dedicated high-bandwidth frame buffer</p>
                </div>

                <div className="space-y-1">
                  <span className="text-xs text-slate-400">LLM Inference Cost</span>
                  <div className="text-2xl font-black text-emerald-400">
                    ${report.k3sFinOps.gpuPowerAnalytics.estimatedCostPer1MTokensUsd}
                    <span className="text-xs font-normal text-slate-400 ml-1">/ 1M tokens</span>
                  </div>
                  <p className="text-[11px] text-slate-500">Assuming 8B model @ $0.14/kWh</p>
                </div>

                <div className="space-y-1">
                  <span className="text-xs text-slate-400">Over-Provisioning Waste</span>
                  <div className="text-2xl font-black text-amber-400">
                    {report.k3sFinOps.potentialSavingsPercentage}%
                    <span className="text-xs font-normal text-slate-400 ml-1">(${report.k3sFinOps.overProvisioningWasteCostUsd}/mo)</span>
                  </div>
                  <p className="text-[11px] text-slate-500">P95 idle capacity reclaim target</p>
                </div>
              </div>
            </div>
          )}

          {/* Cloud Provider Price Comparisons */}
          <div className="space-y-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Projected Monthly Cloud Run-Rate (Equivalency)
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[report.cloudEstimates.aws, report.cloudEstimates.gcp, report.cloudEstimates.azure].map((prov) => (
                <div
                  key={prov.provider}
                  className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 flex flex-col justify-between hover:border-slate-700 transition"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-slate-100">{prov.displayName}</span>
                      <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-sky-400 border border-slate-700">
                        {prov.provider}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <span className="text-xs text-slate-500 font-medium">Estimated Monthly Run-Rate</span>
                      <div className="text-3xl font-black text-emerald-400">${prov.monthlyTotalUsd}</div>
                    </div>

                    <div className="bg-slate-950/80 rounded-lg p-3 border border-slate-800/80 text-xs space-y-1 font-mono">
                      <div className="flex justify-between text-slate-400">
                        <span>Compute:</span>
                        <span>${prov.breakdown.compute}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Memory:</span>
                        <span>${prov.breakdown.memory}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Storage (PVs):</span>
                        <span>${prov.breakdown.storage}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Control Plane Fee:</span>
                        <span>${prov.breakdown.controlPlaneFee}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-800/80 text-[11px] text-slate-500 flex items-center justify-between">
                    <span>Instance sizing:</span>
                    <span className="font-mono text-slate-300 font-medium">{prov.recommendedInstance}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* P95 Workload Right-Sizing & Waste Reclaim */}
          {report.k3sFinOps?.rightSizingRecommendations && report.k3sFinOps.rightSizingRecommendations.length > 0 && (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                    <TrendingDown className="w-4 h-4 text-emerald-400" />
                    <span>Continuous P95 Workload Right-Sizing (7-Day Metric Baseline)</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Deterministic requests/limits tuning based on actual P95 container consumption to reclaim over-provisioned cluster capacity.
                  </p>
                </div>
                {patchSuccess && (
                  <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/80 px-2.5 py-1 rounded-lg">
                    {patchSuccess}
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="p-2.5">Workload</th>
                      <th className="p-2.5">Namespace</th>
                      <th className="p-2.5">CPU (Req → P95 → Target)</th>
                      <th className="p-2.5">RAM (Req → P95 → Target)</th>
                      <th className="p-2.5 text-right">Potential Savings</th>
                      <th className="p-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.k3sFinOps.rightSizingRecommendations.map((rec) => (
                      <tr key={`${rec.namespace}/${rec.workload}`} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                        <td className="p-2.5 font-semibold text-slate-200">{rec.workload}</td>
                        <td className="p-2.5 text-slate-400">{rec.namespace}</td>
                        <td className="p-2.5">
                          <span className="text-rose-400 line-through mr-1.5">{rec.currentCpuRequest}</span>
                          <span className="text-slate-400 mr-1.5">(P95: {rec.p95CpuUsage})</span>
                          <span className="text-emerald-400 font-bold">→ {rec.recommendedCpuRequest}</span>
                        </td>
                        <td className="p-2.5">
                          <span className="text-rose-400 line-through mr-1.5">{rec.currentMemRequest}</span>
                          <span className="text-slate-400 mr-1.5">(P95: {rec.p95MemUsage})</span>
                          <span className="text-emerald-400 font-bold">→ {rec.recommendedMemRequest}</span>
                        </td>
                        <td className="p-2.5 text-right font-bold text-emerald-400">
                          ${rec.potentialMonthlySavingsUsd}/mo
                        </td>
                        <td className="p-2.5 text-right">
                          <button
                            onClick={() => handleApplyRightSizing(rec.workload, rec.namespace)}
                            disabled={applyingWorkload === rec.workload}
                            className="bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 px-2.5 py-1 rounded text-[11px] font-sans font-medium transition disabled:opacity-50"
                          >
                            {applyingWorkload === rec.workload ? 'Applying...' : 'Apply Patch'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Top Workload Cost Breakdown */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Workload Cost Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400">
                    <th className="p-2.5">Workload Name</th>
                    <th className="p-2.5">Namespace</th>
                    <th className="p-2.5">CPU Requested</th>
                    <th className="p-2.5">RAM Requested</th>
                    <th className="p-2.5 text-right">Est. Monthly Cloud Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {report.workloads.map((w) => (
                    <tr key={`${w.namespace}/${w.name}`} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                      <td className="p-2.5 font-semibold text-slate-200">{w.name}</td>
                      <td className="p-2.5 text-slate-400">{w.namespace}</td>
                      <td className="p-2.5 text-sky-400">{w.cpuMillicores}m</td>
                      <td className="p-2.5 text-purple-400">{w.memoryMb} MB</td>
                      <td className="p-2.5 text-right font-bold text-emerald-400">${w.estimatedMonthlyUsd}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
