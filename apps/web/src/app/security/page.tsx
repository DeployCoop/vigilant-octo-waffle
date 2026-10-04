'use client';

import { useState, useEffect } from 'react';
import { apiErrorMessage } from '@/lib/envelope';
import {
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  Info,
  CheckCircle2,
  RefreshCw,
  Search,
  Filter,
  Check,
  XCircle,
  ExternalLink,
} from 'lucide-react';

interface SecurityFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  resource: string;
  namespace: string;
  category: string;
  remediation: string;
}

interface SecurityAuditReport {
  score: number;
  grade: 'A+' | 'A' | 'B' | 'C' | 'D' | 'F';
  scannedAt: string;
  totalWorkloads: number;
  findings: SecurityFinding[];
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export default function SecurityAuditPage() {
  const [report, setReport] = useState<SecurityAuditReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const loadAudit = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/security');
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(data));
      setReport(data);
    } catch (err) {
      console.error('Failed to load security audit:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAudit();
  }, []);

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A+':
      case 'A':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'B':
        return 'text-sky-400 bg-sky-500/10 border-sky-500/30';
      case 'C':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'D':
      case 'F':
      default:
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
    }
  };

  const getSeverityBadge = (sev: string) => {
    switch (sev) {
      case 'critical':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'high':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      case 'medium':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'low':
      default:
        return 'bg-slate-700/40 text-slate-300 border-slate-700';
    }
  };

  const filteredFindings = report?.findings.filter((f) => {
    const matchesSev = filterSeverity === 'all' || f.severity === filterSeverity;
    const matchesQuery =
      searchQuery === '' ||
      f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.resource.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.namespace.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesSev && matchesQuery;
  }) || [];

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-3">
            <ShieldCheck className="w-6 h-6 text-sky-400" />
            <span>Cluster Security & Workload Scorecard</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Automated CIS benchmark and container hardening audit for in-cluster workloads.
          </p>
        </div>

        <button
          onClick={loadAudit}
          disabled={loading}
          className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
          <span>{loading ? 'Auditing...' : 'Re-Run Security Audit'}</span>
        </button>
      </div>

      {loading && !report ? (
        <div className="p-16 text-center text-xs text-slate-400 flex items-center justify-center space-x-2">
          <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
          <span>Running security audit across cluster namespaces...</span>
        </div>
      ) : report ? (
        <>
          {/* Score & KPI Cards */}
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* Grade Card */}
            <div className={`p-5 rounded-xl border flex flex-col items-center justify-center text-center ${getGradeColor(report.grade)}`}>
              <span className="text-xs uppercase font-bold tracking-wider opacity-75">Posture Grade</span>
              <span className="text-5xl font-black mt-2">{report.grade}</span>
              <span className="text-xs mt-1 font-medium">Score: {report.score} / 100</span>
            </div>

            {/* Critical Findings */}
            <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-rose-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Critical</span>
              </span>
              <span className="text-3xl font-bold text-slate-100 mt-2">{report.summary.critical}</span>
              <span className="text-[11px] text-slate-500">Root / Privileged containers</span>
            </div>

            {/* High Findings */}
            <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-amber-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>High</span>
              </span>
              <span className="text-3xl font-bold text-slate-100 mt-2">{report.summary.high}</span>
              <span className="text-[11px] text-slate-500">Missing limits or writable rootfs</span>
            </div>

            {/* Medium & Low */}
            <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-sky-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
                <Info className="w-3.5 h-3.5" />
                <span>Medium / Low</span>
              </span>
              <span className="text-3xl font-bold text-slate-100 mt-2">
                {report.summary.medium + report.summary.low}
              </span>
              <span className="text-[11px] text-slate-500">Configuration advisories</span>
            </div>

            {/* Total Workloads Scanned */}
            <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
              <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Workloads Scanned</span>
              </span>
              <span className="text-3xl font-bold text-slate-100 mt-2">{report.totalWorkloads}</span>
              <span className="text-[11px] text-slate-500">Deployments & Pods inspected</span>
            </div>
          </div>

          {/* Filters & Findings Table */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex flex-col md:flex-row items-center justify-between gap-3">
              <div className="relative w-full md:w-80">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter by title, resource or namespace..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex items-center space-x-1.5 self-start md:self-auto">
                <Filter className="w-3.5 h-3.5 text-slate-500 mr-1" />
                {['all', 'critical', 'high', 'medium', 'low'].map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setFilterSeverity(sev)}
                    className={`px-2.5 py-1 rounded text-xs capitalize transition ${
                      filterSeverity === sev
                        ? 'bg-sky-600 text-white font-medium'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </div>

            {filteredFindings.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500 flex flex-col items-center">
                <Check className="w-6 h-6 text-emerald-400 mb-2" />
                <span>No security issues found matching the selected filter criteria.</span>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredFindings.map((finding) => (
                  <div
                    key={finding.id}
                    className="p-4 rounded-lg bg-slate-950/70 border border-slate-800/80 space-y-2 hover:border-slate-700 transition"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2.5">
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${getSeverityBadge(
                            finding.severity
                          )}`}
                        >
                          {finding.severity}
                        </span>
                        <span className="text-xs font-semibold text-slate-200">{finding.title}</span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-500">
                        {finding.namespace} / {finding.resource}
                      </span>
                    </div>

                    <div className="bg-slate-900/80 rounded p-2.5 border border-slate-800/50 text-xs">
                      <span className="text-slate-400 font-medium">Recommended Remediation: </span>
                      <span className="text-sky-300 font-mono text-[11px]">{finding.remediation}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
