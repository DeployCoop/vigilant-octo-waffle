'use client';

import { useState, useEffect, useRef } from 'react';
import { apiErrorMessage } from '@/lib/envelope';
import {
  Settings,
  Save,
  Key,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Shield,
  Server,
  Mail,
  Globe,
  Download,
  Upload,
  FileCode,
  Network,
} from 'lucide-react';

export default function ConfigPage() {
  const [config, setConfig] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [secretLoading, setSecretLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Profile export/import state
  const [profileName, setProfileName] = useState('vow-profile');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchConfig = async () => {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      setConfig(data.config || {});
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const handleChange = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: config }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage('Configuration saved to .env file successfully!');
      }
    } catch (err: any) {
      setMessage(`Error saving configuration: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateSecrets = async () => {
    if (!confirm('Regenerate all passwords and cluster secrets?')) return;
    setSecretLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/secrets', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setMessage(`Generated ${data.secretKeys.length} new cryptographic secrets in .secrets/`);
      }
    } catch (err: any) {
      setMessage(`Failed generating secrets: ${err.message}`);
    } finally {
      setSecretLoading(false);
    }
  };

  const handleExportProfile = async () => {
    try {
      const res = await fetch(`/api/profiles?name=${encodeURIComponent(profileName)}`);
      const bundle = await res.json();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${profileName}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMessage(`Exported configuration bundle: ${profileName}.json`);
    } catch (err: any) {
      setMessage(`Export failed: ${err.message}`);
    }
  };

  const handleImportProfileFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const res = await fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bundle),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Imported profile '${data.name}' with overrides and enablers successfully!`);
        fetchConfig();
      } else {
        setMessage(`Import error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed parsing profile JSON: ${err.message}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Settings className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Configuration Studio</h2>
          </div>
          <p className="text-sm text-slate-400">
            Fine-tune environment parameters and manage cluster-wide cryptographic secrets
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleRegenerateSecrets}
            disabled={secretLoading}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors disabled:opacity-50"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>Regenerate Secrets</span>
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-colors disabled:opacity-50 shadow-sm"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save to .env</span>
          </button>
        </div>
      </div>

      {message && (
        <div className="p-4 bg-sky-950/60 border border-sky-800 text-sky-300 text-sm rounded-lg flex items-center justify-between">
          <span>{message}</span>
        </div>
      )}

      {/* Profiles & Portability Bundle */}
      <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-2">
            <FileCode className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
              Profile Snapshot & Portability
            </h3>
          </div>
          <span className="text-[11px] text-slate-500">Exports .env, enablers, and all .argo_overrides</span>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <input
            type="text"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            placeholder="Profile name"
            className="w-full sm:w-64 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500 font-mono text-xs"
          />

          <button
            onClick={handleExportProfile}
            className="w-full sm:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center justify-center space-x-2 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span>Export Snapshot (.json)</span>
          </button>

          <input
            type="file"
            ref={fileInputRef}
            accept=".json"
            onChange={handleImportProfileFile}
            className="hidden"
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full sm:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold flex items-center justify-center space-x-2 transition-colors"
          >
            <Upload className="w-3.5 h-3.5 text-emerald-400" />
            <span>Import Snapshot (.json)</span>
          </button>
        </div>
      </div>

      {/* Settings Sections */}
      <div className="space-y-6">
        {/* Core Cluster Section */}
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
            <Server className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Cluster & Platform</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">THIS_K8S_TYPE</label>
              <select
                value={config['THIS_K8S_TYPE'] || 'kind'}
                onChange={(e) => handleChange('THIS_K8S_TYPE', e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500"
              >
                <option value="kind">KinD (Kubernetes-in-Docker)</option>
                <option value="k3d">K3d (Rancher K3s-in-Docker)</option>
                <option value="k3s">K3s (Existing / Baremetal)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">THIS_CLUSTER_INGRESS</label>
              <select
                value={config['THIS_CLUSTER_INGRESS'] || 'nginx'}
                onChange={(e) => handleChange('THIS_CLUSTER_INGRESS', e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500"
              >
                <option value="nginx">ingress-nginx</option>
                <option value="traefik">Traefik</option>
                <option value="haproxy">HAProxy</option>
              </select>
            </div>
          </div>
        </div>

        {/* Domain & Namespace Section */}
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
            <Globe className="w-4 h-4 text-indigo-400" />
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Domain & Identity</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">THIS_NAME</label>
              <input
                type="text"
                value={config['THIS_NAME'] || 'example'}
                onChange={(e) => handleChange('THIS_NAME', e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">THIS_TLD</label>
              <input
                type="text"
                value={config['THIS_TLD'] || 'com'}
                onChange={(e) => handleChange('THIS_TLD', e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">THIS_DOMAIN</label>
              <input
                type="text"
                value={config['THIS_DOMAIN'] || 'example.com'}
                onChange={(e) => handleChange('THIS_DOMAIN', e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">THIS_ADMIN_USER</label>
              <input
                type="text"
                value={config['THIS_ADMIN_USER'] || 'myadmin'}
                onChange={(e) => handleChange('THIS_ADMIN_USER', e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        </div>

        {/* Custom Ingress & Domain Routing */}
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <Network className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">
                Custom Ingress Domains & DNS Routing
              </h3>
            </div>
            <span className="text-[11px] text-slate-500">External FQDNs for Ingress & DNS</span>
          </div>

          <p className="text-xs text-slate-400 leading-relaxed">
            Configure external domain names and Ingress TLS hosts for cluster applications.
            These domain names are dynamically registered into /etc/hosts and DNS zone record generators.
          </p>

          <div className="space-y-4 pt-2">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">
                Custom Extra Domains (THIS_EXTRA_DOMAINS)
              </label>
              <input
                type="text"
                value={config['THIS_EXTRA_DOMAINS'] || ''}
                onChange={(e) => handleChange('THIS_EXTRA_DOMAINS', e.target.value)}
                placeholder="app1.example.com, api.example.org, custom.domain.io"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-cyan-500 font-mono text-xs"
              />
              <span className="text-[11px] text-slate-500 mt-1 block">
                Comma-separated list of custom FQDNs to include in DNS and /etc/hosts generation
              </span>
            </div>
          </div>
        </div>

        {/* Email & SMTP */}
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800 pb-3">
            <Mail className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-slate-200 uppercase tracking-wider">Outbound SMTP & Notifications</h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">THIS_OUT_SMTP_HOST</label>
              <input
                type="text"
                value={config['THIS_OUT_SMTP_HOST'] || 'mail.example.com'}
                onChange={(e) => handleChange('THIS_OUT_SMTP_HOST', e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">THIS_OUT_SMTP_PORT</label>
              <input
                type="text"
                value={config['THIS_OUT_SMTP_PORT'] || '587'}
                onChange={(e) => handleChange('THIS_OUT_SMTP_PORT', e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
