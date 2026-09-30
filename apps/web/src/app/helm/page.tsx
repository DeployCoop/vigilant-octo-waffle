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
  FolderOpen,
  Play,
  Check,
  Code,
  Terminal,
  ExternalLink,
  BookOpen,
  Sparkles,
  Sliders,
  ShieldCheck,
  Info,
} from 'lucide-react';
import { useTerminal } from '@/context/TerminalContext';

interface HelmReleaseInfo {
  name: string;
  namespace: string;
  revision: string;
  updated: string;
  status: string;
  chart: string;
  appVersion: string;
}

interface LocalChartInfo {
  id: string;
  name: string;
  version: string;
  appVersion?: string;
  description: string;
  category: string;
  chartPath: string;
  relPath: string;
  hasValues: boolean;
  hasTemplates: boolean;
  templateCount: number;
  valid: boolean;
  error?: string;
  keywords?: string[];
  home?: string;
  maintainers?: Array<{ name: string; email?: string }>;
}

export default function HelmPage() {
  const { openTerminal } = useTerminal();
  const [activeTab, setActiveTab] = useState<'local' | 'releases' | 'guide'>('local');

  // Releases state
  const [releases, setReleases] = useState<HelmReleaseInfo[]>([]);
  const [selectedRelease, setSelectedRelease] = useState<HelmReleaseInfo | null>(null);
  const [releaseValues, setReleaseValues] = useState<string>('');
  const [loadingValues, setLoadingValues] = useState(false);

  // Local Charts state
  const [localCharts, setLocalCharts] = useState<LocalChartInfo[]>([]);
  const [chartsDir, setChartsDir] = useState<string>('./charts');
  const [chartsDirInput, setChartsDirInput] = useState<string>('');
  const [dirExists, setDirExists] = useState<boolean>(true);
  const [updatingDir, setUpdatingDir] = useState<boolean>(false);
  const [scaffolding, setScaffolding] = useState<boolean>(false);

  // Modals & Action States
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Modal: Install/Upgrade
  const [installModalChart, setInstallModalChart] = useState<LocalChartInfo | null>(null);
  const [installReleaseName, setInstallReleaseName] = useState('');
  const [installNamespace, setInstallNamespace] = useState('default');
  const [installValues, setInstallValues] = useState('');
  const [installing, setInstalling] = useState(false);

  // Modal: Lint or Template Viewer
  const [viewerModal, setViewerModal] = useState<{
    title: string;
    content: string;
    chartName: string;
    type: 'lint' | 'template' | 'values';
    valid?: boolean;
  } | null>(null);
  const [loadingViewer, setLoadingViewer] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/helm');
      const data = await res.json();
      setReleases(data.releases || []);
      setLocalCharts(data.localCharts || []);
      if (data.chartsDir) {
        setChartsDir(data.chartsDir);
        if (!chartsDirInput) {
          setChartsDirInput(data.chartsDir);
        }
      }
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleUpdateChartsDir = async () => {
    if (!chartsDirInput.trim()) return;
    setUpdatingDir(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/helm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-charts-dir',
          chartsDir: chartsDirInput.trim(),
          createIfNotExists: true,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setChartsDir(data.chartsDir);
        setDirExists(data.exists);
        setActionMessage(`Updated charts directory to: ${data.chartsDir} (${data.chartCount} charts found)`);
        fetchData();
      } else {
        setActionMessage(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setActionMessage(`Failed to update charts directory: ${err.message}`);
    } finally {
      setUpdatingDir(false);
    }
  };

  const handleScaffoldExample = async () => {
    setScaffolding(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/helm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scaffold-example' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage('Populated example "sample-app" into charts directory!');
        fetchData();
      } else {
        setActionMessage(`Error: ${data.error}`);
      }
    } catch (err: any) {
      setActionMessage(`Scaffold failed: ${err.message}`);
    } finally {
      setScaffolding(false);
    }
  };

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

  const openInstallModal = async (chart: LocalChartInfo) => {
    setInstallModalChart(chart);
    setInstallReleaseName(chart.id);
    setInstallNamespace('default');
    setInstallValues('');

    // Fetch default values to prepopulate textarea
    try {
      const res = await fetch(`/api/helm?chartId=${encodeURIComponent(chart.id)}`);
      const data = await res.json();
      if (data.chart?.rawValuesYaml) {
        setInstallValues(data.chart.rawValuesYaml);
      }
    } catch {}
  };

  const handleDeployChart = async () => {
    if (!installModalChart) return;
    setInstalling(true);
    try {
      const res = await fetch('/api/helm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'install',
          chartId: installModalChart.id,
          releaseName: installReleaseName.trim() || installModalChart.id,
          namespace: installNamespace.trim() || 'default',
          valuesYaml: installValues || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(`Initiated Helm deployment for ${installModalChart.name} (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, `Helm Install: ${installModalChart.name}`);
        }
        setInstallModalChart(null);
      } else {
        setActionMessage(`Deployment error: ${data.error}`);
      }
    } catch (err: any) {
      setActionMessage(`Deploy failed: ${err.message}`);
    } finally {
      setInstalling(false);
    }
  };

  const handleLintChart = async (chart: LocalChartInfo) => {
    setLoadingViewer(true);
    try {
      const res = await fetch('/api/helm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lint', chartId: chart.id }),
      });
      const data = await res.json();
      setViewerModal({
        title: `Helm Lint Results: ${chart.name}`,
        chartName: chart.name,
        type: 'lint',
        valid: data.valid,
        content: data.output || (data.valid ? 'Lint passed with 0 errors.' : 'Lint failed.'),
      });
    } catch (err: any) {
      setViewerModal({
        title: `Helm Lint Error: ${chart.name}`,
        chartName: chart.name,
        type: 'lint',
        valid: false,
        content: err.message,
      });
    } finally {
      setLoadingViewer(false);
    }
  };

  const handleTemplateChart = async (chart: LocalChartInfo) => {
    setLoadingViewer(true);
    try {
      const res = await fetch('/api/helm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'template', chartId: chart.id }),
      });
      const data = await res.json();
      setViewerModal({
        title: `Helm Template Preview: ${chart.name}`,
        chartName: chart.name,
        type: 'template',
        content: data.template || '# No templates rendered',
      });
    } catch (err: any) {
      setViewerModal({
        title: `Template Error: ${chart.name}`,
        chartName: chart.name,
        type: 'template',
        content: `# Render failed: ${err.message}`,
      });
    } finally {
      setLoadingViewer(false);
    }
  };

  const handleViewValues = async (chart: LocalChartInfo) => {
    setLoadingViewer(true);
    try {
      const res = await fetch(`/api/helm?chartId=${encodeURIComponent(chart.id)}`);
      const data = await res.json();
      setViewerModal({
        title: `Default values.yaml: ${chart.name}`,
        chartName: chart.name,
        type: 'values',
        content: data.chart?.rawValuesYaml || '# No values.yaml found in chart',
      });
    } catch (err: any) {
      setViewerModal({
        title: `Values Error: ${chart.name}`,
        chartName: chart.name,
        type: 'values',
        content: err.message,
      });
    } finally {
      setLoadingViewer(false);
    }
  };

  const filteredLocalCharts = localCharts.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.id.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.keywords?.some((k) => k.toLowerCase().includes(q))
    );
  });

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
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Ship className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Helm Release Inspector & Local Charts Hub</h2>
          </div>
          <p className="text-sm text-slate-400">
            Discover and deploy custom Helm charts from any local directory, inspect in-cluster releases, and dry-run templates
          </p>
        </div>

        <button
          onClick={fetchData}
          disabled={loading}
          className="text-xs px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg flex items-center space-x-2 self-start md:self-auto transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh All</span>
        </button>
      </div>

      {actionMessage && (
        <div className="p-4 bg-sky-950/40 border border-sky-800/60 rounded-xl flex items-center justify-between text-sm text-sky-300 animate-fadeIn">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-sky-400" />
            <span>{actionMessage}</span>
          </div>
          <button onClick={() => setActionMessage(null)} className="text-sky-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-slate-800 space-x-8 text-sm font-medium">
        <button
          onClick={() => setActiveTab('local')}
          className={`pb-3 flex items-center space-x-2 transition-colors border-b-2 ${
            activeTab === 'local'
              ? 'border-sky-500 text-sky-400 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FolderOpen className="w-4 h-4" />
          <span>Local Charts Directory</span>
          <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-slate-800 text-slate-300">
            {localCharts.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('releases')}
          className={`pb-3 flex items-center space-x-2 transition-colors border-b-2 ${
            activeTab === 'releases'
              ? 'border-sky-500 text-sky-400 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Ship className="w-4 h-4" />
          <span>In-Cluster Releases</span>
          <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-slate-800 text-slate-300">
            {releases.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('guide')}
          className={`pb-3 flex items-center space-x-2 transition-colors border-b-2 ${
            activeTab === 'guide'
              ? 'border-sky-500 text-sky-400 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <BookOpen className="w-4 h-4" />
          <span>Directory Setup Guide</span>
        </button>
      </div>

      {/* TAB 1: LOCAL CHARTS DIRECTORY */}
      {activeTab === 'local' && (
        <div className="space-y-6">
          {/* Charts Directory Path Configuration Box */}
          <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-slate-200 flex items-center space-x-2">
                  <Sliders className="w-4 h-4 text-sky-400" />
                  <span>Configured Charts Directory</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Point Vigilant Octo Waffle to any directory containing Helm charts. Relative paths resolve from project root.
                </p>
              </div>

              <div className="flex items-center space-x-2 text-xs">
                <span className="text-slate-400">Current active path:</span>
                <code className="px-2 py-0.5 bg-slate-950 text-sky-300 border border-slate-800 rounded font-mono">
                  {chartsDir}
                </code>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <input
                type="text"
                value={chartsDirInput}
                onChange={(e) => setChartsDirInput(e.target.value)}
                placeholder="./charts or /opt/my-helm-charts"
                className="flex-1 px-3.5 py-2 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono placeholder-slate-600 focus:outline-none focus:border-sky-500"
              />
              <button
                onClick={handleUpdateChartsDir}
                disabled={updatingDir || !chartsDirInput.trim()}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-medium rounded-lg flex items-center justify-center space-x-2 transition-colors shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{updatingDir ? 'Saving...' : 'Apply Directory'}</span>
              </button>

              <button
                onClick={() => {
                  setChartsDirInput('./charts');
                }}
                className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors shrink-0"
                title="Reset to default ./charts"
              >
                Reset Default
              </button>

              <button
                onClick={handleScaffoldExample}
                disabled={scaffolding}
                className="px-4 py-2 bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-medium rounded-lg flex items-center justify-center space-x-2 transition-colors shrink-0"
                title="Copies sample-app into the active charts directory"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>{scaffolding ? 'Copying...' : 'Populate Example Chart'}</span>
              </button>
            </div>
          </div>

          {/* Search bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search local charts by name, keyword, or description..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>

          {/* Charts Grid */}
          {filteredLocalCharts.length === 0 ? (
            <div className="p-12 text-center bg-slate-900 border border-slate-800 rounded-xl space-y-4">
              <FolderOpen className="w-12 h-12 text-slate-600 mx-auto" />
              <div className="space-y-1">
                <h4 className="text-base font-semibold text-slate-300">No Helm Charts Found in Directory</h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  No charts with a valid <code className="text-slate-400">Chart.yaml</code> were detected in{' '}
                  <code className="text-slate-400">{chartsDir}</code>. Click below to populate a sample microservice chart or see the guide.
                </p>
              </div>
              <div className="flex items-center justify-center space-x-3 pt-2">
                <button
                  onClick={handleScaffoldExample}
                  disabled={scaffolding}
                  className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg flex items-center space-x-2 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Populate Example Chart</span>
                </button>
                <button
                  onClick={() => setActiveTab('guide')}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors"
                >
                  Read Setup Guide
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredLocalCharts.map((chart) => (
                <div
                  key={chart.id}
                  className="p-5 bg-slate-900 border border-slate-800 rounded-xl flex flex-col justify-between hover:border-slate-700 transition-all space-y-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center space-x-2">
                          <h4 className="text-base font-bold text-slate-100">{chart.name}</h4>
                          <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-sky-950 text-sky-400 border border-sky-800/40 rounded">
                            v{chart.version}
                          </span>
                        </div>
                        {chart.appVersion && (
                          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                            App Version: {chart.appVersion}
                          </div>
                        )}
                      </div>

                      {chart.valid ? (
                        <span className="px-2 py-0.5 text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full flex items-center space-x-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Valid Chart</span>
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-[10px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full flex items-center space-x-1">
                          <AlertCircle className="w-3 h-3" />
                          <span>Invalid</span>
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">
                      {chart.description}
                    </p>

                    {/* Metadata Badges */}
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-950 text-slate-400 border border-slate-800 rounded">
                        {chart.templateCount} {chart.templateCount === 1 ? 'template' : 'templates'}
                      </span>
                      {chart.hasValues && (
                        <span className="text-[10px] font-mono px-2 py-0.5 bg-slate-950 text-slate-400 border border-slate-800 rounded">
                          values.yaml
                        </span>
                      )}
                      {chart.keywords?.slice(0, 3).map((kw) => (
                        <span
                          key={kw}
                          className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded"
                        >
                          #{kw}
                        </span>
                      ))}
                    </div>

                    <div className="text-[10px] font-mono text-slate-500 truncate" title={chart.chartPath}>
                      📁 {chart.relPath}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <div className="flex items-center space-x-1">
                      <button
                        onClick={() => handleViewValues(chart)}
                        className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded transition-colors text-xs"
                        title="View default values.yaml"
                      >
                        <FileCode className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleLintChart(chart)}
                        className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded transition-colors text-xs"
                        title="Run helm lint"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleTemplateChart(chart)}
                        className="p-1.5 text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded transition-colors text-xs"
                        title="Preview helm template"
                      >
                        <Code className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      onClick={() => openInstallModal(chart)}
                      className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg flex items-center space-x-1.5 transition-colors"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Deploy / Install</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: IN-CLUSTER RELEASES */}
      {activeTab === 'releases' && (
        <div className="space-y-6">
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
                <tbody className="divide-y divide-slate-800/60">
                  {filteredReleases.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-slate-500">
                        {loading ? 'Querying Helm releases in cluster...' : 'No Helm releases detected in current cluster'}
                      </td>
                    </tr>
                  ) : (
                    filteredReleases.map((r) => (
                      <tr key={`${r.namespace}-${r.name}`} className="hover:bg-slate-800/30 transition-colors">
                        <td className="px-5 py-3 font-mono font-medium text-slate-100">{r.name}</td>
                        <td className="px-5 py-3">
                          <span className="px-2 py-0.5 text-xs font-mono bg-slate-800 text-slate-300 rounded">
                            {r.namespace}
                          </span>
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-slate-400">rev {r.revision}</td>
                        <td className="px-5 py-3 font-mono text-xs text-sky-400">{r.chart}</td>
                        <td className="px-5 py-3 text-xs text-slate-400">{r.appVersion || '-'}</td>
                        <td className="px-5 py-3">
                          <span
                            className={`px-2 py-0.5 text-[10px] font-semibold uppercase rounded-full ${
                              r.status === 'deployed'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => inspectValues(r)}
                            className="text-xs px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 flex items-center space-x-1.5 ml-auto transition-colors"
                          >
                            <FileCode className="w-3.5 h-3.5" />
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
        </div>
      )}

      {/* TAB 3: DIRECTORY SETUP GUIDE */}
      {activeTab === 'guide' && (
        <div className="space-y-6 max-w-4xl">
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-xl space-y-4">
            <h3 className="text-base font-bold text-white flex items-center space-x-2">
              <BookOpen className="w-5 h-5 text-sky-400" />
              <span>How to Populate Your Own Charts Directory</span>
            </h3>

            <p className="text-sm text-slate-300 leading-relaxed">
              Vigilant Octo Waffle allows anyone to bring their own collection of Helm charts. Simply place each chart in its own folder under the charts directory (configurable via <code className="text-sky-300 bg-slate-950 px-1.5 py-0.5 rounded font-mono">THIS_CHARTS_DIR</code> in <code className="text-sky-300 bg-slate-950 px-1.5 py-0.5 rounded font-mono">.env</code> or via the input box above).
            </p>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Required Directory Layout</h4>
              <pre className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 overflow-x-auto">
{`charts/ (or whatever path you set)
├── my-service/                 # Folder name or Chart.yaml name
│   ├── Chart.yaml              # REQUIRED: Chart metadata (name, version, description)
│   ├── values.yaml             # REQUIRED: Default configuration values
│   ├── templates/              # REQUIRED: Kubernetes manifest templates
│   │   ├── _helpers.tpl        # Template helpers (name, labels, selectors)
│   │   ├── deployment.yaml     # Workload deployment
│   │   ├── service.yaml        # Service definition
│   │   └── ingress.yaml        # Ingress route with TLS
│   └── README.md               # Optional: Chart documentation
└── another-app/
    ├── Chart.yaml
    └── ...`}
              </pre>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Minimal `Chart.yaml` Example</h4>
              <pre className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 overflow-x-auto">
{`apiVersion: v2
name: my-service
version: 1.0.0
appVersion: "1.0.0"
description: "My custom microservice running on Vigilant Octo Waffle"
type: application
keywords:
  - web
  - api
maintainers:
  - name: "Your Name"
    email: "you@example.com"`}
              </pre>
            </div>

            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Available Example Directories</h4>
              <p className="text-xs text-slate-400">
                You can inspect or copy from the included reference directory in this repository:
              </p>
              <ul className="list-disc list-inside text-xs text-slate-300 space-y-1 font-mono">
                <li><code className="text-sky-300">example.charts/sample-app</code> - Full NGINX microservice with health probes and TLS</li>
                <li><code className="text-sky-300">example.charts/static-site</code> - Static documentation site with ConfigMap mount</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Install Local Chart */}
      {installModalChart && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full p-6 space-y-5 shadow-2xl animate-scaleUp">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                <Play className="w-5 h-5 text-sky-400" />
                <h3 className="text-base font-bold text-white">
                  Deploy Local Chart: {installModalChart.name} (v{installModalChart.version})
                </h3>
              </div>
              <button onClick={() => setInstallModalChart(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Release Name</label>
                  <input
                    type="text"
                    value={installReleaseName}
                    onChange={(e) => setInstallReleaseName(e.target.value)}
                    placeholder={installModalChart.id}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Target Namespace</label>
                  <input
                    type="text"
                    value={installNamespace}
                    onChange={(e) => setInstallNamespace(e.target.value)}
                    placeholder="default"
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-lg text-sm text-slate-100 font-mono focus:outline-none focus:border-sky-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-300">Values Configuration (values.yaml)</label>
                  <span className="text-[10px] text-slate-500">Edit or override values before deployment</span>
                </div>
                <textarea
                  rows={10}
                  value={installValues}
                  onChange={(e) => setInstallValues(e.target.value)}
                  className="w-full p-3 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-800">
              <button
                onClick={() => setInstallModalChart(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeployChart}
                disabled={installing}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium rounded-lg flex items-center space-x-2 transition-colors disabled:opacity-50"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{installing ? 'Deploying...' : 'Install Release'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Lint, Template, or Values Viewer */}
      {viewerModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-4xl w-full p-6 space-y-4 shadow-2xl flex flex-col max-h-[85vh] animate-scaleUp">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-2">
                {viewerModal.type === 'lint' && (
                  viewerModal.valid ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-rose-400" />
                  )
                )}
                {viewerModal.type === 'template' && <Code className="w-5 h-5 text-sky-400" />}
                {viewerModal.type === 'values' && <FileCode className="w-5 h-5 text-amber-400" />}
                <h3 className="text-base font-bold text-white">{viewerModal.title}</h3>
              </div>
              <button onClick={() => setViewerModal(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-slate-950 p-4 border border-slate-800 rounded-lg">
              <pre className="text-xs font-mono text-slate-200 whitespace-pre overflow-x-auto">
                {viewerModal.content}
              </pre>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setViewerModal(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: In-Cluster Release Values Inspection */}
      {selectedRelease && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-3xl w-full p-6 space-y-4 shadow-2xl flex flex-col max-h-[85vh] animate-scaleUp">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="space-y-0.5">
                <h3 className="text-base font-bold text-white">Applied Values: {selectedRelease.name}</h3>
                <p className="text-xs text-slate-400 font-mono">
                  Namespace: {selectedRelease.namespace} | Chart: {selectedRelease.chart} (rev {selectedRelease.revision})
                </p>
              </div>
              <button onClick={() => setSelectedRelease(null)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-slate-950 p-4 border border-slate-800 rounded-lg">
              {loadingValues ? (
                <div className="text-center py-12 text-slate-500 font-mono text-xs flex items-center justify-center space-x-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                  <span>Retrieving release values from cluster...</span>
                </div>
              ) : (
                <pre className="text-xs font-mono text-slate-200 whitespace-pre overflow-x-auto">
                  {releaseValues}
                </pre>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedRelease(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
