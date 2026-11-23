'use client';

import { useState, useEffect } from 'react';
import {
  AlertTriangle,
  Layers,
  Clock,
  ExternalLink,
  Plus,
  Trash2,
  RefreshCw,
  GitBranch,
  GitPullRequest,
  Timer,
} from 'lucide-react';
import { apiErrorMessage } from '@/lib/envelope';

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
  provisioningStage?: 'namespace' | 'deploy' | 'ingress' | 'verifying';
  provisionError?: string;
}

interface CatalogTemplate {
  id: string;
  name: string;
  category: string;
  deployable?: boolean;
}

const PROVISION_STAGES = [
  { key: 'namespace', label: 'Namespace created' },
  { key: 'deploy', label: 'App deployed' },
  { key: 'ingress', label: 'Ingress created' },
  { key: 'verifying', label: 'Readiness verified' },
] as const;

export default function PreviewsStudioPage() {
  const [previews, setPreviews] = useState<PreviewEnvironment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [templates, setTemplates] = useState<CatalogTemplate[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [destroyingIds, setDestroyingIds] = useState<Set<string>>(new Set());

  // Form state — empty by default; the old '104' / 'feat/enterprise-oauth2'
  // / 'keycloak' values were hardcoded demo content, not real defaults.
  const [prNumber, setPrNumber] = useState('');
  const [branch, setBranch] = useState('');
  const [appName, setAppName] = useState('');
  const [ttlMinutes, setTtlMinutes] = useState(120);
  const [creating, setCreating] = useState(false);

  const fetchPreviews = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/previews');
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(apiErrorMessage(data));
      setPreviews(data.previews || []);
    } catch (err) {
      console.error('Failed to fetch previews:', err);
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/apps');
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(apiErrorMessage(data));
      const deployable = ((data.apps || []) as CatalogTemplate[]).filter((a) => a.deployable);
      setTemplates(deployable);
      setCatalogError(null);
      // Default the template to the first deployable app (only when
      // the user has not picked one yet).
      setAppName((current) => (current === '' && deployable.length > 0 ? deployable[0].id : current));
    } catch (err) {
      console.error('Failed to fetch app catalog:', err);
      setCatalogError(err instanceof Error ? err.message : 'Request failed');
    }
  };

  useEffect(() => {
    fetchPreviews();
    fetchTemplates();
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
      if (!res.ok || data.error) throw new Error(apiErrorMessage(data));
      if (data.success) {
        setError(null);
        // The record reports its real status: a fresh preview is
        // `provisioning` until the cluster verifies it — never claim
        // "Provisioned" up front.
        const preview = data.preview as PreviewEnvironment | undefined;
        const status = preview?.status ?? 'provisioning';
        setActionMessage(
          status === 'ready'
            ? `Preview environment for PR #${prNumber} is ready at ${preview?.previewUrl ?? ''}`
            : `Preview environment for PR #${prNumber} is ${status} — namespace, deploy and ingress are being verified`
        );
        setShowCreateModal(false);
        fetchPreviews();
      } else {
        setError(apiErrorMessage(data, typeof data.message === 'string' ? data.message : 'Action failed'));
      }
    } catch (err) {
      console.error('Failed to create preview:', err);
      setError(err instanceof Error ? err.message : 'Request failed');
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
      if (!res.ok || data.error) throw new Error(apiErrorMessage(data));
      if (data.success) {
        setError(null);
        setActionMessage(`Extended TTL by 60 minutes for ${id}`);
        fetchPreviews();
      } else {
        setError(apiErrorMessage(data, typeof data.message === 'string' ? data.message : 'Action failed'));
      }
    } catch (err) {
      console.error('Failed to extend TTL:', err);
      setError(err instanceof Error ? err.message : 'Request failed');
    }
  };

  const handleDestroy = async (id: string) => {
    setDestroyingIds((current) => new Set(current).add(id));
    try {
      const res = await fetch(`/api/previews?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(apiErrorMessage(data));
      if (data.success) {
        setError(null);
        setActionMessage(`Purged preview environment ${id}`);
        fetchPreviews();
      } else {
        setError(apiErrorMessage(data, typeof data.message === 'string' ? data.message : 'Action failed'));
      }
    } catch (err) {
      console.error('Failed to destroy preview:', err);
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setDestroyingIds((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
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
      if (!res.ok || data.error) throw new Error(apiErrorMessage(data));
      setError(null);
      setActionMessage(`Garbage collected ${data.purgedCount || 0} expired preview environments`);
      fetchPreviews();
    } catch (err) {
      console.error('Cleanup failed:', err);
      setError(err instanceof Error ? err.message : 'Request failed');
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {error && (
        <div className="flex items-center space-x-2 px-4 py-3 bg-rose-950/50 border border-rose-800 rounded text-rose-300 text-sm">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
          <span>{error}</span>
        </div>
      )}
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
            onClick={fetchPreviews}
            disabled={loading}
            className="flex items-center space-x-2 px-3 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

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
          const isProvisioning = preview.status === 'provisioning';
          const isTerminating = destroyingIds.has(preview.id) || preview.status === 'terminating';
          const stageIndex = isProvisioning
            ? PROVISION_STAGES.findIndex((s) => s.key === (preview.provisioningStage ?? 'verifying'))
            : PROVISION_STAGES.length;
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
                          : isTerminating
                            ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                            : isProvisioning
                              ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                      }`}
                    >
                      {isExpired ? 'Expired' : isTerminating ? 'Terminating…' : isProvisioning ? 'Provisioning' : 'Ready'}
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
                    <span className="font-mono text-indigo-300">{preview.commitSha || '—'}</span>
                  </div>
                </div>

                {isProvisioning && (
                  <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl text-xs space-y-1.5">
                    <div className="text-[10px] text-slate-500 uppercase tracking-wider">Provisioning progress</div>
                    {PROVISION_STAGES.map((stage, i) => (
                      <div key={stage.key} className="flex items-center space-x-2 text-slate-400">
                        <span className={i < stageIndex ? 'text-emerald-400' : i === stageIndex ? 'text-indigo-300' : 'text-slate-600'}>
                          {i < stageIndex ? '✓' : i === stageIndex ? '◌' : '○'}
                        </span>
                        <span className={i <= stageIndex ? 'text-slate-300' : ''}>{stage.label}</span>
                      </div>
                    ))}
                    {preview.provisionError && (
                      <div className="text-rose-400 pt-1">{preview.provisionError}</div>
                    )}
                  </div>
                )}

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
                      {preview.resourceLimits.cpu || '—'} / {preview.resourceLimits.memory || '—'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center space-x-4 text-xs text-slate-400">
                  <span>
                    Replicas: <span className="font-mono text-slate-300">{preview.replicas}</span>
                  </span>
                  <span className="truncate">
                    Image: <span className="font-mono text-slate-300">{preview.imageTag || '—'}</span>
                  </span>
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
                  placeholder="e.g. 104"
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
                  placeholder="e.g. feat/enterprise-oauth2"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 font-mono outline-none focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-slate-400 mb-1 font-medium">Base Application Template</label>
                {catalogError ? (
                  <>
                    <input
                      type="text"
                      value={appName}
                      onChange={(e) => setAppName(e.target.value)}
                      placeholder="Catalog failed to load — type an app id"
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-indigo-500"
                      required
                    />
                    <p className="text-rose-400 mt-1">Could not load the app catalog: {catalogError}</p>
                  </>
                ) : (
                  <select
                    value={appName}
                    onChange={(e) => setAppName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-slate-200 outline-none focus:border-indigo-500"
                    required
                  >
                    {templates.length === 0 && <option value="">Loading catalog…</option>}
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.category})
                      </option>
                    ))}
                  </select>
                )}
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
