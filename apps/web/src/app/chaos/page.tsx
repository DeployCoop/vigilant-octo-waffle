'use client';

import { useState, useEffect } from 'react';
import { useCan } from '@/lib/ability';
import { apiErrorMessage } from '@/lib/envelope';
import {
  Flame,
  Shield,
  Zap,
  Activity,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Radio,
  Play,
} from 'lucide-react';

interface ChaosExperiment {
  id: string;
  type: 'pod_kill' | 'cpu_stress' | 'network_latency';
  targetPod: string;
  namespace: string;
  timestamp: string;
  durationSec: number;
  status: 'running' | 'completed' | 'failed';
  recoveryTimeMs?: number;
  details: string;
}

interface ResilienceReport {
  score: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  healthyReplicasPercent: number;
  averageRtoMs: number;
  experimentsCount: number;
  protectedNamespaces: string[];
  recentExperiments: ChaosExperiment[];
}

interface PodOption {
  name: string;
  namespace: string;
}

export default function ChaosPlaygroundPage() {
  const canRunChaos = useCan('chaos:run');
  const [report, setReport] = useState<ResilienceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [pods, setPods] = useState<PodOption[]>([]);

  // Experiment form state
  const [selectedNamespace, setSelectedNamespace] = useState('default');
  const [selectedPod, setSelectedPod] = useState('');
  const [experimentType, setExperimentType] = useState<'pod_kill' | 'cpu_stress' | 'network_latency'>('pod_kill');
  const [durationSec, setDurationSec] = useState(10);
  const [latencyMs, setLatencyMs] = useState(250);
  const [injecting, setInjecting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const [resReport, resPods] = await Promise.all([
        fetch('/api/chaos'),
        fetch('/api/k8s/pods'),
      ]);
      const dataReport = await resReport.json();
      const dataPods = await resPods.json();

      setReport(dataReport);
      const availablePods: PodOption[] = (dataPods.pods || []).map((p: any) => ({
        name: p.name,
        namespace: p.namespace,
      }));
      setPods(availablePods);

      if (availablePods.length > 0 && !selectedPod) {
        setSelectedPod(availablePods[0].name);
        setSelectedNamespace(availablePods[0].namespace);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleLaunchExperiment = async () => {
    if (!selectedPod || !selectedNamespace) return;
    setInjecting(true);
    setActionMessage(null);

    try {
      const res = await fetch('/api/chaos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: experimentType,
          namespace: selectedNamespace,
          podName: selectedPod,
          durationSec,
          latencyMs,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(apiErrorMessage(data));

      setActionMessage(data.experiment?.details || 'Chaos experiment dispatched successfully!');
      loadData();
    } catch (err: any) {
      setActionMessage(`Injection error: ${err.message}`);
    } finally {
      setInjecting(false);
    }
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A+':
      case 'A':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'B':
        return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
      case 'C':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      default:
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-3">
            <Flame className="w-6 h-6 text-rose-500" />
            <span>OctoChaos: Resilience & Chaos Engineering Simulator</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Safe in-cluster fault injection to evaluate pod restart recovery, RTO latency, and OctoPilot AI auto-diagnostics.
          </p>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
          <span>Refresh Cockpit</span>
        </button>
      </div>

      {/* Safety Guard Notice */}
      <div className="bg-sky-950/30 border border-sky-800/40 rounded-xl p-4 flex items-center justify-between text-xs text-sky-300">
        <div className="flex items-center space-x-2.5">
          <Shield className="w-4 h-4 text-sky-400 shrink-0" />
          <span>
            <strong className="text-white font-semibold">Blast Radius Guard Active:</strong> Critical system namespaces ({report?.protectedNamespaces?.join(', ') || 'kube-system, argocd, traefik'}) are immutable and automatically shielded from termination.
          </span>
        </div>
      </div>

      {/* Score & KPI Cards */}
      {report && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className={`p-5 rounded-xl border flex flex-col items-center justify-center text-center ${getGradeColor(report.grade)}`}>
            <span className="text-xs uppercase font-bold tracking-wider opacity-75">Resilience Grade</span>
            <span className="text-5xl font-black mt-2">{report.grade}</span>
            <span className="text-xs mt-1 font-medium">Score: {report.score} / 100</span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-emerald-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Healthy Replicas</span>
            </span>
            <span className="text-3xl font-bold text-slate-100 mt-2">{report.healthyReplicasPercent}%</span>
            <span className="text-[11px] text-slate-500">Pods running without crash-loops</span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-sky-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>Average RTO</span>
            </span>
            <span className="text-3xl font-bold text-slate-100 mt-2">{report.averageRtoMs} ms</span>
            <span className="text-[11px] text-slate-500">Mean recovery time after pod kill</span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-purple-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
              <Activity className="w-3.5 h-3.5" />
              <span>Total Faults Run</span>
            </span>
            <span className="text-3xl font-bold text-slate-100 mt-2">{report.experimentsCount}</span>
            <span className="text-[11px] text-slate-500">Injections recorded this session</span>
          </div>
        </div>
      )}

      {/* Experiment Launcher Panel */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-6">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center space-x-2">
          <Zap className="w-4 h-4 text-rose-400" />
          <span>Launch Chaos Experiment</span>
        </h2>

        {/* Experiment Type Selector */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              id: 'pod_kill',
              name: 'Pod Killer',
              desc: 'Terminates selected pod immediately and tracks self-healing RTO.',
              badge: 'Fault Injection',
            },
            {
              id: 'cpu_stress',
              name: 'CPU Burst Spike',
              desc: 'Burns container CPU for N seconds to test autoscaling & alerts.',
              badge: 'Resource Stress',
            },
            {
              id: 'network_latency',
              name: 'Packet Latency Emulation',
              desc: 'Emulates artificial millisecond packet latency on target pod.',
              badge: 'Network Jitter',
            },
          ].map((type) => (
            <button
              key={type.id}
              onClick={() => setExperimentType(type.id as any)}
              className={`p-4 rounded-xl border text-left transition cursor-pointer ${
                experimentType === type.id
                  ? 'bg-rose-500/10 border-rose-500/40 text-slate-100 shadow-sm'
                  : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{type.name}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-rose-400">
                  {type.badge}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">{type.desc}</p>
            </button>
          ))}
        </div>

        {/* Target Workload Selection */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Target Pod</label>
            <select
              value={selectedPod}
              onChange={(e) => {
                setSelectedPod(e.target.value);
                const found = pods.find((p) => p.name === e.target.value);
                if (found) setSelectedNamespace(found.namespace);
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
            >
              {pods.map((p) => (
                <option key={`${p.namespace}/${p.name}`} value={p.name}>
                  {p.namespace} / {p.name}
                </option>
              ))}
            </select>
          </div>

          {experimentType === 'cpu_stress' && (
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Stress Duration (Seconds)</label>
              <input
                type="number"
                min={5}
                max={60}
                value={durationSec}
                onChange={(e) => setDurationSec(parseInt(e.target.value) || 10)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
              />
            </div>
          )}

          {experimentType === 'network_latency' && (
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Artificial Latency (ms)</label>
              <input
                type="number"
                min={50}
                max={2000}
                step={50}
                value={latencyMs}
                onChange={(e) => setLatencyMs(parseInt(e.target.value) || 200)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-rose-500"
              />
            </div>
          )}

          <div className="flex items-end">
            <button
              onClick={handleLaunchExperiment}
              disabled={injecting || !selectedPod || !canRunChaos}
              title={canRunChaos ? undefined : 'Requires the chaos:run permission'}
              className="w-full flex items-center justify-center space-x-2 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm"
            >
              {injecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>{injecting ? 'Injecting Fault...' : 'Execute Chaos Fault'}</span>
            </button>
          </div>
        </div>

        {actionMessage && (
          <div className="bg-slate-950 border border-slate-800 p-3 rounded-lg text-xs font-mono text-rose-300">
            {actionMessage}
          </div>
        )}
      </div>

      {/* Recent Experiments Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent Chaos Experiments</h3>
        {report?.recentExperiments && report.recentExperiments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="p-2.5">ID</th>
                  <th className="p-2.5">Type</th>
                  <th className="p-2.5">Target</th>
                  <th className="p-2.5">Status</th>
                  <th className="p-2.5">RTO Latency</th>
                  <th className="p-2.5">Details</th>
                </tr>
              </thead>
              <tbody>
                {report.recentExperiments.map((exp) => (
                  <tr key={exp.id} className="border-b border-slate-800/40 hover:bg-slate-800/30">
                    <td className="p-2.5 text-slate-400">{exp.id}</td>
                    <td className="p-2.5 text-rose-400 font-semibold">{exp.type}</td>
                    <td className="p-2.5 text-slate-200">{exp.namespace}/{exp.targetPod}</td>
                    <td className="p-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                        exp.status === 'completed'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                          : 'bg-rose-950 text-rose-400 border border-rose-800/50'
                      }`}>
                        {exp.status}
                      </span>
                    </td>
                    <td className="p-2.5 text-sky-400">{exp.recoveryTimeMs ? `${exp.recoveryTimeMs}ms` : '--'}</td>
                    <td className="p-2.5 text-slate-400 truncate max-w-xs">{exp.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-xs text-slate-500">
            No chaos experiments performed yet. Launch an experiment above to measure cluster resiliency.
          </div>
        )}
      </div>
    </div>
  );
}
