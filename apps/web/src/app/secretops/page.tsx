'use client';

import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Key,
  Lock,
  RefreshCw,
  AlertTriangle,
  Copy,
  Check,
} from 'lucide-react';

interface SecretLeakFinding {
  id: string;
  workloadName: string;
  namespace: string;
  targetType: 'POD_ENV' | 'CONFIGMAP' | 'CONTAINER_ARG' | 'LOG_STDOUT';
  key: string;
  maskedValue: string;
  detectedType: 'AWS_KEY' | 'PRIVATE_KEY' | 'GITHUB_TOKEN' | 'DATABASE_PASSWORD' | 'GENERIC_HIGH_ENTROPY';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  recommendation: string;
}

interface SecretHygieneRecord {
  secretName: string;
  namespace: string;
  type: string;
  ageDays: number;
  lastRotated: string;
  status: 'HEALTHY' | 'WARNING' | 'EXPIRED_ROTATION_NEEDED';
  managedBy: 'Manual' | 'ArgoCD' | 'ESO / Vault' | 'cert-manager';
}

interface SecretOpsReport {
  totalSecrets: number;
  leaksDetected: SecretLeakFinding[];
  hygieneRecords: SecretHygieneRecord[];
  staleSecretCount: number;
  externalVaultConnected: boolean;
}

export default function SecretOpsPage() {
  const [report, setReport] = useState<SecretOpsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotatingSecret, setRotatingSecret] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Sealed secret form
  const [targetSecret, setTargetSecret] = useState('app-api-token');
  const [targetNamespace, setTargetNamespace] = useState('default');
  const [generatedSealedYaml, setGeneratedSealedYaml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/secretops');
      const data = await res.json();
      setReport(data);
    } catch (err) {
      console.error('Failed to load secretops report:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReport();
  }, []);

  const handleRotate = async (secretName: string, namespace: string) => {
    setRotatingSecret(secretName);
    try {
      const res = await fetch('/api/secretops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate', secretName, namespace }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(data.message);
        fetchReport();
      }
    } catch (err) {
      console.error('Rotation failed:', err);
    } finally {
      setRotatingSecret(null);
    }
  };

  const handleGenerateSealed = async () => {
    try {
      const res = await fetch('/api/secretops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_sealed',
          secretName: targetSecret,
          namespace: targetNamespace,
          keyValues: { api_token: 'secret_live_token_992' },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedSealedYaml(data.manifest);
      }
    } catch (err) {
      console.error('SealedSecret generation failed:', err);
    }
  };

  const handleCopy = () => {
    if (generatedSealedYaml) {
      navigator.clipboard.writeText(generatedSealedYaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-rose-500/10 text-rose-400 rounded-xl border border-rose-500/20">
            <ShieldAlert className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">SecretOps & In-Cluster Leak Sentinel</h1>
            <p className="text-sm text-slate-400">
              Audit credential hygiene, detect exposed API keys in Pod envs/ConfigMaps, and generate SealedSecrets
            </p>
          </div>
        </div>

        <button
          onClick={fetchReport}
          disabled={loading}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Scan Cluster</span>
        </button>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex justify-between items-center">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
      )}

      {/* Summary Cards */}
      {report && (
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Detected Credential Leaks</div>
            <div className={`text-2xl font-bold ${report.leaksDetected.length > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {report.leaksDetected.length} Detected
            </div>
            <div className="text-[11px] text-slate-500 mt-1">High-entropy env var scans</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Stale Secrets (&gt;90 Days)</div>
            <div className={`text-2xl font-bold ${report.staleSecretCount > 0 ? 'text-amber-400' : 'text-slate-100'}`}>
              {report.staleSecretCount} Require Rotation
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Hygiene policy violation</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">Total Monitored Secrets</div>
            <div className="text-2xl font-bold text-slate-100">{report.totalSecrets}</div>
            <div className="text-[11px] text-slate-500 mt-1">Across all namespaces</div>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
            <div className="text-xs text-slate-400 mb-1">External Secrets Operator</div>
            <div className="text-2xl font-bold text-emerald-400">Vault Connected</div>
            <div className="text-[11px] text-slate-500 mt-1">HashiCorp Vault backend sync</div>
          </div>
        </div>
      )}

      {/* Detected Leaks Sentinel Panel */}
      {report && report.leaksDetected.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            <h2 className="text-sm font-semibold text-slate-200">Exposed Secrets & Plaintext Leaks Radar</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {report.leaksDetected.map((leak) => (
              <div
                key={leak.id}
                className="bg-rose-950/20 border border-rose-500/30 rounded-xl p-5 space-y-3 flex flex-col justify-between"
              >
                <div className="space-y-2">
                  <div className="flex justify-between items-start">
                    <span className="text-xs font-bold text-rose-300">{leak.detectedType}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-500/20 text-rose-200 border border-rose-500/40">
                      {leak.targetType}
                    </span>
                  </div>

                  <div className="font-mono text-xs text-slate-200">
                    <span className="text-slate-400">{leak.workloadName}</span> ({leak.namespace})
                  </div>

                  <div className="p-2 bg-slate-950/80 rounded border border-rose-900/50 font-mono text-[11px] text-rose-300">
                    {leak.key} = {leak.maskedValue}
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">{leak.recommendation}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Secret Hygiene & Rotation Table */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Key className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-slate-200">Secret Age & Rotation Hygiene Registry</h2>
          </div>
          <span className="text-xs text-slate-500 font-mono">90-Day Maximum Age Policy</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider border-b border-slate-800 font-medium">
              <tr>
                <th className="px-4 py-3">Secret Name</th>
                <th className="px-4 py-3">Namespace</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Age (Days)</th>
                <th className="px-4 py-3">Managed By</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {report?.hygieneRecords.map((item) => {
                const isExpired = item.status === 'EXPIRED_ROTATION_NEEDED';
                return (
                  <tr key={item.secretName} className="hover:bg-slate-900/40 transition">
                    <td className="px-4 py-3 font-mono font-medium text-slate-200">{item.secretName}</td>
                    <td className="px-4 py-3 text-slate-400">{item.namespace}</td>
                    <td className="px-4 py-3 text-slate-500 font-mono text-[11px]">{item.type}</td>
                    <td className="px-4 py-3 font-mono">
                      <span className={item.ageDays > 90 ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                        {item.ageDays}d
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{item.managedBy}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                          isExpired
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        }`}
                      >
                        {isExpired ? 'Rotation Needed' : 'Healthy'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => handleRotate(item.secretName, item.namespace)}
                        disabled={rotatingSecret === item.secretName}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs rounded border border-slate-700 transition"
                      >
                        {rotatingSecret === item.secretName ? 'Rotating...' : 'Rotate'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* SealedSecrets Scaffolder */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex items-center space-x-2">
          <Lock className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-semibold text-slate-200">Bitnami SealedSecrets / GitOps Encryptor</h2>
        </div>
        <p className="text-xs text-slate-400">
          Generate asymmetric encrypted SealedSecret manifests safe to commit to public or private Git repositories.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Secret Name</label>
            <input
              type="text"
              value={targetSecret}
              onChange={(e) => setTargetSecret(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">Target Namespace</label>
            <input
              type="text"
              value={targetNamespace}
              onChange={(e) => setTargetNamespace(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 font-mono outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <button
              onClick={handleGenerateSealed}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition"
            >
              Generate SealedSecret YAML
            </button>
          </div>
        </div>

        {generatedSealedYaml && (
          <div className="mt-4 space-y-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-slate-400 font-mono">sealed-secret.yaml</span>
              <button
                onClick={handleCopy}
                className="flex items-center space-x-1 text-slate-400 hover:text-slate-200"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>
            </div>
            <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl overflow-x-auto text-emerald-300 font-mono text-xs leading-relaxed">
              {generatedSealedYaml}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
