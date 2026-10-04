'use client';

import {
  RotateCw,
  FolderOpen,
  GitBranch,
  Plus,
  Trash2,
  ArrowRight,
} from 'lucide-react';

import type { WafflePageState } from '../useWafflePage';

export default function SourcesTab({ s }: { s: WafflePageState }) {
  const {
    setActiveTab,
    sources,
    setSelectedSourceId,
    setSelectedBlueprintId,
    setShowAddModal,
    loadSourcePipeline,
    handleSyncSource,
    handleRemoveSource,
  } = s;
  return (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">Tracked Waffle Targets</h3>
                <p className="text-xs text-slate-400">
                  Supervise local folders and remote Git URLs containing waffle.yaml pipelines
                </p>
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Target</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sources.map((s) => (
                <div
                  key={s.id}
                  className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 flex flex-col justify-between space-y-4"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        {s.type === 'git' ? (
                          <GitBranch className="w-4 h-4 text-purple-400" />
                        ) : (
                          <FolderOpen className="w-4 h-4 text-cyan-400" />
                        )}
                        <h4 className="font-bold text-sm text-white">{s.name}</h4>
                      </div>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-mono ${
                          s.status === 'ready'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-rose-950 text-rose-400 border border-rose-800'
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>

                    <p className="text-xs font-mono text-slate-400 break-all mb-3">
                      {s.pathOrUrl}
                    </p>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-500 block">Stages</span>
                        <strong className="text-white">{s.stagesCount || 0}</strong>
                      </div>
                      <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-500 block">Steps</span>
                        <strong className="text-white">{s.stepsCount || 0}</strong>
                      </div>
                      <div className="bg-slate-950 p-2 rounded-lg border border-slate-800">
                        <span className="text-slate-500 block">Charts</span>
                        <strong className="text-white">{s.chartCount || 0}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-800/80">
                    <button
                      onClick={() => {
                        setSelectedSourceId(s.id);
                        setSelectedBlueprintId('');
                        loadSourcePipeline(s.id);
                        setActiveTab('canvas');
                      }}
                      className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                    >
                      <span>Open Canvas</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>

                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleSyncSource(s.id)}
                        title="Sync / Pull Source"
                        className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveSource(s.id)}
                        title="Delete Source"
                        className="p-1.5 rounded hover:bg-rose-900/40 text-slate-400 hover:text-rose-400"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
  );
}
