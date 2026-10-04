'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  Download,
  Play,
  RefreshCw,
  GitCompare,
  FileCode,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Save,
} from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { apiErrorMessage } from '@/lib/envelope';

export interface DetectedManifestPayload {
  raw: string;
  kind?: string;
  name?: string;
  namespace?: string;
  targetAppId?: string;
  isArgoApp?: boolean;
}

interface YamlDiffModalProps {
  isOpen: boolean;
  onClose: () => void;
  manifest: DetectedManifestPayload | null;
  onApplied?: (appId: string) => void;
  onExecuteCommand?: (cmd: string) => void;
}

interface AppSummary {
  id: string;
  name: string;
  category: string;
}

export function YamlDiffModal({
  isOpen,
  onClose,
  manifest,
  onApplied,
  onExecuteCommand,
}: YamlDiffModalProps) {
  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [catalogApps, setCatalogApps] = useState<AppSummary[]>([]);
  const [currentManifest, setCurrentManifest] = useState<string | null>(null);
  const [loadingActive, setLoadingActive] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'diff' | 'side-by-side' | 'raw'>('side-by-side');

  // Load app catalog for fallback selection
  useEffect(() => {
    fetch('/api/apps')
      .then((res) => res.json())
      .then((data) => {
        if (data.apps) {
          setCatalogApps(data.apps);
        }
      })
      .catch(() => {});
  }, []);

  // Update selectedAppId when manifest changes
  useEffect(() => {
    if (manifest?.targetAppId) {
      setSelectedAppId(manifest.targetAppId);
    } else {
      setSelectedAppId('');
      setCurrentManifest(null);
    }
    setStatusMessage(null);
  }, [manifest]);

  // Fetch current manifest whenever selectedAppId changes
  useEffect(() => {
    if (!selectedAppId) {
      setCurrentManifest(null);
      return;
    }

    setLoadingActive(true);
    fetch(`/api/apps/${selectedAppId}`)
      .then((res) => res.json())
      .then((data) => {
        setLoadingActive(false);
        if (data.overrideManifest) {
          setCurrentManifest(data.overrideManifest);
        } else if (data.baseManifest) {
          setCurrentManifest(data.baseManifest);
        } else {
          setCurrentManifest(null);
        }
      })
      .catch(() => {
        setLoadingActive(false);
        setCurrentManifest(null);
      });
  }, [selectedAppId]);

  if (!isOpen || !manifest) return null;

  const handleCopy = async () => {
    const success = await copyToClipboard(manifest.raw);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([manifest.raw], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedAppId || manifest.name || 'manifest'}-patch.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleApplyOverride = async (syncAfter: boolean = false) => {
    if (!selectedAppId) return;

    setApplying(true);
    setStatusMessage(null);

    try {
      const res = await fetch(`/api/apps/${selectedAppId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveOverride',
          overrideYaml: manifest.raw,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(apiErrorMessage(data, 'Failed to save manifest override'));
      }

      if (syncAfter) {
        setSyncing(true);
        const syncRes = await fetch(`/api/apps/${selectedAppId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sync' }),
        });
        const syncData = await syncRes.json();
        setSyncing(false);

        if (!syncRes.ok) {
          throw new Error(syncData.error || 'Saved override, but sync request failed');
        }

        setStatusMessage({
          type: 'success',
          text: `Applied to .argo_overrides/${selectedAppId}/argocd.yaml and triggered sync (Task #${syncData.taskId || 'queued'}).`,
        });
      } else {
        setStatusMessage({
          type: 'success',
          text: `Saved to .argo_overrides/${selectedAppId}/argocd.yaml successfully.`,
        });
      }

      if (onApplied) onApplied(selectedAppId);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message });
    } finally {
      setApplying(false);
      setSyncing(false);
    }
  };

  const handleApplyKubectl = () => {
    if (!onExecuteCommand) return;
    const cmd = `cat <<'EOF' | kubectl apply -f -\n${manifest.raw.trim()}\nEOF`;
    onExecuteCommand(cmd);
    onClose();
  };

  // Compute unified diff lines
  const computeDiffLines = (oldText: string, newText: string) => {
    const oldLines = oldText ? oldText.split('\n') : [];
    const newLines = newText.split('\n');

    const result: Array<{ type: 'added' | 'removed' | 'unchanged'; text: string }> = [];

    // Simple line set comparison for visual feedback
    const oldSet = new Set(oldLines.map((l) => l.trim()));
    const newSet = new Set(newLines.map((l) => l.trim()));

    for (const line of oldLines) {
      if (!newSet.has(line.trim())) {
        result.push({ type: 'removed', text: line });
      } else {
        result.push({ type: 'unchanged', text: line });
      }
    }

    for (const line of newLines) {
      if (!oldSet.has(line.trim())) {
        result.push({ type: 'added', text: line });
      }
    }

    return result;
  };

  const diffLines = computeDiffLines(currentManifest || '', manifest.raw);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative flex flex-col w-full max-w-5xl h-[85vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <GitCompare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-semibold text-slate-100">
                  Review & Apply Manifest Patch
                </h3>
                {manifest.kind && (
                  <span className="px-2 py-0.5 text-xs font-mono font-medium rounded-full bg-slate-800 text-sky-400 border border-slate-700">
                    {manifest.kind}
                  </span>
                )}
                {manifest.name && (
                  <span className="px-2 py-0.5 text-xs font-mono text-slate-400">
                    {manifest.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Inspect AI-suggested Kubernetes/ArgoCD resources against cluster base manifests.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-800 rounded-lg p-0.5 text-xs border border-slate-700">
              <button
                onClick={() => setViewMode('side-by-side')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  viewMode === 'side-by-side'
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Side-by-Side
              </button>
              <button
                onClick={() => setViewMode('diff')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  viewMode === 'diff'
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Unified Diff
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  viewMode === 'raw'
                    ? 'bg-indigo-600 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Raw YAML
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Target App Bar */}
        <div className="flex items-center justify-between px-6 py-2.5 bg-slate-950/60 border-b border-slate-800/80 text-xs">
          <div className="flex items-center space-x-3">
            <span className="text-slate-400 font-medium">Target Catalog App:</span>
            <select
              value={selectedAppId}
              onChange={(e) => setSelectedAppId(e.target.value)}
              className="px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-200 font-mono text-xs focus:ring-1 focus:ring-indigo-500 focus:outline-none"
            >
              <option value="">-- Generic Manifest (No Catalog App) --</option>
              {catalogApps.map((app) => (
                <option key={app.id} value={app.id}>
                  {app.name} ({app.id})
                </option>
              ))}
            </select>

            {loadingActive && (
              <span className="flex items-center text-slate-400 space-x-1">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Loading active manifest...</span>
              </span>
            )}

            {selectedAppId && !loadingActive && currentManifest && (
              <span className="flex items-center text-emerald-400 space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Loaded baseline configuration</span>
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopy}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center space-x-1 px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download</span>
            </button>
          </div>
        </div>

        {/* Status Message Banner */}
        {statusMessage && (
          <div
            className={`px-6 py-2.5 text-xs flex items-center space-x-2 border-b ${
              statusMessage.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
                : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span className="font-mono">{statusMessage.text}</span>
          </div>
        )}

        {/* Main Diff Content Area */}
        <div className="flex-1 overflow-hidden p-4 bg-slate-950 font-mono text-xs">
          {viewMode === 'side-by-side' ? (
            <div className="grid grid-cols-2 gap-4 h-full">
              {/* Left Column: Current Base/Override */}
              <div className="flex flex-col h-full rounded-lg border border-slate-800 bg-slate-900/60 overflow-hidden">
                <div className="px-3 py-2 bg-slate-900 border-b border-slate-800 text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                  <span>Current Active Config {selectedAppId ? `(${selectedAppId})` : ''}</span>
                  <span className="text-[10px] text-slate-500 font-normal">
                    {currentManifest ? 'Existing source' : 'None detected'}
                  </span>
                </div>
                <div className="flex-1 overflow-auto p-3 text-slate-300 leading-relaxed font-mono whitespace-pre select-text">
                  {currentManifest || '# No base or override manifest found for this app in argo/ or .argo_overrides/'}
                </div>
              </div>

              {/* Right Column: Suggested Patch */}
              <div className="flex flex-col h-full rounded-lg border border-indigo-900/60 bg-slate-900/60 overflow-hidden shadow-sm">
                <div className="px-3 py-2 bg-indigo-950/50 border-b border-indigo-900/60 text-[11px] font-semibold text-indigo-300 flex items-center justify-between">
                  <span>AI Suggested Patch / Override</span>
                  <span className="text-[10px] text-indigo-400 font-normal">Ready to apply</span>
                </div>
                <div className="flex-1 overflow-auto p-3 text-emerald-300/90 leading-relaxed font-mono whitespace-pre select-text bg-emerald-950/10">
                  {manifest.raw}
                </div>
              </div>
            </div>
          ) : viewMode === 'diff' ? (
            <div className="h-full rounded-lg border border-slate-800 bg-slate-900/60 overflow-auto p-4 leading-relaxed select-text">
              {diffLines.map((line, idx) => (
                <div
                  key={idx}
                  className={`flex items-start px-2 py-0.5 rounded ${
                    line.type === 'added'
                      ? 'bg-emerald-950/40 text-emerald-300'
                      : line.type === 'removed'
                      ? 'bg-rose-950/40 text-rose-300'
                      : 'text-slate-400'
                  }`}
                >
                  <span className="w-6 shrink-0 select-none text-[10px] text-slate-600">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span className="whitespace-pre">{line.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full rounded-lg border border-slate-800 bg-slate-900/60 overflow-auto p-4 text-slate-200 select-text leading-relaxed whitespace-pre">
              {manifest.raw}
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-900/90">
          <div className="text-xs text-slate-400">
            {selectedAppId ? (
              <span>
                Target destination:{' '}
                <code className="text-indigo-400 font-mono">
                  .argo_overrides/{selectedAppId}/argocd.yaml
                </code>
              </span>
            ) : (
              <span>Select an app from the catalog above to save as a GitOps override.</span>
            )}
          </div>

          <div className="flex items-center space-x-3">
            {onExecuteCommand && (
              <button
                onClick={handleApplyKubectl}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition-colors"
                title="Execute kubectl apply directly on the cluster"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Apply via kubectl</span>
              </button>
            )}

            {selectedAppId && (
              <>
                <button
                  disabled={applying || syncing}
                  onClick={() => handleApplyOverride(false)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-indigo-900/60 hover:bg-indigo-800 text-indigo-200 text-xs font-medium border border-indigo-700/60 transition-colors disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>Save Override</span>
                </button>

                <button
                  disabled={applying || syncing}
                  onClick={() => handleApplyOverride(true)}
                  className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md transition-colors disabled:opacity-50"
                >
                  {syncing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Syncing App...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Apply to Overrides & Sync</span>
                    </>
                  )}
                </button>
              </>
            )}

            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
