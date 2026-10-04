'use client';

import { useState } from 'react';
import {
  Cloud,
  FileCode,
  Copy,
  Check,
  Download,
  Server,
  Layers,
  Sparkles,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';
import { apiErrorMessage } from '@/lib/envelope';

interface BlueprintFile {
  filename: string;
  content: string;
  description: string;
}

interface BlueprintResponse {
  provider: 'aws' | 'gcp' | 'azure';
  clusterName: string;
  region: string;
  files: BlueprintFile[];
  summary: string;
}

export default function CloudExportPage() {
  const [targetProvider, setTargetProvider] = useState<'aws' | 'gcp' | 'azure'>('aws');
  const [clusterName, setClusterName] = useState('vigilant-octo-cloud');
  const [region, setRegion] = useState('us-east-1');
  const [nodeCount, setNodeCount] = useState<number>(3);
  const [domain, setDomain] = useState('example.com');

  const [loading, setLoading] = useState(false);
  const [blueprint, setBlueprint] = useState<BlueprintResponse | null>(null);
  const [selectedFileIdx, setSelectedFileIdx] = useState(0);
  const [copied, setCopied] = useState(false);

  const handleProviderSelect = (p: 'aws' | 'gcp' | 'azure') => {
    setTargetProvider(p);
    if (p === 'aws') setRegion('us-east-1');
    if (p === 'gcp') setRegion('us-central1');
    if (p === 'azure') setRegion('eastus');
  };

  const handleGenerate = async () => {
    setLoading(true);
    setCopied(false);
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetProvider,
          clusterName,
          region,
          nodeCount,
          domain,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(data));
      setBlueprint(data.blueprint);
      setSelectedFileIdx(0);
    } catch (err) {
      console.error('Failed to generate blueprint:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!blueprint) return;
    const currentCode = blueprint.files[selectedFileIdx]?.content || '';
    await copyToClipboard(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadAll = () => {
    if (!blueprint) return;
    const combined = blueprint.files
      .map((f) => `### FILE: ${f.filename}\n### ${f.description}\n\n${f.content}\n\n`)
      .join('\n');
    const blob = new Blob([combined], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${blueprint.clusterName}-${blueprint.provider}-terraform.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-3">
            <Cloud className="w-6 h-6 text-sky-400" />
            <span>Production Cloud Blueprint Exporter</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Export your local cluster configuration into turnkey Terraform / OpenTofu HCL code for AWS EKS, GCP GKE, or Azure AKS.
          </p>
        </div>
      </div>

      {/* Configuration Form */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-6">
        <div>
          <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-3">
            Select Cloud Target
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { id: 'aws', name: 'Amazon Web Services', desc: 'AWS EKS + VPC + Managed Node Groups', badge: 'EKS' },
              { id: 'gcp', name: 'Google Cloud Platform', desc: 'Google Kubernetes Engine + VPC Native', badge: 'GKE' },
              { id: 'azure', name: 'Microsoft Azure', desc: 'Azure Kubernetes Service (AKS) + Azure CNI', badge: 'AKS' },
            ].map((prov) => (
              <button
                key={prov.id}
                type="button"
                onClick={() => handleProviderSelect(prov.id as any)}
                className={`p-4 rounded-xl border text-left transition relative cursor-pointer ${
                  targetProvider === prov.id
                    ? 'bg-sky-500/10 border-sky-500/50 text-slate-100 shadow-sm'
                    : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{prov.name}</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-sky-400">
                    {prov.badge}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-1.5">{prov.desc}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Cluster Name</label>
            <input
              type="text"
              value={clusterName}
              onChange={(e) => setClusterName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Target Region</label>
            <input
              type="text"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Worker Node Count</label>
            <input
              type="number"
              min={1}
              max={50}
              value={nodeCount}
              onChange={(e) => setNodeCount(parseInt(e.target.value) || 1)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1.5">Domain Name</label>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="flex items-center space-x-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 text-white px-5 py-2.5 rounded-lg text-xs font-semibold transition shadow-sm cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>{loading ? 'Synthesizing Blueprint...' : 'Generate Terraform / OpenTofu HCL'}</span>
          </button>
        </div>
      </div>

      {/* Blueprint Preview */}
      {blueprint && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <h2 className="text-sm font-semibold text-slate-200 flex items-center space-x-2">
                <FileCode className="w-4 h-4 text-sky-400" />
                <span>Generated Infrastructure Code ({blueprint.provider.toUpperCase()})</span>
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">{blueprint.summary}</p>
            </div>

            <div className="flex items-center space-x-2">
              <button
                onClick={handleCopy}
                className="flex items-center space-x-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1.5 rounded-lg text-xs transition cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Copied!' : 'Copy Code'}</span>
              </button>

              <button
                onClick={handleDownloadAll}
                className="flex items-center space-x-1.5 bg-sky-600 hover:bg-sky-500 text-white px-3 py-1.5 rounded-lg text-xs transition cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download All Files</span>
              </button>
            </div>
          </div>

          {/* File Tabs */}
          <div className="flex border-b border-slate-800 space-x-2 overflow-x-auto pb-1">
            {blueprint.files.map((file, idx) => (
              <button
                key={file.filename}
                onClick={() => setSelectedFileIdx(idx)}
                className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-t-md text-xs font-mono transition cursor-pointer ${
                  selectedFileIdx === idx
                    ? 'bg-slate-950 text-sky-400 border-t-2 border-sky-500 font-semibold'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <span>{file.filename}</span>
              </button>
            ))}
          </div>

          {/* Code Viewer */}
          <div className="relative bg-slate-950 rounded-xl p-4 border border-slate-800/80 overflow-x-auto">
            <pre className="font-mono text-xs text-slate-300 leading-relaxed">
              {blueprint.files[selectedFileIdx]?.content}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
