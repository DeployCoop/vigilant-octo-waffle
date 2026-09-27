'use client';

import { useState, useEffect } from 'react';
import {
  Ship,
  RefreshCw,
  Search,
  FileCode,
  CheckCircle2,
  AlertCircle,
  X,
  Layers,
} from 'lucide-react';

interface HelmReleaseInfo {
  name: string;
  namespace: string;
  revision: string;
  updated: string;
  status: string;
  chart: string;
  appVersion: string;
}

export default function HelmPage() {
  const [releases, setReleases] = useState<HelmReleaseInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedRelease, setSelectedRelease] = useState<HelmReleaseInfo | null>(null);
  const [releaseValues, setReleaseValues] = useState<string>('');
  const [loadingValues, setLoadingValues] = useState(false);

  const fetchReleases = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/helm');
      const data = await res.json();
      setReleases(data.releases || []);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReleases();
  }, []);

  const inspectValues = async (rel: HelmReleaseInfo) => {
    setSelectedRelease(rel);
    setLoadingValues(true);
    try {
      const res = await fetch(`/api/helm?release=${encodeURIComponent(rel.name)}&namespace=${encodeURIComponent(rel.namespace)}`);
      const data = await res.json();
      setReleaseValues(data.values || '# No values found or values inspection not available');
    } catch (err: any) {
      setReleaseValues(`# Error retrieving values: ${err.message}`);
    } finally {
      setLoadingValues(false);
    }
  };

  const filteredReleases = releases.filter((r) => {
    const q = search.toLowerCase();
    return (
      r.name.toLowerCase().includes(q) ||
      r.namespace.toLowerCase().includes(q) ||
      r.chart.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Ship className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Helm Release Inspector</h2>
          </div>
          <p className="text-sm text-slate-400">
            Discover in-cluster Helm chart releases managed under ArgoCD, revision history, and applied values
          </p>
        </div>

        <button
          onClick={fetchReleases}
          disabled={loading}
          className="text-xs px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg flex items-center space-x-2 self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Releases</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
        <input
          type="text"
          placeholder="Search releases, namespaces, or chart names..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
        />
      </div>

      {/* Releases Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-300">
            <thead className="bg-slate-950/60 text-xs uppercase text-slate-400 border-b border-slate-800">
              <tr>
                <th className="px-5 py-3 font-semibold">Release Name</th>
                <th className="px-5 py-3 font-semibold">Namespace</th>
                <th className="px-5 py-3 font-semibold">Revision</th>
                <th className="px-5 py-3 font-semibold">Chart</th>
                <th className="px-5 py-3 font-semibold">App Version</th>
                <th className="px-5 py-3 font-semibold">Status</th>
                <th className="px-5 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
              {filteredReleases.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                    {loading ? 'Discovering Helm releases...' : 'No Helm releases found.'}
                  </td>
                </tr>
              ) : (
                filteredReleases.map((rel) => (
                  <tr key={`${rel.namespace}/${rel.name}`} className="hover:bg-slate-800/40">
                    <td className="px-5 py-3.5 font-bold text-slate-200">{rel.name}</td>
                    <td className="px-5 py-3.5 text-slate-400">
                      <span className="bg-slate-800 px-2 py-0.5 rounded text-[11px]">{rel.namespace}</span>
                    </td>
                    <td className="px-5 py-3.5 text-sky-400">v{rel.revision}</td>
                    <td className="px-5 py-3.5 text-slate-300 truncate max-w-xs">{rel.chart}</td>
                    <td className="px-5 py-3.5 text-slate-400">{rel.appVersion || '-'}</td>
                    <td className="px-5 py-3.5">
                      <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 px-2 py-0.5 rounded font-sans text-[11px] font-semibold">
                        {rel.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-sans">
                      <button
                        onClick={() => inspectValues(rel)}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-sky-600 hover:text-white text-slate-300 border border-slate-700 rounded transition-colors text-xs inline-flex items-center space-x-1"
                      >
                        <FileCode className="w-3 h-3" />
                        <span>Values</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Values Modal */}
      {selectedRelease && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-950 border border-slate-800 rounded-xl w-full max-w-4xl h-[75vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white font-mono">{selectedRelease.name}</h3>
                <p className="text-xs text-slate-400">
                  Namespace: {selectedRelease.namespace} · Chart: {selectedRelease.chart} (Rev {selectedRelease.revision})
                </p>
              </div>

              <button
                onClick={() => setSelectedRelease(null)}
                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded border border-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 p-4 bg-black overflow-auto font-mono text-xs text-slate-300 leading-relaxed whitespace-pre select-text">
              {loadingValues ? (
                <div className="flex items-center space-x-2 text-slate-500">
                  <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                  <span>Loading Helm release values...</span>
                </div>
              ) : (
                releaseValues
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
