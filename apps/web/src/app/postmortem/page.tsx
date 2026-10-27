'use client';

import { useState, useEffect } from 'react';
import {
  FileText,
  Clock,
  Sparkles,
  RefreshCw,
  Copy,
  Check,
  CheckCircle2,
} from 'lucide-react';

interface IncidentEvent {
  timestamp: string;
  eventType: 'OOM_KILLED' | 'CRASH_LOOP' | 'POD_EVICTION' | 'TRACE_LATENCY_SPIKE' | 'CHAOS_FAULT';
  workload: string;
  namespace: string;
  description: string;
}

interface PostmortemActionItem {
  id: string;
  title: string;
  owner: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';
}

interface PostmortemReport {
  id: string;
  incidentTitle: string;
  severity: 'SEV-1' | 'SEV-2' | 'SEV-3';
  detectedAt: string;
  resolvedAt: string;
  durationMinutes: number;
  affectedWorkloads: string[];
  rootCause: string;
  timeline: IncidentEvent[];
  actionItems: PostmortemActionItem[];
  fullReportMarkdown: string;
}

export default function PostmortemPage() {
  const [reports, setReports] = useState<PostmortemReport[]>([]);
  const [selectedReport, setSelectedReport] = useState<PostmortemReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [synthesizing, setSynthesizing] = useState(false);
  const [copied, setCopied] = useState(false);

  // New incident synthesis form
  const [incidentTitle, setIncidentTitle] = useState('Redis Cluster Network Partition & Session Drop');
  const [severity, setSeverity] = useState<'SEV-1' | 'SEV-2' | 'SEV-3'>('SEV-2');
  const targetWorkloads = 'redis-master-0, nextcloud-app';

  const fetchReports = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/postmortem');
      const data = await res.json();
      setReports(data.postmortems || []);
      if (data.postmortems && data.postmortems.length > 0) {
        setSelectedReport(data.postmortems[0]);
      }
    } catch (err) {
      console.error('Failed to load postmortems:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReports();
  }, []);

  const handleSynthesize = async () => {
    setSynthesizing(true);
    try {
      const res = await fetch('/api/postmortem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incidentTitle,
          severity,
          affectedWorkloads: targetWorkloads.split(',').map((w) => w.trim()),
        }),
      });
      const data = await res.json();
      if (data.success) {
        fetchReports();
      }
    } catch (err) {
      console.error('Synthesis failed:', err);
    } finally {
      setSynthesizing(false);
    }
  };

  const handleCopy = () => {
    if (selectedReport) {
      navigator.clipboard.writeText(selectedReport.fullReportMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-rose-500/10 text-rose-400 rounded-xl border border-rose-500/20">
            <FileText className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">OctoPostmortem: AI SRE Incident Report Generator</h1>
            <p className="text-sm text-slate-400">
              Blameless incident reconstruction, 5-Whys Root Cause Analysis, chronological timelines, and action item tracking
            </p>
          </div>
        </div>

        <button
          onClick={fetchReports}
          disabled={loading}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Synthesis Trigger Cockpit */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center space-x-2">
          <Sparkles className="w-5 h-5 text-violet-400" />
          <h2 className="text-base font-bold text-slate-100">Synthesize Incident Post-Mortem & Timeline</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end text-xs">
          <div className="md:col-span-2">
            <label className="block text-slate-400 mb-1 font-medium">Incident Summary Title</label>
            <input
              type="text"
              value={incidentTitle}
              onChange={(e) => setIncidentTitle(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-violet-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 mb-1 font-medium">Severity Level</label>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as any)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-violet-500 font-mono"
            >
              <option value="SEV-1">SEV-1 (Critical Outage)</option>
              <option value="SEV-2">SEV-2 (Major Degradation)</option>
              <option value="SEV-3">SEV-3 (Minor / Transient)</option>
            </select>
          </div>

          <div>
            <button
              onClick={handleSynthesize}
              disabled={synthesizing}
              className="w-full flex items-center justify-center space-x-2 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg shadow-sm transition"
            >
              {synthesizing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>Generate Post-Mortem</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Historical Reports */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Incident Archive</h3>
          {reports.map((report) => {
            const isSelected = selectedReport?.id === report.id;
            return (
              <div
                key={report.id}
                onClick={() => setSelectedReport(report)}
                className={`p-4 rounded-xl border cursor-pointer transition space-y-2 ${
                  isSelected
                    ? 'bg-slate-800/80 border-rose-500/50 shadow-sm'
                    : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex justify-between items-start">
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${
                      report.severity === 'SEV-1'
                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    }`}
                  >
                    {report.severity}
                  </span>
                  <span className="text-[11px] text-slate-500 font-mono">{report.durationMinutes}m Outage</span>
                </div>

                <div className="font-semibold text-xs text-slate-200 line-clamp-1">{report.incidentTitle}</div>
                <div className="text-[11px] text-slate-400 font-mono truncate">{report.rootCause}</div>
              </div>
            );
          })}
        </div>

        {/* Right: Selected Post-Mortem Details */}
        <div className="lg:col-span-2 space-y-4">
          {selectedReport ? (
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-6">
              <div className="flex justify-between items-start border-b border-slate-800 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                      {selectedReport.severity}
                    </span>
                    <h2 className="text-base font-bold text-slate-100">{selectedReport.incidentTitle}</h2>
                  </div>
                  <div className="text-xs text-slate-400 mt-1 font-mono">
                    Impacted: {selectedReport.affectedWorkloads.join(', ')}
                  </div>
                </div>

                <button
                  onClick={handleCopy}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied Markdown' : 'Copy Report'}</span>
                </button>
              </div>

              {/* Chronological Incident Timeline */}
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                  <Clock className="w-3.5 h-3.5 text-rose-400" />
                  <span>Chronological Incident Timeline</span>
                </div>
                <div className="space-y-2">
                  {selectedReport.timeline.map((evt, idx) => (
                    <div key={idx} className="flex items-start space-x-3 text-xs p-3 bg-slate-950/70 rounded-xl border border-slate-800/80">
                      <span className="font-mono text-slate-500 shrink-0 mt-0.5">{evt.timestamp}</span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-rose-300 border border-slate-700 shrink-0">
                        {evt.eventType}
                      </span>
                      <div className="flex-1">
                        <span className="font-mono text-slate-300 font-semibold">{evt.workload}: </span>
                        <span className="text-slate-400">{evt.description}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Items */}
              <div className="space-y-3">
                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Action Items & SRE Remediation</span>
                </div>
                <div className="space-y-2">
                  {selectedReport.actionItems.map((act) => (
                    <div key={act.id} className="flex justify-between items-center text-xs p-3 bg-slate-950/70 rounded-xl border border-slate-800/80">
                      <div className="flex items-center space-x-2">
                        <span className={act.status === 'COMPLETED' ? 'text-emerald-400' : 'text-slate-400'}>
                          {act.status === 'COMPLETED' ? '☑' : '☐'}
                        </span>
                        <span className="text-slate-200">{act.title}</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500">{act.owner}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 bg-slate-900/40 border border-slate-800 rounded-2xl text-center text-slate-500 text-xs">
              Select an incident from the archive to view post-mortem details.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
