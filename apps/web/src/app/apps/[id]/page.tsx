'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Code,
  Save,
  Play,
  RotateCw,
  FileText,
  AlertCircle,
  CheckCircle2,
  Columns,
} from 'lucide-react';

export default function AppDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [data, setData] = useState<any>(null);
  const [overrideYaml, setOverrideYaml] = useState('');
  const [activeTab, setActiveTab] = useState<'split' | 'override' | 'base' | 'templated'>('split');
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fetchAppDetail = async () => {
    try {
      const res = await fetch(`/api/apps/${id}`);
      const result = await res.json();
      setData(result);
      if (result.overrideManifest) {
        setOverrideYaml(result.overrideManifest);
      } else {
        setOverrideYaml('# Write your YAML overrides here. They will be merged into argocd.yaml with deep merge.\n');
      }
    } catch {
      // offline
    }
  };

  useEffect(() => {
    if (id) fetchAppDetail();
  }, [id]);

  const handleSaveOverride = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/apps/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveOverride',
          overrideYaml,
        }),
      });
      const resData = await res.json();
      if (resData.success) {
        setMessage('Override saved to .argo_overrides/ successfully!');
        fetchAppDetail();
      }
    } catch (err: any) {
      setMessage(`Error saving: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    try {
      const res = await fetch(`/api/apps/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deploy' }),
      });
      const resData = await res.json();
      if (resData.success) {
        setMessage(`Deployed ${id} (Task ID: ${resData.taskId})`);
      }
    } catch (err: any) {
      setMessage(`Deploy failed: ${err.message}`);
    } finally {
      setDeploying(false);
    }
  };

  if (!data) {
    return <div className="p-8 text-center text-slate-400">Loading app manifests...</div>;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/apps"
          className="text-xs text-slate-400 hover:text-white flex items-center space-x-1.5 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Catalog</span>
        </Link>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleSaveOverride}
            disabled={saving}
            className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5 text-sky-400" />
            <span>Save Override</span>
          </button>
          <button
            onClick={handleDeploy}
            disabled={deploying}
            className="px-3.5 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors disabled:opacity-50 shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-white" />
            <span>Deploy to ArgoCD</span>
          </button>
        </div>
      </div>

      {message && (
        <div className="p-4 bg-sky-950/60 border border-sky-800 text-sky-300 text-sm rounded-lg flex items-center justify-between">
          <span>{message}</span>
          <Link href="/terminal" className="underline hover:text-white text-xs font-semibold">
            View Live Terminal →
          </Link>
        </div>
      )}

      {/* Manifest Viewer & Editor */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        {/* Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950/50">
          <button
            onClick={() => setActiveTab('split')}
            className={`px-4 py-3 text-xs font-semibold transition-colors flex items-center space-x-1.5 ${
              activeTab === 'split'
                ? 'border-b-2 border-sky-500 text-sky-400 bg-slate-900/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Side-by-Side Diff (Base vs Override)</span>
          </button>
          <button
            onClick={() => setActiveTab('override')}
            className={`px-4 py-3 text-xs font-semibold transition-colors flex items-center space-x-2 ${
              activeTab === 'override'
                ? 'border-b-2 border-sky-500 text-sky-400 bg-slate-900/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>User Override (.argo_overrides)</span>
          </button>
          <button
            onClick={() => setActiveTab('base')}
            className={`px-4 py-3 text-xs font-semibold transition-colors flex items-center space-x-2 ${
              activeTab === 'base'
                ? 'border-b-2 border-sky-500 text-sky-400 bg-slate-900/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Base Manifest (argo/{id})</span>
          </button>
          <button
            onClick={() => setActiveTab('templated')}
            className={`px-4 py-3 text-xs font-semibold transition-colors flex items-center space-x-2 ${
              activeTab === 'templated'
                ? 'border-b-2 border-sky-500 text-sky-400 bg-slate-900/60'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>Merged & Substituted Preview</span>
          </button>
        </div>

        <div className="p-4">
          {activeTab === 'split' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="text-xs font-mono text-slate-400 px-1 flex items-center justify-between">
                  <span>argo/{id}/argocd.yaml (Base)</span>
                  <span className="text-[10px] text-slate-500">Read-Only</span>
                </div>
                <pre className="p-4 font-mono text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-300 overflow-x-auto h-[550px] leading-relaxed select-text">
                  {data.baseManifest || 'No base manifest.'}
                </pre>
              </div>

              <div className="space-y-1.5">
                <div className="text-xs font-mono text-sky-400 px-1 flex items-center justify-between">
                  <span>.argo_overrides/{id}/argocd.yaml (Custom Overrides)</span>
                  <span className="text-[10px] text-emerald-400">Editable</span>
                </div>
                <textarea
                  rows={24}
                  value={overrideYaml}
                  onChange={(e) => setOverrideYaml(e.target.value)}
                  className="w-full h-[550px] p-4 font-mono text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 leading-relaxed resize-none"
                  placeholder="# Enter custom values to deep-merge on top of base..."
                />
              </div>
            </div>
          )}

          {activeTab === 'override' && (
            <textarea
              rows={24}
              value={overrideYaml}
              onChange={(e) => setOverrideYaml(e.target.value)}
              className="w-full p-4 font-mono text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-200 focus:outline-none focus:border-sky-500 leading-relaxed resize-y"
              placeholder="Paste or write ArgoCD yaml overrides here..."
            />
          )}

          {activeTab === 'base' && (
            <pre className="p-4 font-mono text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-300 overflow-x-auto max-h-[600px] leading-relaxed">
              {data.baseManifest || 'No base manifest found.'}
            </pre>
          )}

          {activeTab === 'templated' && (
            <pre className="p-4 font-mono text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-300 overflow-x-auto max-h-[600px] leading-relaxed">
              {data.templatedYaml || 'Preview unavailable or template substitution failed.'}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
