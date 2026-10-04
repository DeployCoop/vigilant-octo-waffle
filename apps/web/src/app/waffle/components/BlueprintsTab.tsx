'use client';

import {
  ArrowRight,
} from 'lucide-react';

import type { WafflePageState } from '../useWafflePage';

export default function BlueprintsTab({ s }: { s: WafflePageState }) {
  const {
    setActiveTab,
    blueprints,
    setSelectedSourceId,
    setSelectedBlueprintId,
    setCurrentPipeline,
  } = s;
  return (
          <div className="space-y-4">
            <div>
              <h3 className="text-base font-bold text-white">Pre-Packaged Community Blueprints</h3>
              <p className="text-xs text-slate-400">
                Vendor-neutral open source architectural blueprints with OpenEBS LocalPV storage pre-configured
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {blueprints.map((bp) => (
                <div
                  key={bp.id}
                  className="bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-xl p-5 flex flex-col justify-between transition-all"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="font-bold text-sm text-white">{bp.name}</h4>
                      <span className="text-xs px-2 py-0.5 rounded font-mono bg-purple-950 text-purple-300 border border-purple-800">
                        {bp.stagesCount} Stages
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 line-clamp-3 mb-4 leading-relaxed">
                      {bp.description}
                    </p>

                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {bp.tags?.map((t) => (
                        <span key={t} className="text-xs px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-400 font-mono">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => {
                      setSelectedBlueprintId(bp.id);
                      setSelectedSourceId('');
                      setCurrentPipeline(bp.pipeline);
                      setActiveTab('canvas');
                    }}
                    className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    <span>Load Blueprint</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
  );
}
