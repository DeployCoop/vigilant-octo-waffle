'use client';

import { useState, useEffect } from 'react';
import {
  Database,
  CheckCircle2,
  AlertTriangle,
  Play,
  RefreshCw,
  FileCode,
  ShieldAlert,
  ArrowRight,
  ShieldCheck,
  Check,
} from 'lucide-react';

interface MigrationRecord {
  version: string;
  name: string;
  appliedAt: string | null;
  executionDurationMs: number;
  status: 'APPLIED' | 'PENDING' | 'FAILED';
  ddlChecksum: string;
}

interface DdlLintFinding {
  rule: string;
  severity: 'BLOCKER' | 'WARNING' | 'INFO';
  message: string;
  line: number;
  suggestedFix: string;
}

const SAMPLE_DDL = `-- Dangerous DDL: Locks table against reads and writes
CREATE INDEX idx_users_email ON users (email);

-- Safe DDL Alternative:
-- CREATE INDEX CONCURRENTLY idx_users_email ON users (email);

ALTER TABLE orders ADD COLUMN status VARCHAR(32) DEFAULT 'pending';
`;

export default function MigratePage() {
  const [migrations, setMigrations] = useState<MigrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [ddlSql, setDdlSql] = useState(SAMPLE_DDL);
  const [linting, setLinting] = useState(false);
  const [lintFindings, setLintFindings] = useState<DdlLintFinding[]>([]);
  const [executingVersion, setExecutingVersion] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchMigrations = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/migrate');
      const data = await res.json();
      setMigrations(data.migrations || []);
    } catch (err) {
      console.error('Failed to load migrations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMigrations();
  }, []);

  const handleLint = async () => {
    setLinting(true);
    try {
      const res = await fetch('/api/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lint', sql: ddlSql }),
      });
      const data = await res.json();
      if (data.success) {
        setLintFindings(data.lintResult.findings || []);
      }
    } catch (err) {
      console.error('Linting failed:', err);
    } finally {
      setLinting(false);
    }
  };

  const handleExecute = async (version: string) => {
    setExecutingVersion(version);
    try {
      const res = await fetch('/api/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'execute', version }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(data.message);
        fetchMigrations();
      }
    } catch (err) {
      console.error('Execution failed:', err);
    } finally {
      setExecutingVersion(null);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
            <Database className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">OctoMigrate: Database Zero-Downtime Rollout Pilot</h1>
            <p className="text-sm text-slate-400">
              PostgreSQL schema migration tracking, pre-flight DDL table-lock linter, and non-blocking index validation
            </p>
          </div>
        </div>

        <button
          onClick={fetchMigrations}
          disabled={loading}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex justify-between items-center">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
      )}

      {/* Migration History Registry */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <FileCode className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-200">Schema Migration Timeline (PostgreSQL Primary)</h2>
          </div>
          <span className="text-xs text-slate-500 font-mono">{migrations.length} Versions Recorded</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider border-b border-slate-800 font-medium">
              <tr>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Migration Name</th>
                <th className="px-4 py-3">Applied At</th>
                <th className="px-4 py-3">Lock Duration</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {migrations.map((m) => {
                const isPending = m.status === 'PENDING';
                return (
                  <tr key={m.version} className="hover:bg-slate-900/40 transition">
                    <td className="px-4 py-3 font-mono font-medium text-slate-200">{m.version}</td>
                    <td className="px-4 py-3 font-mono text-slate-300">{m.name}</td>
                    <td className="px-4 py-3 text-slate-400">{m.appliedAt ? new Date(m.appliedAt).toLocaleString() : 'Unapplied'}</td>
                    <td className="px-4 py-3 font-mono text-slate-400">{m.executionDurationMs} ms</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                          isPending
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        }`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isPending ? (
                        <button
                          onClick={() => handleExecute(m.version)}
                          disabled={executingVersion === m.version}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded transition"
                        >
                          {executingVersion === m.version ? 'Applying...' : 'Apply Safely'}
                        </button>
                      ) : (
                        <span className="text-slate-500 text-[11px] font-mono">In-Sync</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* DDL Safety Linter Sandbox */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="flex items-center space-x-2">
          <ShieldAlert className="w-5 h-5 text-amber-400" />
          <h2 className="text-base font-bold text-slate-100">Zero-Downtime DDL Safety Linter</h2>
        </div>
        <p className="text-xs text-slate-400">
          Analyze SQL statements before running them on production or staging databases to avoid heavy exclusive table locks.
        </p>

        <div className="space-y-3">
          <textarea
            value={ddlSql}
            onChange={(e) => setDdlSql(e.target.value)}
            rows={5}
            className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-200 outline-none focus:border-emerald-500 leading-relaxed"
          />

          <button
            onClick={handleLint}
            disabled={linting}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg border border-slate-700 transition"
          >
            {linting ? 'Analyzing DDL...' : 'Lint DDL for Zero-Downtime'}
          </button>
        </div>

        {lintFindings.length > 0 && (
          <div className="space-y-3 pt-3 border-t border-slate-800">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Linter Findings</h3>
            <div className="space-y-2">
              {lintFindings.map((finding, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border text-xs space-y-2 ${
                    finding.severity === 'BLOCKER'
                      ? 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                      : 'bg-amber-950/20 border-amber-500/30 text-amber-300'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="font-mono font-bold">Line {finding.line}: {finding.rule}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-200 border border-rose-500/40">
                      {finding.severity}
                    </span>
                  </div>
                  <div>{finding.message}</div>
                  <div className="font-mono text-[11px] text-slate-300 p-2 bg-slate-950/80 rounded border border-slate-800">
                    Fix: {finding.suggestedFix}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
