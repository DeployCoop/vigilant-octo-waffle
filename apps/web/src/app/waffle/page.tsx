'use client';

import {
  Play,
  FolderOpen,
  Clock,
  StopCircle,
  Plus,
  RefreshCw,
  BookOpen,
  Cpu,
  Boxes,
  Zap,
  Hammer,
} from 'lucide-react';

import { useWafflePage } from './useWafflePage';
import CanvasTab from './components/CanvasTab';
import SourcesTab from './components/SourcesTab';
import BlueprintsTab from './components/BlueprintsTab';
import HistoryTab from './components/HistoryTab';
import DocsTab from './components/DocsTab';
import RunTerminal from './components/RunTerminal';
import CelebrationModal from './components/CelebrationModal';
import AddSourceModal from './components/AddSourceModal';

export default function WaffleStudioPage() {
  const s = useWafflePage();
  const {
    activeTab,
    setActiveTab,
    sources,
    blueprints,
    selectedSourceId,
    setSelectedSourceId,
    selectedBlueprintId,
    setSelectedBlueprintId,
    currentPipeline,
    activeRun,
    runHistory,
    loading,
    executing,
    showAddModal,
    setShowAddModal,
    showCelebration,
    canvasRef,
    fetchData,
    loadSourcePipeline,
    loadBlueprintPipeline,
    handleRunPipeline,
    handleBuildImages,
    handleAbort,
    activeRunProgressPct,
  } = s;
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col relative pb-32">
      {/* Particle Canvas Overlay for Victory Celebration */}
      <canvas
        ref={canvasRef}
        className={`fixed inset-0 pointer-events-none z-50 transition-opacity duration-500 ${
          showCelebration ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Top Banner / Hero Header */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-30 px-6 py-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 via-sky-500 to-indigo-500 p-0.5 shadow-lg shadow-cyan-500/20 flex items-center justify-center">
              <span className="text-2xl">🧇</span>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
                  Waffle Meta-Package Studio
                  <span className="text-xs px-2 py-0.5 rounded-full font-mono bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
                    waffle.dev/v1
                  </span>
                </h1>
              </div>
              <p className="text-xs text-slate-400">
                Autonomous multi-stage datacenter deployment runner & OpenEBS LocalPV storage fabric
              </p>
            </div>
          </div>

          {/* Quick Action Controls */}
          <div className="flex items-center space-x-3">
            <button
              onClick={() => handleRunPipeline(false)}
              disabled={executing || !currentPipeline}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-xs font-semibold shadow-md transition-all ${
                executing
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white shadow-cyan-500/20'
              }`}
            >
              <Play className="w-4 h-4 fill-current" />
              <span>{executing ? 'Waffle Running...' : 'Deploy Waffle'}</span>
            </button>

            <button
              onClick={() => handleRunPipeline(true)}
              disabled={executing || !currentPipeline}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-purple-500/40 bg-purple-950/30 hover:bg-purple-900/40 text-purple-300 transition-colors"
            >
              <Cpu className="w-3.5 h-3.5" />
              <span>Simulate (Dry-Run)</span>
            </button>

            <button
              onClick={() => handleBuildImages(false)}
              disabled={executing || !currentPipeline?.builds?.targets?.length}
              title={
                !currentPipeline?.builds?.targets?.length
                  ? 'No build targets configured in this pipeline'
                  : `Rebuild all ${currentPipeline.builds.targets.length} container images`
              }
              className={`flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                !currentPipeline?.builds?.targets?.length || executing
                  ? 'border-slate-800 bg-slate-900 text-slate-600 cursor-not-allowed'
                  : 'border-amber-500/40 bg-amber-950/30 hover:bg-amber-900/40 text-amber-300'
              }`}
            >
              <Hammer className="w-3.5 h-3.5" />
              <span>
                Rebuild Images{currentPipeline?.builds?.targets?.length ? ` (${currentPipeline.builds.targets.length})` : ''}
              </span>
            </button>

            {executing && (
              <button
                onClick={handleAbort}
                className="flex items-center space-x-1 px-3 py-2 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all animate-pulse"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>Abort</span>
              </button>
            )}

            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              <span>Track Target</span>
            </button>

            <button
              onClick={fetchData}
              title="Refresh Sources"
              className="p-2 rounded-lg border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Global Progress Bar (if executing) */}
        {activeRun && activeRun.status === 'running' && (
          <div className="max-w-7xl mx-auto mt-4 pt-3 border-t border-slate-800/60">
            <div className="flex items-center justify-between text-xs mb-1.5 font-mono">
              <span className="text-cyan-300 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping inline-block" />
                Executing: <strong className="text-white">{activeRun.pipelineName}</strong>
              </span>
              <span className="text-slate-400">
                {activeRun.completedSteps} of {activeRun.totalSteps} steps completed ({activeRunProgressPct}%)
              </span>
            </div>
            <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-cyan-500 via-sky-400 to-indigo-500 transition-all duration-300"
                style={{ width: `${activeRunProgressPct}%` }}
              />
            </div>
          </div>
        )}
      </header>

      {/* Main Studio Viewport */}
      <main className="max-w-7xl mx-auto px-6 py-6 w-full flex-1">
        {/* Navigation Tabs & Target Switcher */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-800 pb-3">
          <div className="flex items-center space-x-1 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('canvas')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'canvas'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Pipeline Canvas</span>
            </button>

            <button
              onClick={() => setActiveTab('sources')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'sources'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>Tracked Targets ({sources.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('blueprints')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'blueprints'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Boxes className="w-3.5 h-3.5" />
              <span>Blueprints ({blueprints.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'history'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Run History ({runHistory.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('docs')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 ${
                activeTab === 'docs'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Documentation</span>
            </button>
          </div>

          {/* Active Target Dropdown Switcher */}
          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400">Target:</span>
            <select
              value={selectedSourceId ? `source:${selectedSourceId}` : `bp:${selectedBlueprintId}`}
              onChange={(e) => {
                const val = e.target.value;
                if (val.startsWith('source:')) {
                  const id = val.replace('source:', '');
                  setSelectedSourceId(id);
                  setSelectedBlueprintId('');
                  loadSourcePipeline(id);
                } else if (val.startsWith('bp:')) {
                  const id = val.replace('bp:', '');
                  setSelectedBlueprintId(id);
                  setSelectedSourceId('');
                  loadBlueprintPipeline(id);
                }
              }}
              className="bg-slate-900 border border-slate-700 text-xs text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-cyan-500"
            >
              <optgroup label="Tracked Targets">
                {sources.map((s) => (
                  <option key={s.id} value={`source:${s.id}`}>
                    {s.name} ({s.chartCount} charts)
                  </option>
                ))}
              </optgroup>
              <optgroup label="Default Blueprints">
                {blueprints.map((b) => (
                  <option key={b.id} value={`bp:${b.id}`}>
                    {b.name} ({b.stepsCount} steps)
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
        </div>

        {/* TAB 1: PIPELINE CANVAS */}
        {activeTab === 'canvas' && <CanvasTab s={s} />}

        {/* TAB 2: TRACKED SOURCES */}
        {activeTab === 'sources' && <SourcesTab s={s} />}

        {/* TAB 3: COMMUNITY BLUEPRINTS */}
        {activeTab === 'blueprints' && <BlueprintsTab s={s} />}

        {/* TAB 4: RUN HISTORY */}
        {activeTab === 'history' && <HistoryTab s={s} />}

        {/* TAB 5: DOCUMENTATION */}
        {activeTab === 'docs' && <DocsTab s={s} />}
      </main>

      <RunTerminal s={s} />

      {/* Victory Celebration Modal */}
      {showCelebration && <CelebrationModal s={s} />}

      {/* Add Target Modal */}
      {showAddModal && <AddSourceModal s={s} />}
    </div>
  );
}
