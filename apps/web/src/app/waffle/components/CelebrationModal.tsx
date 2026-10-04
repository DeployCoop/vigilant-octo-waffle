'use client';

import {
  ExternalLink,
} from 'lucide-react';

import type { WafflePageState } from '../useWafflePage';

export default function CelebrationModal({ s }: { s: WafflePageState }) {
  const {
    activeRun,
    setShowCelebration,
  } = s;
  return (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-slate-900 border border-emerald-500/50 rounded-2xl p-8 max-w-xl w-full text-center space-y-6 shadow-2xl shadow-emerald-500/10">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 mx-auto flex items-center justify-center text-3xl animate-bounce">
              🎉
            </div>

            <div>
              <h3 className="text-2xl font-bold text-white tracking-wide">
                Waffle Pipeline Deployed!
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                All dependency stages and health verification checks passed with 0 errors.
              </p>
            </div>

            {activeRun && activeRun.deployedDomains.length > 0 && (
              <div className="space-y-2 text-left bg-slate-950 p-4 rounded-xl border border-slate-800">
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  Active Deployed VIP Portals:
                </span>
                {activeRun.deployedDomains.map((d) => (
                  <div key={d.domain} className="flex items-center justify-between text-xs py-1">
                    <span className="text-white font-medium">{d.name}</span>
                    <a
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cyan-400 hover:text-cyan-300 font-mono flex items-center gap-1"
                    >
                      {d.domain}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={() => setShowCelebration(false)}
              className="px-6 py-2.5 rounded-lg text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors shadow-lg shadow-emerald-500/20"
            >
              Close & View Canvas
            </button>
          </div>
        </div>
  );
}
