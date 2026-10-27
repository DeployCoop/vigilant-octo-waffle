'use client';

import { useState, useEffect } from 'react';
import {
  Layers,
  Clock,
  ExternalLink,
  Plus,
  Trash2,
  RefreshCw,
  GitBranch,
  GitPullRequest,
  CheckCircle2,
  AlertCircle,
  Timer,
  Shield,
} from 'lucide-react';

interface PreviewEnvironment {
  id: string;
  prNumber: number;
  branch: string;
  appName: string;
  namespace: string;
  subdomain: string;
  previewUrl: string;
  status: 'provisioning' | 'ready' | 'expired' | 'terminating';
  createdAt: string;
  expiresAt: string;
  ttlMinutes: number;
  remainingMinutes: number;
  commitSha: string;
  imageTag: string;
  replicas: number;
  resourceLimits: {
    cpu: string;
    memory: string;
  };
}

export default function PreviewsStudioPage() {
  const [previews, setPreviews] = useState<PreviewEnvironment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Form state
  const [prNumber, setPrNumber] = useState('104');
  const [branch, setBranch] = useState('feat/enterprise-oauth2');
  const [appName, setAppName] = useState('keycloak');
  const [ttlMinutes, setTtlMinutes] = useState(120);
  const [creating, setCreating] = useState(false);

  const fetchPreviews = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/previews');
      const data = await res.json();
      setPreviews(data.previews || []);
    } catch (err) {
      console.error('Failed to fetch previews:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPreviews();
    const interval = setInterval(fetchPreviews, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch('/api/previews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prNumber: Number(prNumber),
          branch,
          appName,
          ttlMinutes: Number(ttlMinutes),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(`Provisioned preview environment for PR #${prNumber}`);
        setShowCreateModal(false);
        fetchPreviews();
      }
    } catch (err) {
      console.error('Failed to create preview:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleExtend = async (id: string) => {
    try {
      const res = await fetch('/api/previews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, additionalMinutes: 60 }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(`Extended TTL by 60 minutes for ${id}`);
        fetchPreviews();
      }
    } catch (err) {
      console.error('Failed to extend TTL:', err);
    }
  };

  const handleDestroy = async (id: string) => {
    try {
      const res = await fetch(`/api/previews?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(`Purged preview environment ${id}`);
        fetchPreviews();
      }
    } catch (err) {
      console.error('Failed to destroy preview:', err);
    }
  };

  const handleCleanupExpired = async () => {
    try {
      const res = await fetch('/api/previews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup' }),
      });
      const data = await res.json();
      setActionMessage(`Garbage collected ${data.purgedCount || 0} expired preview environments`);
      fetchPreviews();
    } catch (err) {
      console.error('Cleanup failed:', err);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
            <Layers className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Ephemeral PR & Branch Preview Environments</h1>
            <p className="text-sm text-slate-400">
              Spin up isolated feature branch preview namespaces with wildcard routing and auto-TTL destruction
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleCleanupExpired}
            className="flex items-center space-x-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
          >
            <Timer className="w-3.5 h-3.5 text-amber-400" />
            <span>Purge Expired</span>
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            <span>Spin Up Preview</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl text-xs text-indigo-300 flex justify-between items-center">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-200">
            ✕
          </button>
        </div>
      )}

      {/* Previews Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {previews.map((preview) => {
          const isExpired = preview.status === 'expired' || preview.remainingMinutes <= 0;
          return (
            <div
              key={preview.id}
              className={`bg-slate-900/40 border rounded-2xl p-6 transition flex flex-col justify-between ${
                isExpired ? 'border-amber-500/30 opacity-75' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="space-y-4">
                <div className="flex justify-between items-start">
                  <div className="flex items-center space-x-2">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                        isExpired
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                          : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      }`}
                    >
                      {isExpired ? 'Expired' : 'Active Preview'}
                    </span>
                    <span className="font-mono text-xs text-slate-400">PR #{preview.prNumber}</span>
                  </div>

                  <div className="flex items-center space-x-1.5 text-xs font-mono text-slate-400">
                    <Clock className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{isExpired ? 'TTL Ended' : `${preview.remainingMinutes}m remaining`}</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                    <span>{preview.appName}</span>
                    <span className="text-xs font-normal text-slate-500">in {preview.namespace}</span>
                  </h3>
                  <div className="flex items-center space-x-2 mt-1 text-xs text-slate-400">
                    <GitBranch className="w-3.5 h-3.5 text-slate-500" />
                    <span className="font-mono text-slate-300">{preview.branch}</span>
                    <span className="text-slate-600">•</span>
                    <span className="font-mono text-indigo-300">{preview.commitSha}</span>
                  </div>
                </div>

                <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl flex items-center justify-between text-xs">
                  <div className="truncate mr-2">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Preview Ingress URL</div>
                    <a
                      href={preview.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-indigo-400 hover:underline flex items-center space-x-1 mt-0.5 truncate"
                    >
                      <span className="truncate">{preview.subdomain}</span>
                      <ExternalLink className="w-3 h-3 shrink-0 ml-1" />
                    </a>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Quota</div>
                    <div className="font-mono text-slate-300 text-[11px]">
                      {preview.resourceLimits.cpu} / {preview.resourceLimits.memory}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-800/60 flex items-center justify-between">
                <button
                  onClick={() => handleExtend(preview.id)}
                  className="flex items-center space-x-1 text-xs font-medium text-slate-300 hover:text-indigo-300 transition"
                >
                  <Timer className="w-3.5 h-3.5" />
                  <span>Extend +1h</span>
                </button>

                <button
                  onClick={() => handleDestroy(preview.id)}
                  className="flex items-center space-x-1 text-xs font-medium text-rose-400 hover:text-rose-300 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Tear Down</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 space-y-5">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center space-x-2">
                <GitPullRequest className="w-5 h-5 text-indigo-400" />
                <span>Spin Up Feature Branch Preview</span>
              </h3>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-200">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-400 mb-1 font-medium">Pull Request #</label>
                <input
                  type="number"
                  value={prNumber}
                  onChange={(e) => setPrNumber(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 font-mono outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Git Branch</label>
                <input
                  type="text"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 font-mono outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Base Application Template</label>
                <select
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-indigo-500"
                >
                  <option value="keycloak">Keycloak SSO</option>
                  <option value="nextcloud">Nextcloud Storage</option>
                  <option value="postgres">PostgreSQL Cluster</option>
                  <option value="minio">MinIO Object Store</option>
                  <option value="custom-app">Custom Microservice</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">TTL (Auto-Destruction Countdown)</label>
                <select
                  value={ttlMinutes}
                  onChange={(e) => setTtlMinutes(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-indigo-500"
                >
                  <option value={30}>30 Minutes</option>
                  <option value={120}>2 Hours (Default)</option>
                  <option value={480}>8 Hours (Full Workday)</option>
                  <option value={1440}>24 Hours</option>
                </select>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 rounded-lg hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 font-medium flex items-center space-x-2"
                >
                  {creating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Provision Environment</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
