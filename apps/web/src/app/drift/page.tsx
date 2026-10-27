'use client';

import { useState, useEffect } from 'react';
import {
  GitCompare,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  GitCommit,
  RotateCcw,
  FileCode,
  ShieldCheck,
  Check,
} from 'lucide-react';

interface DriftItem {
  id: string;
  resourceName: string;
  namespace: string;
  kind: string;
  driftType: 'REPLICA_COUNT_DRIFT' | 'ENV_VAR_DRIFT' | 'IMAGE_TAG_DRIFT' | 'RESOURCE_LIMIT_DRIFT' | 'ORPHANED_RESOURCE';
  gitFilePath: string;
  gitContent: string;
  liveContent: string;
  diffSummary: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  driftDetectedAt: string;
}

interface DriftReport {
  totalScanned: number;
  inSyncCount: number;
  driftedCount: number;
  complianceScore: number;
  items: DriftItem[];
}

export default function DriftDetectorPage() {
  const [report, setReport] = useState<DriftReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDrift, setSelectedDrift] = useState<DriftItem | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const fetchDriftReport = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/drift');
      const data = await res.json();
      setReport(data);
      if (data.items && data.items.length > 0) {
        setSelectedDrift(data.items[0]);
      } else {
        setSelectedDrift(null);
      }
    } catch (err) {
      console.error('Failed to load drift report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDriftReport();
  }, []);

  const handleReconcile = async (driftId: string) => {
    setActionInProgress(driftId);
    try {
      const res = await fetch('/api/drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reconcile', driftId }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedback(data.message);
        fetchDriftReport();
      }
    } catch (err) {
      console.error('Reconcile failed:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReverseCommit = async (driftId: string) => {
    setActionInProgress(driftId);
    try {
      const res = await fetch('/api/drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reverse_commit', driftId }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedback(`Git Commit generated: "${data.commitMessage}"`);
        fetchDriftReport();
      }
    } catch (err) {
      console.error('Reverse commit failed:', err);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleReset = async () => {
    try {
      await fetch('/api/drift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset' }),
      });
      fetchDriftReport();
    } catch (err) {
      console.error('Reset failed:', err);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
            <GitCompare className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">OctoDrift: Live Cluster-to-Git Reconciler</h1>
            <p className="text-sm text-slate-400">
              Detect out-of-band kubectl mutations, inspect side-by-side YAML diffs, and reverse-commit back to Git
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleReset}
            className="flex items-center space-x-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 text-xs font-medium rounded-lg border border-slate-800 transition"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Demo</span>
          </button>

          <button
            onClick={fetchDriftReport}
            disabled={loading}
            className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Re-scan Cluster</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex justify-between items-center">
          <span>{feedback}</span>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
      )}

      {/* Metrics Banner */}
      {report && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">GitOps Compliance</div>
            <div className="text-2xl font-bold text-emerald-400">{report.complianceScore}% In-Sync</div>
            <div className="text-[11px] text-slate-500 mt-1">Target: 100% strict GitOps</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Live Drift Detected</div>
            <div className={`text-2xl font-bold ${report.driftedCount > 0 ? 'text-amber-400' : 'text-slate-100'}`}>
              {report.driftedCount} Workloads
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Imperative mutations found</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Canonical Manifests</div>
            <div className="text-2xl font-bold text-slate-100">{report.inSyncCount} / {report.totalScanned}</div>
            <div className="text-[11px] text-slate-500 mt-1">argo/apps/*.yaml tracked</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Auto-Remediation</div>
            <div className="text-2xl font-bold text-sky-400">Bi-Directional</div>
            <div className="text-[11px] text-slate-500 mt-1">Reconcile or Reverse-Commit</div>
          </div>
        </div>
      )}

      {/* Main Drift Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Drift Items List */}
        <div className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Detected Drift Inventory</h2>

          {report?.items.length === 0 ? (
            <div className="p-8 bg-slate-900/40 border border-slate-800 rounded-xl text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
              <div className="text-sm font-semibold text-slate-200">Zero Drift Detected</div>
              <p className="text-xs text-slate-400">All live cluster resources match git repository manifests.</p>
            </div>
          ) : (
            report?.items.map((item) => {
              const isSelected = selectedDrift?.id === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedDrift(item)}
                  className={`p-4 rounded-xl border cursor-pointer transition space-y-2 ${
                    isSelected
                      ? 'bg-slate-800/80 border-amber-500/50 shadow-sm'
                      : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <span className="font-semibold text-xs text-slate-200">{item.resourceName}</span>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded font-mono font-medium ${
                        item.severity === 'HIGH'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                      }`}
                    >
                      {item.driftType}
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-400 font-mono truncate">{item.diffSummary}</div>
                  <div className="text-[10px] text-slate-500 flex items-center space-x-1">
                    <span>{item.namespace}</span>
                    <span>•</span>
                    <span>{item.kind}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Right: Side-by-Side Diff Inspector */}
        <div className="lg:col-span-2 space-y-4">
          {selectedDrift ? (
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden p-6 space-y-5">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-slate-800 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                    <FileCode className="w-4 h-4 text-sky-400" />
                    <span>{selectedDrift.resourceName}</span>
                    <span className="text-xs font-normal text-slate-400">({selectedDrift.gitFilePath})</span>
                  </h3>
                  <div className="text-xs text-amber-400 font-mono mt-1">{selectedDrift.diffSummary}</div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleReconcile(selectedDrift.id)}
                    disabled={actionInProgress === selectedDrift.id}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 transition"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
                    <span>Reconcile from Git</span>
                  </button>

                  <button
                    onClick={() => handleReverseCommit(selectedDrift.id)}
                    disabled={actionInProgress === selectedDrift.id}
                    className="flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition"
                  >
                    <GitCommit className="w-3.5 h-3.5" />
                    <span>Reverse-Commit to Git</span>
                  </button>
                </div>
              </div>

              {/* Side-by-Side YAML Diff */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                {/* Git Source */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-400 flex items-center space-x-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                    <span>Git Repository Manifest (Declared)</span>
                  </div>
                  <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl overflow-x-auto text-slate-300 leading-relaxed min-h-[220px]">
                    {selectedDrift.gitContent}
                  </pre>
                </div>

                {/* Live Cluster */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-slate-400 flex items-center space-x-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                    <span>Live Cluster State (Actual Running)</span>
                  </div>
                  <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl overflow-x-auto text-amber-200 leading-relaxed min-h-[220px]">
                    {selectedDrift.liveContent}
                  </pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 bg-slate-900/40 border border-slate-800 rounded-2xl text-center text-slate-500 text-xs">
              Select a drifted workload from the inventory to inspect side-by-side diffs.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
