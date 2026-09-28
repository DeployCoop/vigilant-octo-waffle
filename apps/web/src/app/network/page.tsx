'use client';

import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Copy,
  Check,
  Network,
  Lock,
  Code,
  Layers,
} from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';

interface NetworkPolicyInfo {
  name: string;
  namespace: string;
  policyTypes: ('Ingress' | 'Egress')[];
  podSelector: string;
  ingressRuleCount: number;
  egressRuleCount: number;
  createdAt: string;
}

interface TrafficConnection {
  source: string;
  target: string;
  status: 'allowed' | 'restricted' | 'isolated';
  description: string;
}

interface NetworkPolicyReport {
  totalPolicies: number;
  coveredNamespaces: string[];
  unprotectedNamespaces: string[];
  isolationScore: number;
  policies: NetworkPolicyInfo[];
  matrix: TrafficConnection[];
}

export default function NetworkPolicyPage() {
  const [report, setReport] = useState<NetworkPolicyReport | null>(null);
  const [loading, setLoading] = useState(true);

  // Scaffolder form state
  const [targetApp, setTargetApp] = useState('postgres');
  const [targetNs, setTargetNs] = useState('default');
  const [allowedCallers, setAllowedCallers] = useState('default, nextcloud, monitoring');
  const [scaffoldedYaml, setScaffoldedYaml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/network');
      const data = await res.json();
      setReport(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleScaffold = async () => {
    try {
      const callersArray = allowedCallers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch('/api/network', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scaffold',
          appId: targetApp,
          namespace: targetNs,
          allowedCallers: callersArray,
        }),
      });
      const data = await res.json();
      setScaffoldedYaml(data.manifest);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopy = async () => {
    if (!scaffoldedYaml) return;
    await copyToClipboard(scaffoldedYaml);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const namespaces = ['traefik', 'argocd', 'default', 'minio', 'postgres', 'vault', 'monitoring'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-3">
            <Network className="w-6 h-6 text-sky-400" />
            <span>Zero-Trust Network Policy Visualizer & Matrix</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Inter-namespace traffic boundary inspector, connectivity matrix, and automated zero-trust default-deny manifest generator.
          </p>
        </div>

        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center space-x-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 px-3.5 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
          <span>Rescan Policies</span>
        </button>
      </div>

      {/* KPI Cards */}
      {report && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-sky-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
              <Lock className="w-3.5 h-3.5" />
              <span>Isolation Coverage</span>
            </span>
            <span className="text-3xl font-bold text-slate-100 mt-2">{report.isolationScore}%</span>
            <span className="text-[11px] text-slate-500">{report.coveredNamespaces.length} of {report.coveredNamespaces.length + report.unprotectedNamespaces.length} namespaces protected</span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-emerald-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Active NetworkPolicies</span>
            </span>
            <span className="text-3xl font-bold text-slate-100 mt-2">{report.totalPolicies}</span>
            <span className="text-[11px] text-slate-500">Enforced by CNI / kube-router</span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-amber-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Unprotected Namespaces</span>
            </span>
            <span className="text-3xl font-bold text-slate-100 mt-2">{report.unprotectedNamespaces.length}</span>
            <span className="text-[11px] text-slate-500">Allowing unrestricted lateral traffic</span>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl flex flex-col justify-between">
            <span className="text-xs text-purple-400 font-semibold uppercase tracking-wider flex items-center space-x-1.5">
              <Layers className="w-3.5 h-3.5" />
              <span>Security Posture</span>
            </span>
            <span className="text-3xl font-bold text-slate-100 mt-2">
              {report.isolationScore > 60 ? 'Hardened' : 'Permissive'}
            </span>
            <span className="text-[11px] text-slate-500">Based on default-deny rules</span>
          </div>
        </div>
      )}

      {/* 2D Connectivity Matrix */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center space-x-2">
          <Network className="w-4 h-4 text-sky-400" />
          <span>Inter-Namespace Communication Matrix (Source ➔ Target)</span>
        </h2>
        <p className="text-xs text-slate-400">
          Evaluates lateral pod-to-pod traversal permissions. Click any cell to inspect policy rules.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-center font-mono text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/60">
                <th className="p-3 text-left">From \ To</th>
                {namespaces.map((ns) => (
                  <th key={ns} className="p-3 font-semibold text-slate-300">
                    {ns}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {namespaces.map((src) => (
                <tr key={src} className="border-b border-slate-800/40 hover:bg-slate-800/20">
                  <td className="p-3 font-semibold text-left text-slate-300 bg-slate-950/40">{src}</td>
                  {namespaces.map((tgt) => {
                    if (src === tgt) {
                      return (
                        <td key={tgt} className="p-3 text-slate-600 bg-slate-950/20">
                          --
                        </td>
                      );
                    }
                    const conn = report?.matrix?.find((c) => c.source === src && c.target === tgt);
                    const status = conn?.status || 'allowed';

                    return (
                      <td key={tgt} className="p-3" title={conn?.description}>
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                            status === 'restricted'
                              ? 'bg-amber-950/80 text-amber-400 border border-amber-800/50'
                              : status === 'isolated'
                              ? 'bg-rose-950/80 text-rose-400 border border-rose-800/50'
                              : 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/50'
                          }`}
                        >
                          {status === 'restricted' ? 'RESTRICT' : status === 'isolated' ? 'DENY' : 'ALLOW'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 1-Click Zero-Trust Policy Scaffolder */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-slate-200 flex items-center space-x-2">
          <Code className="w-4 h-4 text-purple-400" />
          <span>Zero-Trust Policy Scaffolder (Default Deny Generator)</span>
        </h2>
        <p className="text-xs text-slate-400">
          Generate hardened Kubernetes NetworkPolicy YAML enforcing default-deny ingress with designated caller allowlists.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Application ID</label>
            <input
              type="text"
              value={targetApp}
              onChange={(e) => setTargetApp(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Namespace</label>
            <input
              type="text"
              value={targetNs}
              onChange={(e) => setTargetNs(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Allowed Ingress Namespaces (comma-separated)</label>
            <input
              type="text"
              value={allowedCallers}
              onChange={(e) => setAllowedCallers(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleScaffold}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg text-xs font-semibold transition cursor-pointer shadow-sm"
          >
            Generate Hardened NetworkPolicy
          </button>
        </div>

        {scaffoldedYaml && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-300">Generated Manifest</span>
              <button
                onClick={handleCopy}
                className="flex items-center space-x-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 px-2.5 py-1 rounded transition cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy YAML'}</span>
              </button>
            </div>
            <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-purple-300 leading-relaxed overflow-x-auto">
              {scaffoldedYaml}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
