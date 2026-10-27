'use client';

import { useState, useEffect } from 'react';
import {
  History,
  Clock,
  RotateCcw,
  RefreshCw,
} from 'lucide-react';

interface ClusterStateSnapshot {
  id: string;
  timestamp: string;
  timeAgo: string;
  gitCommitSha: string;
  commitMessage: string;
  resourceCount: number;
  healthyPercent: number;
  tags: string[];
}

interface SnapshotDelta {
  resourceName: string;
  namespace: string;
  kind: string;
  changeType: 'ADDED' | 'MODIFIED' | 'REMOVED';
  diffSummary: string;
}

export default function RewindStudioPage() {
  const [snapshots, setSnapshots] = useState<ClusterStateSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSnapshot, setSelectedSnapshot] = useState<ClusterStateSnapshot | null>(null);
  const [deltas, setDeltas] = useState<SnapshotDelta[]>([]);
  const [rewinding, setRewinding] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const handleSelectSnapshot = async (snapshot: ClusterStateSnapshot) => {
    setSelectedSnapshot(snapshot);
    try {
      const res = await fetch('/api/rewind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'compare', snapshotId: snapshot.id }),
      });
      const data = await res.json();
      if (data.success) {
        setDeltas(data.comparison.deltas || []);
      }
    } catch (err) {
      console.error('Compare failed:', err);
    }
  };

  const fetchSnapshots = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rewind');
      const data = await res.json();
      setSnapshots(data.snapshots || []);
      if (data.snapshots && data.snapshots.length > 0) {
        handleSelectSnapshot(data.snapshots[0]);
      }
    } catch (err) {
      console.error('Failed to load snapshots:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSnapshots();
  }, []);

  const handleRewind = async () => {
    if (!selectedSnapshot) return;
    setRewinding(true);
    try {
      const res = await fetch('/api/rewind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rewind', snapshotId: selectedSnapshot.id }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(data.message);
        fetchSnapshots();
      }
    } catch (err) {
      console.error('Rewind failed:', err);
    } finally {
      setRewinding(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-amber-500/10 text-amber-400 rounded-xl border border-amber-500/20">
            <History className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">OctoRewind: GitOps Time-Machine & State Replay</h1>
            <p className="text-sm text-slate-400">
              Scrub back through historical cluster states, inspect added/modified resource deltas, and rewind state
            </p>
          </div>
        </div>

        <button
          onClick={fetchSnapshots}
          disabled={loading}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Snapshots</span>
        </button>
      </div>

      {actionMessage && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-xs text-amber-300 flex justify-between items-center">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
      )}

      {/* Snapshots Time Scrubber Grid */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Cluster State Snapshot Timeline</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {snapshots.map((snap) => {
            const isSelected = selectedSnapshot?.id === snap.id;
            return (
              <div
                key={snap.id}
                onClick={() => handleSelectSnapshot(snap)}
                className={`p-5 rounded-2xl border cursor-pointer transition space-y-3 ${
                  isSelected
                    ? 'bg-amber-950/20 border-amber-500/50 shadow-sm'
                    : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center space-x-2">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span className="text-xs font-bold text-slate-200">{snap.timeAgo}</span>
                  </div>

                  <div className="flex space-x-1">
                    {snap.tags.map((t) => (
                      <span key={t} className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-400">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-300 font-medium line-clamp-1">{snap.commitMessage}</div>
                  <div className="text-[11px] font-mono text-amber-400/90 mt-0.5">Commit: {snap.gitCommitSha}</div>
                </div>

                <div className="flex justify-between text-[11px] text-slate-500 font-mono pt-2 border-t border-slate-800/80">
                  <span>{snap.resourceCount} Resources</span>
                  <span className="text-emerald-400 font-bold">{snap.healthyPercent}% Healthy</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Snapshot Comparison & Rewind Action */}
      {selectedSnapshot && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-base font-bold text-slate-100">Comparing Live State vs [{selectedSnapshot.id}]</span>
                <span className="text-xs font-mono text-slate-400">({selectedSnapshot.timeAgo})</span>
              </div>
              <div className="text-xs text-slate-400 mt-1 font-mono">
                Historical Git Commit: <span className="text-amber-400">{selectedSnapshot.gitCommitSha}</span> - {selectedSnapshot.commitMessage}
              </div>
            </div>

            <button
              onClick={handleRewind}
              disabled={rewinding}
              className="flex items-center space-x-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              {rewinding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              <span>Rewind Cluster to This Snapshot</span>
            </button>
          </div>

          {/* Delta List */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Resource Deltas & Out-of-Sync Modifications
            </h3>

            <div className="space-y-2">
              {deltas.map((delta, idx) => {
                const isAdded = delta.changeType === 'ADDED';
                const isModified = delta.changeType === 'MODIFIED';

                return (
                  <div
                    key={idx}
                    className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80 flex items-start space-x-3 text-xs"
                  >
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold shrink-0 mt-0.5 border ${
                        isAdded
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                          : isModified
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                      }`}
                    >
                      {delta.changeType}
                    </span>

                    <div className="flex-1 space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-slate-200">{delta.resourceName}</span>
                        <span className="text-[11px] text-slate-500 font-mono">({delta.namespace} • {delta.kind})</span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">{delta.diffSummary}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
