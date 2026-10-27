'use client';

import { useState, useEffect } from 'react';
import {
  Activity,
  Radio,
  Search,
  RefreshCw,
  ShieldAlert,
  CheckCircle2,
  ArrowRight,
  Server,
  Zap,
} from 'lucide-react';

interface NetworkFlowRecord {
  id: string;
  timestamp: string;
  sourceNamespace: string;
  sourcePod: string;
  sourceIp: string;
  targetNamespace: string;
  targetPod: string;
  targetIp: string;
  port: number;
  protocol: 'HTTP/1.1' | 'HTTP/2' | 'gRPC' | 'PostgreSQL' | 'Redis' | 'DNS' | 'TCP';
  packetRate: number;
  throughputKbps: number;
  latencyMs: number;
  status: 'ESTABLISHED' | 'SYN_SENT' | 'RESET' | 'DROPPED' | 'TIMED_OUT';
  dropReason?: string;
}

interface DnsTelemetry {
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalQueries: number;
  successRate: number;
  nxdomainCount: number;
  servfailCount: number;
  topDomains: Array<{ domain: string; count: number; latencyMs: number; status: string }>;
}

export default function EbpfFlowsPage() {
  const [flows, setFlows] = useState<NetworkFlowRecord[]>([]);
  const [dns, setDns] = useState<DnsTelemetry | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedNamespace, setSelectedNamespace] = useState<string>('all');
  const [inspectSource, setInspectSource] = useState('nextcloud-app');
  const [inspectTarget, setInspectTarget] = useState('postgres-postgresql-0');
  const [inspectPort, setInspectPort] = useState(5432);
  const [inspecting, setInspecting] = useState(false);
  const [inspectResult, setInspectResult] = useState<any>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const url = selectedNamespace === 'all' ? '/api/ebpf' : `/api/ebpf?namespace=${selectedNamespace}`;
      const res = await fetch(url);
      const data = await res.json();
      setFlows(data.flows || []);
      setDns(data.dns || null);
    } catch (err) {
      console.error('Failed to load eBPF data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedNamespace]);

  const runDiagnostic = async () => {
    setInspecting(true);
    setInspectResult(null);
    try {
      const res = await fetch('/api/ebpf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourcePod: inspectSource,
          targetPod: inspectTarget,
          port: inspectPort,
        }),
      });
      const data = await res.json();
      setInspectResult(data);
    } catch (err) {
      console.error('Diagnostic failed:', err);
    } finally {
      setInspecting(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="flex items-center space-x-3">
            <span className="p-2.5 bg-sky-500/10 text-sky-400 rounded-xl border border-sky-500/20">
              <Radio className="w-6 h-6 animate-pulse" />
            </span>
            <div>
              <h1 className="text-2xl font-bold text-slate-100">OctoLens: eBPF Network Flow & DNS Sniffer</h1>
              <p className="text-sm text-slate-400">
                Kernel-level socket tracing, inter-pod throughput, and CoreDNS latency radar without sidecars
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <select
            value={selectedNamespace}
            onChange={(e) => setSelectedNamespace(e.target.value)}
            className="bg-slate-900 border border-slate-800 text-slate-200 text-xs rounded-lg px-3 py-2 outline-none focus:border-sky-500"
          >
            <option value="all">All Namespaces</option>
            <option value="traefik">traefik</option>
            <option value="keycloak">keycloak</option>
            <option value="nextcloud">nextcloud</option>
            <option value="postgres">postgres</option>
            <option value="redis">redis</option>
            <option value="minio">minio</option>
            <option value="argocd">argocd</option>
          </select>

          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* DNS Telemetry Radar */}
      {dns && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="flex justify-between items-center text-slate-400 text-xs mb-1">
              <span>Avg DNS Latency</span>
              <Activity className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-slate-100">{dns.avgLatencyMs} ms</div>
            <div className="text-xs text-emerald-400 mt-1">P95: {dns.p95LatencyMs} ms (Sub-millisecond local)</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="flex justify-between items-center text-slate-400 text-xs mb-1">
              <span>DNS Query Volume</span>
              <Server className="w-4 h-4 text-sky-400" />
            </div>
            <div className="text-2xl font-bold text-slate-100">{dns.totalQueries.toLocaleString()}</div>
            <div className="text-xs text-sky-400 mt-1">CoreDNS in-cluster forwarder</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="flex justify-between items-center text-slate-400 text-xs mb-1">
              <span>Success Rate</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-slate-100">{dns.successRate}%</div>
            <div className="text-xs text-slate-400 mt-1">{dns.servfailCount} SERVFAIL / {dns.nxdomainCount} NXDOMAIN</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="flex justify-between items-center text-slate-400 text-xs mb-1">
              <span>Active Kernel Socket Probes</span>
              <Zap className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-slate-100">6 Cgroup Tracers</div>
            <div className="text-xs text-amber-400 mt-1">Zero-overhead BPF hook</div>
          </div>
        </div>
      )}

      {/* Main Flow Table */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Activity className="w-4 h-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-200">Live Socket Flows & Packet Streams</h2>
          </div>
          <span className="text-xs text-slate-500 font-mono">{flows.length} flows active</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider border-b border-slate-800 font-medium">
              <tr>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Source Pod</th>
                <th className="px-4 py-3">Target Workload</th>
                <th className="px-4 py-3">Port</th>
                <th className="px-4 py-3">Protocol</th>
                <th className="px-4 py-3">Packet Rate</th>
                <th className="px-4 py-3">Bandwidth</th>
                <th className="px-4 py-3">RTT Latency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {flows.map((flow) => {
                const isDropped = flow.status === 'DROPPED';
                return (
                  <tr key={flow.id} className="hover:bg-slate-900/40 transition">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                          isDropped
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        }`}
                      >
                        {flow.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-mono text-slate-200">{flow.sourcePod}</div>
                      <div className="text-[10px] text-slate-500">{flow.sourceNamespace} • {flow.sourceIp}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-mono text-slate-200">{flow.targetPod}</div>
                      <div className="text-[10px] text-slate-500">{flow.targetNamespace} • {flow.targetIp}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">{flow.port}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-sky-300 border border-slate-700 font-mono text-[10px]">
                        {flow.protocol}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">{flow.packetRate} pps</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{flow.throughputKbps} KB/s</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`font-mono ${flow.latencyMs > 5 ? 'text-amber-400' : 'text-emerald-400'}`}>
                        {flow.latencyMs} ms
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Interactive Socket Trace Diagnostic */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center space-x-2">
          <Search className="w-4 h-4 text-sky-400" />
          <h2 className="text-sm font-semibold text-slate-200">Interactive Socket Path & Packet Drop Inspector</h2>
        </div>
        <p className="text-xs text-slate-400">
          Simulate a kernel TCP/IP handshake between any two microservices to test routing and NetworkPolicy enforcement.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Source Workload</label>
            <input
              type="text"
              value={inspectSource}
              onChange={(e) => setInspectSource(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Target Workload</label>
            <input
              type="text"
              value={inspectTarget}
              onChange={(e) => setInspectTarget(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Target Port</label>
            <input
              type="number"
              value={inspectPort}
              onChange={(e) => setInspectPort(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <button
              onClick={runDiagnostic}
              disabled={inspecting}
              className="w-full flex items-center justify-center space-x-2 px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg transition"
            >
              {inspecting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
              <span>Inspect Socket Flow</span>
            </button>
          </div>
        </div>

        {inspectResult && (
          <div
            className={`mt-4 p-4 rounded-xl border text-xs flex items-start space-x-3 ${
              inspectResult.canConnect
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            }`}
          >
            {inspectResult.canConnect ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            ) : (
              <ShieldAlert className="w-5 h-5 text-rose-400 shrink-0" />
            )}
            <div>
              <div className="font-semibold text-sm">
                {inspectResult.canConnect ? 'Connection Permitted' : 'Connection Blocked / Dropped'}
              </div>
              <div className="mt-1">{inspectResult.reason}</div>
              {inspectResult.policyBlocking && (
                <div className="mt-1 text-[11px] font-mono text-rose-200">
                  Enforcing Policy: {inspectResult.policyBlocking}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
