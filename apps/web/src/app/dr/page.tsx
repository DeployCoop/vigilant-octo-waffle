'use client';

import { useState, useEffect } from 'react';
import {
  Timer,
  Play,
  CheckCircle2,
  FileText,
  RefreshCw,
} from 'lucide-react';

interface DRDrillStep {
  name: string;
  durationMs: number;
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  detail: string;
}

interface DRDrillResult {
  drillId: string;
  scenario: string;
  executedAt: string;
  targetNamespace: string;
  rtoSeconds: number;
  rpoHours: number;
  dataIntegrityPct: number;
  slaTargetSeconds: number;
  slaGrade: 'A+' | 'A' | 'B' | 'F';
  status: 'SUCCESS' | 'FAILED' | 'DEGRADED';
  steps: DRDrillStep[];
  complianceReport: string;
}

interface DRScorecard {
  readinessScore: number;
  grade: 'A+' | 'A' | 'B' | 'F';
  lastDrillAt: string;
  averageRtoSeconds: number;
  averageRpoHours: number;
  snapshotsAvailable: number;
  recentDrills: DRDrillResult[];
}

export default function DisasterRecoveryPage() {
  const [scorecard, setScorecard] = useState<DRScorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [scenario, setScenario] = useState('POSTGRES_VOLUME_CORRUPTION');
  const [drilling, setDrilling] = useState(false);
  const [currentDrill, setCurrentDrill] = useState<DRDrillResult | null>(null);

  const fetchScorecard = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/dr');
      const data = await res.json();
      setScorecard(data);
      if (data.recentDrills && data.recentDrills.length > 0) {
        setCurrentDrill(data.recentDrills[0]);
      }
    } catch (err) {
      console.error('Failed to load DR scorecard:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchScorecard();
  }, []);

  const handleLaunchDrill = async () => {
    setDrilling(true);
    try {
      const res = await fetch('/api/dr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrentDrill(data.drillResult);
        fetchScorecard();
      }
    } catch (err) {
      console.error('Drill launch failed:', err);
    } finally {
      setDrilling(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-rose-500/10 text-rose-400 rounded-xl border border-rose-500/20">
            <Timer className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Disaster Recovery (DR) Drill & MTTR Cockpit</h1>
            <p className="text-sm text-slate-400">
              Automated controlled outage simulator, snapshot restoration verification, and SLA compliance auditor
            </p>
          </div>
        </div>

        <button
          onClick={fetchScorecard}
          disabled={loading}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* DR Scorecard Banners */}
      {scorecard && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">DR Readiness Rating</div>
            <div className="text-2xl font-bold text-emerald-400">Grade {scorecard.grade} ({scorecard.readinessScore}%)</div>
            <div className="text-[11px] text-slate-500 mt-1">SLA Compliance: High Assurance</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Mean RTO (Time to Recovery)</div>
            <div className="text-2xl font-bold text-sky-400">{scorecard.averageRtoSeconds}s</div>
            <div className="text-[11px] text-emerald-400 mt-1">SLA Target: &lt;60.0s</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Mean RPO (Data Age)</div>
            <div className="text-2xl font-bold text-slate-100">{scorecard.averageRpoHours} hrs</div>
            <div className="text-[11px] text-slate-500 mt-1">Frequent snapshot cadence</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Available CSI Snapshots</div>
            <div className="text-2xl font-bold text-slate-100">{scorecard.snapshotsAvailable} Backups</div>
            <div className="text-[11px] text-slate-500 mt-1">MinIO & Velero synced</div>
          </div>
        </div>
      )}

      {/* Drill Launch Cockpit */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 space-y-5">
        <div className="flex items-center space-x-2">
          <Play className="w-4 h-4 text-rose-400" />
          <h2 className="text-sm font-semibold text-slate-200">Execute Controlled Disaster Recovery Drill</h2>
        </div>
        <p className="text-xs text-slate-400">
          Inject a controlled failure scenario into target persistent storage or namespaces, trigger automated backup restore, and benchmark recovery timing.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="md:col-span-2">
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Disaster Scenario</label>
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-200 outline-none focus:border-rose-500"
            >
              <option value="POSTGRES_VOLUME_CORRUPTION">
                💾 PostgreSQL Database Primary Volume Corruption (CSI Snapshot Rehydration)
              </option>
              <option value="NAMESPACE_ACCIDENTAL_DELETION">
                📦 Accidental Namespace Deletion (Nextcloud Full State Restoration)
              </option>
              <option value="ETCD_SPLIT_BRAIN_EMULATION">
                ⚡ Control Plane State Reconciliation & Split-Brain Healing
              </option>
            </select>
          </div>

          <div>
            <button
              onClick={handleLaunchDrill}
              disabled={drilling}
              className="w-full flex items-center justify-center space-x-2 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              {drilling ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>{drilling ? 'Executing Drill...' : 'Initiate DR Drill'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Active / Recent Drill Telemetry */}
      {currentDrill && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Step Telemetry */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-200">{currentDrill.drillId}</h3>
                <div className="text-[11px] text-slate-400">Target: {currentDrill.targetNamespace}</div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                  Grade {currentDrill.slaGrade} • RTO {currentDrill.rtoSeconds}s
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {currentDrill.steps.map((step, idx) => (
                <div key={idx} className="flex items-start space-x-3 text-xs p-3 bg-slate-950/60 rounded-lg border border-slate-800/80">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex justify-between">
                      <span className="font-semibold text-slate-200">{step.name}</span>
                      <span className="font-mono text-slate-400 text-[11px]">{step.durationMs}ms</span>
                    </div>
                    <div className="text-slate-400 text-[11px] mt-0.5">{step.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Compliance Certificate */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 space-y-3 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-slate-200 font-semibold text-sm border-b border-slate-800 pb-3">
                <FileText className="w-4 h-4 text-sky-400" />
                <span>Auditable DR Compliance Certificate</span>
              </div>
              <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 leading-relaxed mt-3 overflow-x-auto whitespace-pre-wrap">
                {currentDrill.complianceReport}
              </pre>
            </div>
            <div className="text-[11px] text-slate-500 mt-2">
              Automated audit record generated in accordance with ISO/IEC 27001 and SOC 2 Type II business continuity criteria.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
