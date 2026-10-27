'use client';

import { useState, useEffect } from 'react';
import {
  Zap,
  RefreshCw,
  Play,
  FileCode,
} from 'lucide-react';

interface WasmRuntimeInfo {
  supported: boolean;
  activeRuntimeClasses: string[];
  nodeShimInstalled: boolean;
  engineVersion: string;
}

interface WasmBenchmarkMetric {
  metric: string;
  ociContainer: string;
  wasmModule: string;
  improvementMultiplier: string;
  description: string;
}

interface WasmMicroservice {
  id: string;
  name: string;
  language: 'Rust' | 'Go' | 'AssemblyScript' | 'C/C++';
  binarySizeMb: number;
  description: string;
  ports: number[];
  sampleRequest: string;
  runtimeClass: string;
  status: 'Available' | 'Deployed' | 'Idle';
}

export default function WasmStudioPage() {
  const [runtime, setRuntime] = useState<WasmRuntimeInfo | null>(null);
  const [benchmarks, setBenchmarks] = useState<WasmBenchmarkMetric[]>([]);
  const [catalog, setCatalog] = useState<WasmMicroservice[]>([]);
  const [loading, setLoading] = useState(true);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const [deployedManifest, setDeployedManifest] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchWasmData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/wasm');
      const data = await res.json();
      setRuntime(data.runtime || null);
      setBenchmarks(data.benchmarks || []);
      setCatalog(data.catalog || []);
    } catch (err) {
      console.error('Failed to load WASM data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWasmData();
  }, []);

  const handleDeploy = async (serviceId: string) => {
    setDeployingId(serviceId);
    try {
      const res = await fetch('/api/wasm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId, namespace: 'default' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(data.message);
        setDeployedManifest(data.manifest);
        fetchWasmData();
      }
    } catch (err) {
      console.error('Deployment failed:', err);
    } finally {
      setDeployingId(null);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-violet-500/10 text-violet-400 rounded-xl border border-violet-500/20">
            <Zap className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">Cloud-Native Wasm (WebAssembly/WASI) Studio</h1>
            <p className="text-sm text-slate-400">
              Run sub-millisecond cold start microservices with 30x lighter memory footprint directly on Kubernetes
            </p>
          </div>
        </div>

        <button
          onClick={fetchWasmData}
          disabled={loading}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {actionMessage && (
        <div className="p-3 bg-violet-500/10 border border-violet-500/20 rounded-xl text-xs text-violet-300 flex justify-between items-center">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
      )}

      {/* Runtime Classes Banner */}
      {runtime && (
        <div className="p-4 bg-slate-900/60 border border-slate-800 rounded-xl flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div className="flex items-center space-x-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <div>
              <span className="text-xs font-semibold text-slate-200">Active Wasm RuntimeClasses: </span>
              <span className="text-xs font-mono text-violet-400">{runtime.activeRuntimeClasses.join(', ')}</span>
            </div>
          </div>
          <div className="text-[11px] text-slate-400 font-mono">
            Engine: {runtime.engineVersion}
          </div>
        </div>
      )}

      {/* Head-to-Head Benchmarks */}
      <div className="space-y-3">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Head-to-Head Benchmarks: Standard OCI Containers vs Wasm Modules
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {benchmarks.map((b) => (
            <div key={b.metric} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 space-y-3">
              <div className="text-xs font-medium text-slate-400">{b.metric}</div>

              <div className="space-y-1.5 font-mono">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-500">OCI Docker:</span>
                  <span className="text-slate-300">{b.ociContainer}</span>
                </div>
                <div className="flex justify-between items-center text-xs font-semibold">
                  <span className="text-violet-400">Wasm/WASI:</span>
                  <span className="text-emerald-400">{b.wasmModule}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  {b.improvementMultiplier}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 leading-relaxed">{b.description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Catalog of Wasm Microservices */}
      <div className="space-y-4">
        <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Ready-to-Deploy Wasm Cloud-Native Microservices
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {catalog.map((service) => (
            <div
              key={service.id}
              className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between space-y-4 hover:border-slate-700 transition"
            >
              <div className="space-y-3">
                <div className="flex justify-between items-start">
                  <h3 className="text-base font-bold text-slate-100">{service.name}</h3>
                  <span className="px-2 py-0.5 rounded font-mono text-[10px] font-medium bg-violet-500/10 text-violet-300 border border-violet-500/30">
                    {service.language}
                  </span>
                </div>

                <p className="text-xs text-slate-400 leading-relaxed">{service.description}</p>

                <div className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl space-y-1 font-mono text-[11px]">
                  <div className="flex justify-between text-slate-400">
                    <span>Binary Size:</span>
                    <span className="text-emerald-400 font-semibold">{service.binarySizeMb} MB</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>RuntimeClass:</span>
                    <span className="text-slate-300">{service.runtimeClass}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Port:</span>
                    <span className="text-slate-300">{service.ports.join(', ')}</span>
                  </div>
                </div>
              </div>

              <div>
                <button
                  onClick={() => handleDeploy(service.id)}
                  disabled={deployingId === service.id}
                  className="w-full flex items-center justify-center space-x-2 py-2 bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium rounded-lg transition"
                >
                  {deployingId === service.id ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  <span>Deploy to Cluster</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Generated Manifest Inspector */}
      {deployedManifest && (
        <div className="bg-slate-900/40 border border-slate-800 rounded-xl p-6 space-y-3">
          <div className="flex items-center space-x-2 text-slate-200 font-semibold text-sm">
            <FileCode className="w-4 h-4 text-violet-400" />
            <span>Deployed Wasm Kubernetes Manifest (Spec with RuntimeClass)</span>
          </div>
          <pre className="p-4 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-violet-300 leading-relaxed overflow-x-auto">
            {deployedManifest}
          </pre>
        </div>
      )}
    </div>
  );
}
