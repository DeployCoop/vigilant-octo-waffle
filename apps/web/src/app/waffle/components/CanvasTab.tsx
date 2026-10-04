'use client';

import {
  AlertCircle,
  ExternalLink,
  Layers,
} from 'lucide-react';

import type { WafflePageState } from '../useWafflePage';

export default function CanvasTab({ s }: { s: WafflePageState }) {
  const {
    selectedBlueprintId,
    currentPipeline,
    activeRun,
    getStepStatusBadge,
  } = s;
  return (
          <div className="space-y-6">
            {/* Pipeline Header Card */}
            {currentPipeline ? (
              <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-80 h-40 bg-gradient-to-bl from-cyan-500/10 via-indigo-500/5 to-transparent pointer-events-none" />
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center space-x-3 mb-1">
                      <h2 className="text-lg font-bold text-white tracking-wide">
                        {currentPipeline.metadata.name}
                      </h2>
                      <span className="text-xs px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-300 border border-slate-700">
                        v{currentPipeline.metadata.version || '1.0.0'}
                      </span>
                      {selectedBlueprintId && (
                        <span className="text-xs px-2 py-0.5 rounded font-semibold bg-purple-950/80 border border-purple-500/40 text-purple-300">
                          Community Blueprint
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 max-w-3xl leading-relaxed">
                      {currentPipeline.metadata.description || 'No description provided.'}
                    </p>
                  </div>

                  <div className="flex items-center space-x-4 shrink-0 text-xs">
                    <div className="px-3 py-1.5 bg-slate-950/80 rounded-lg border border-slate-800">
                      <span className="text-slate-400">Stages: </span>
                      <strong className="text-cyan-400">{currentPipeline.stages.length}</strong>
                    </div>
                    <div className="px-3 py-1.5 bg-slate-950/80 rounded-lg border border-slate-800">
                      <span className="text-slate-400">Total Charts: </span>
                      <strong className="text-cyan-400">
                        {currentPipeline.stages.reduce((acc, s) => acc + s.steps.length, 0)}
                      </strong>
                    </div>
                    <div className="px-3 py-1.5 bg-slate-950/80 rounded-lg border border-slate-800">
                      <span className="text-slate-400">StorageClass: </span>
                      <strong className="text-emerald-400">openebs-hostpath</strong>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-12 text-center border border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
                <AlertCircle className="w-8 h-8 text-slate-500 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No active pipeline loaded. Select a target or blueprint above.</p>
              </div>
            )}

            {/* Interactive Animated Pipeline Stage Canvas */}
            {currentPipeline && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-cyan-400" />
                    Stage Execution DAG (Dependency Order)
                  </h3>
                  <span className="text-xs text-slate-500 font-mono">
                    OpenEBS LocalPV Pre-flight Active
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-6 relative">
                  {currentPipeline.stages.map((stage, sIdx) => {
                    const stageProg = activeRun?.stages[stage.id];
                    const stageStatus = stageProg?.status || 'pending';

                    return (
                      <div
                        key={stage.id}
                        className={`rounded-2xl border transition-all duration-300 relative overflow-hidden ${
                          stageStatus === 'running'
                            ? 'bg-slate-900/90 border-cyan-500/60 shadow-xl shadow-cyan-500/10'
                            : stageStatus === 'completed'
                            ? 'bg-slate-900/60 border-emerald-500/30'
                            : stageStatus === 'failed'
                            ? 'bg-slate-900/60 border-rose-500/40'
                            : 'bg-slate-900/40 border-slate-800/80'
                        }`}
                      >
                        {/* Animated Stage Header */}
                        <div className="px-5 py-4 border-b border-slate-800/80 flex flex-col md:flex-row md:items-center justify-between gap-2">
                          <div className="flex items-center space-x-3">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center font-mono font-bold text-xs ${
                                stageStatus === 'running'
                                  ? 'bg-cyan-500 text-slate-950 animate-pulse'
                                  : stageStatus === 'completed'
                                  ? 'bg-emerald-500 text-slate-950'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {sIdx}
                            </div>
                            <div>
                              <div className="flex items-center space-x-2">
                                <h4 className="text-sm font-bold text-white tracking-wide">
                                  {stage.name}
                                </h4>
                                <span className="text-xs px-2 py-0.5 rounded font-mono bg-slate-950 border border-slate-800 text-slate-400">
                                  {stage.id}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400">
                                {stage.description || 'Execution stage'}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <span
                              className={`text-xs px-2.5 py-1 rounded-full font-mono font-semibold uppercase tracking-wider ${
                                stage.mode === 'parallel'
                                  ? 'bg-indigo-950/80 text-indigo-300 border border-indigo-500/30'
                                  : 'bg-slate-950 text-slate-300 border border-slate-700'
                              }`}
                            >
                              {stage.mode === 'parallel' ? '⚡ Parallel Mode' : '➔ Series Mode'}
                            </span>
                            {getStepStatusBadge(stageStatus)}
                          </div>
                        </div>

                        {/* Step Card Grid */}
                        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {stage.steps.map((step) => {
                            const stepProg = stageProg?.steps[step.id];
                            const stepStatus = stepProg?.status || 'pending';

                            return (
                              <div
                                key={step.id}
                                className={`rounded-xl border p-4 transition-all duration-200 relative ${
                                  stepStatus === 'running'
                                    ? 'bg-slate-950 border-cyan-500 shadow-md shadow-cyan-500/20'
                                    : stepStatus === 'verifying'
                                    ? 'bg-slate-950 border-purple-500 shadow-md shadow-purple-500/20'
                                    : stepStatus === 'completed'
                                    ? 'bg-slate-950/80 border-emerald-500/40'
                                    : stepStatus === 'failed'
                                    ? 'bg-slate-950/80 border-rose-500/40'
                                    : 'bg-slate-950/50 border-slate-800/80'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2 mb-2">
                                  <div className="font-semibold text-xs text-white tracking-wide truncate">
                                    {step.name}
                                  </div>
                                  <div>{getStepStatusBadge(stepStatus)}</div>
                                </div>

                                <div className="space-y-1.5 text-xs text-slate-400">
                                  <div className="flex items-center justify-between">
                                    <span>Chart:</span>
                                    <code className="text-cyan-400 font-mono">{step.chart}</code>
                                  </div>
                                  <div className="flex items-center justify-between">
                                    <span>Namespace:</span>
                                    <code className="text-slate-300 font-mono">{step.namespace || 'default'}</code>
                                  </div>
                                  {step.domain && (
                                    <div className="flex items-center justify-between">
                                      <span>Domain:</span>
                                      <a
                                        href={`https://${step.domain}`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                                      >
                                        {step.domain}
                                        <ExternalLink className="w-2.5 h-2.5" />
                                      </a>
                                    </div>
                                  )}
                                  {stepProg?.durationMs && (
                                    <div className="flex items-center justify-between text-slate-500">
                                      <span>Duration:</span>
                                      <span>{(stepProg.durationMs / 1000).toFixed(1)}s</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
  );
}
