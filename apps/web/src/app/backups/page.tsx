'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Archive,
  RefreshCw,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Plus,
  X,
  Camera,
  Server,
} from 'lucide-react';

interface BackupItem {
  id: string;
  name: string;
  type: 'velero' | 'docker-snapshot';
  status: string;
  created: string;
  details?: string;
}

export default function BackupsPage() {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // New Backup Modal
  const [showModal, setShowModal] = useState(false);
  const [backupName, setBackupName] = useState('');
  const [namespaces, setNamespaces] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchBackups = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/backups');
      const data = await res.json();
      setBackups(data.backups || []);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBackups();
  }, []);

  const handleCreateBackup = async () => {
    if (!backupName.trim()) return;
    setSubmitting(true);
    try {
      const nsList = namespaces
        ? namespaces.split(',').map((s) => s.trim()).filter(Boolean)
        : undefined;

      const res = await fetch('/api/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'backup',
          name: backupName.trim(),
          namespaces: nsList,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(`Triggered backup ${backupName} (Task ID: ${data.taskId})`);
        setShowModal(false);
        setBackupName('');
        setNamespaces('');
        fetchBackups();
      }
    } catch (err: any) {
      setActionMessage(`Backup failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestore = async (backup: BackupItem) => {
    if (!confirm(`Restore cluster state from backup "${backup.name}"?`)) return;
    try {
      const res = await fetch('/api/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'restore',
          backupName: backup.name,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(`Triggered restore task for ${backup.name} (Task ID: ${data.taskId})`);
      }
    } catch (err: any) {
      setActionMessage(`Restore failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Archive className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Cluster Backups & Snapshots</h2>
          </div>
          <p className="text-sm text-slate-400">
            Automated cluster state backups via Velero, CSI volume snapshots, and container rollbacks
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchBackups}
            disabled={loading}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Backup</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-4 bg-sky-950/60 border border-sky-800 text-sky-300 text-sm rounded-lg flex items-center justify-between">
          <span>{actionMessage}</span>
          <Link href="/terminal" className="underline hover:text-white text-xs font-semibold">
            View Live Terminal →
          </Link>
        </div>
      )}

      {/* Backups List */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
            <tr>
              <th className="px-5 py-3 font-semibold">Backup / Snapshot Name</th>
              <th className="px-5 py-3 font-semibold">Type</th>
              <th className="px-5 py-3 font-semibold">Status</th>
              <th className="px-5 py-3 font-semibold">Created</th>
              <th className="px-5 py-3 font-semibold">Details</th>
              <th className="px-5 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
            {backups.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-slate-500 font-sans">
                  No backups found. Click &quot;Create Backup&quot; to initiate a Velero snapshot.
                </td>
              </tr>
            ) : (
              backups.map((b) => (
                <tr key={b.id} className="hover:bg-slate-800/40">
                  <td className="px-5 py-3.5 font-bold text-slate-200">{b.name}</td>
                  <td className="px-5 py-3.5">
                    <span className="bg-slate-800 px-2 py-0.5 rounded text-[11px] font-sans">
                      {b.type === 'velero' ? 'Velero CRD' : 'Docker Snapshot'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded font-sans text-[11px] font-semibold">
                      {b.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-400">{b.created}</td>
                  <td className="px-5 py-3.5 text-slate-400 truncate max-w-xs">{b.details || '-'}</td>
                  <td className="px-5 py-3.5 text-right font-sans">
                    {b.type === 'velero' && (
                      <button
                        onClick={() => handleRestore(b)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-amber-600 hover:text-white text-slate-300 border border-slate-700 rounded transition-colors text-xs inline-flex items-center space-x-1"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Restore</span>
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Backup Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Create Velero Backup</h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">Backup Name</label>
                <input
                  type="text"
                  placeholder="e.g. pre-upgrade-snap"
                  value={backupName}
                  onChange={(e) => setBackupName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500 font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 mb-1">
                  Included Namespaces (Optional, comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. default, argocd, goharbor (Leave empty for all)"
                  value={namespaces}
                  onChange={(e) => setNamespaces(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500 font-mono text-xs"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-end space-x-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateBackup}
                disabled={submitting || !backupName.trim()}
                className="px-4 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
              >
                {submitting ? 'Starting...' : 'Start Backup'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
