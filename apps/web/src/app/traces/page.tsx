'use client';

import { useState, useEffect } from 'react';
import {
  Activity,
  Search,
  RefreshCw,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Filter,
  ChevronRight,
  Database,
  Globe,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface TraceSpan {
  spanId: string;
  parentId?: string;
  serviceName: string;
  operationName: string;
  startTimeOffsetMs: number;
  durationMs: number;
  statusCode: number;
  tags: Record<string, string | number | boolean>;
}

interface TraceWaterfall {
  traceId: string;
  rootService: string;
  totalDurationMs: number;
  timestamp: string;
  spansCount: number;
  hasErrors: boolean;
  spans: TraceSpan[];
}

export default function TracesStudioPage() {
  const [traces, setTraces] = useState<TraceWaterfall[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrace, setSelectedTrace] = useState<TraceWaterfall | null>(null);
  const [selectedService, setSelectedService] = useState('all');
  const [minDuration, setMinDuration] = useState(0);

  const loadTraces = async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (selectedService !== 'all') q.set('service', selectedService);
      if (minDuration > 0) q.set('minDuration', String(minDuration));

      const res = await fetch(`/api/traces?${q.toString()}`);
      const data = await res.json();
      const list: TraceWaterfall[] = data.traces || [];
      setTraces(list);
      if (list.length > 0 && !selectedTrace) {
        setSelectedTrace(list[0]);
      } else if (selectedTrace) {
        const found = list.find((t) => t.traceId === selectedTrace.traceId);
        if (found) setSelectedTrace(found);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTraces();
  }, [selectedService, minDuration]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-3">
            <Activity className="w-6 h-6 text-sky-400" />
            <span>OpenTelemetry Distributed Trace Waterfall Studio</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Real-time APM trace inspection across Traefik Ingress, Keycloak, Nextcloud, and PostgreSQL microservice spans.
          </p>
        </div>

        <button
          onClick={loadTraces}
          disabled={loading}
          className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
          <span>Refresh Traces</span>
        </button>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800">
        <div className="flex-1">
          <label className="text-xs text-slate-400 block mb-1">Filter by Service</label>
          <select
            value={selectedService}
            onChange={(e) => setSelectedService(e.target.value)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
          >
            <option value="all">All Microservices</option>
            <option value="traefik-ingress">traefik-ingress</option>
            <option value="keycloak-auth">keycloak-auth</option>
            <option value="nextcloud-core">nextcloud-core</option>
            <option value="postgresql">postgresql</option>
            <option value="minio-s3">minio-s3</option>
            <option value="argocd-server">argocd-server</option>
          </select>
        </div>

        <div className="w-full sm:w-48">
          <label className="text-xs text-slate-400 block mb-1">Min Duration (ms)</label>
          <input
            type="number"
            min="0"
            step="50"
            value={minDuration}
            onChange={(e) => setMinDuration(parseInt(e.target.value) || 0)}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Traces List */}
        <div className="md:col-span-1 bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Traces</span>
            <span className="text-xs text-slate-500">{traces.length}</span>
          </div>

          <div className="space-y-1.5">
            {traces.map((t) => (
              <button
                key={t.traceId}
                onClick={() => setSelectedTrace(t)}
                className={`w-full text-left p-3 rounded-lg text-xs transition cursor-pointer ${
                  selectedTrace?.traceId === t.traceId
                    ? 'bg-sky-500/10 text-sky-300 border border-sky-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200 truncate">{t.rootService}</span>
                  <span
                    className={`font-mono text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      t.hasErrors
                        ? 'bg-rose-950 text-rose-400 border border-rose-800/50'
                        : 'bg-emerald-950 text-emerald-400 border border-emerald-800/50'
                    }`}
                  >
                    {t.totalDurationMs}ms
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 mt-1 flex items-center justify-between font-mono">
                  <span className="truncate max-w-[120px]">{t.traceId}</span>
                  <span>{t.spansCount} spans</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Selected Trace Waterfall View */}
        <div className="md:col-span-2 space-y-4">
          {selectedTrace ? (
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div>
                  <h2 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                    <span>Trace: {selectedTrace.traceId}</span>
                    {selectedTrace.hasErrors && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800/40">
                        Error Detected
                      </span>
                    )}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5 font-mono">
                    Total Duration: {selectedTrace.totalDurationMs}ms • {selectedTrace.spans.length} Spans
                  </p>
                </div>
              </div>

              {/* Spans Waterfall */}
              <div className="space-y-3 pt-2">
                {selectedTrace.spans.map((span) => {
                  const leftPercent = (span.startTimeOffsetMs / selectedTrace.totalDurationMs) * 100;
                  const widthPercent = Math.max(
                    4,
                    (span.durationMs / selectedTrace.totalDurationMs) * 100
                  );

                  return (
                    <div
                      key={span.spanId}
                      className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-lg space-y-2 hover:border-slate-700 transition"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              span.statusCode >= 500 ? 'bg-rose-400' : 'bg-emerald-400'
                            }`}
                          />
                          <span className="font-semibold text-slate-200">{span.serviceName}</span>
                          <span className="text-slate-500 font-mono text-[11px] truncate max-w-xs">
                            {span.operationName}
                          </span>
                        </div>
                        <span className="font-mono text-sky-400 font-semibold">{span.durationMs}ms</span>
                      </div>

                      {/* Visual Timeline Bar */}
                      <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden relative">
                        <div
                          style={{
                            marginLeft: `${leftPercent}%`,
                            width: `${widthPercent}%`,
                          }}
                          className={`h-full rounded-full transition-all ${
                            span.statusCode >= 500
                              ? 'bg-rose-500'
                              : span.serviceName.includes('postgres')
                              ? 'bg-indigo-500'
                              : 'bg-sky-500'
                          }`}
                        />
                      </div>

                      {/* Tags Pill Box */}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {Object.entries(span.tags).map(([k, v]) => (
                          <span
                            key={k}
                            className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-400"
                          >
                            <span className="text-slate-500">{k}:</span> {String(v)}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="p-16 text-center text-xs text-slate-500">
              Select a trace from the left panel to inspect the span waterfall.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
