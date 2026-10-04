'use client';

import {
  TerminalIcon,
} from 'lucide-react';

import type { WafflePageState } from '../useWafflePage';

export default function RunTerminal({ s }: { s: WafflePageState }) {
  const {
    executing,
    terminalOpen,
    setTerminalOpen,
    liveLogs,
    setLiveLogs,
    terminalEndRef,
  } = s;
  return (
    <>
      {/* Floating Streaming Terminal Drawer */}
      <div
        className={`fixed bottom-0 left-0 right-0 z-40 bg-slate-950/95 border-t border-slate-800 backdrop-blur shadow-2xl transition-all duration-300 ${
          terminalOpen ? 'h-72' : 'h-10'
        }`}
      >
        <div
          onClick={() => setTerminalOpen(!terminalOpen)}
          className="h-10 px-6 flex items-center justify-between cursor-pointer border-b border-slate-800 hover:bg-slate-900/50"
        >
          <div className="flex items-center space-x-2 text-xs font-mono">
            <TerminalIcon className="w-3.5 h-3.5 text-cyan-400" />
            <span className="font-semibold text-white">Live Execution Terminal</span>
            {executing && (
              <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-ping ml-1" />
            )}
            <span className="text-slate-500">({liveLogs.length} lines logged)</span>
          </div>

          <div className="flex items-center space-x-3 text-xs text-slate-400">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLiveLogs([]);
              }}
              className="hover:text-white"
            >
              Clear
            </button>
            <span>{terminalOpen ? '▼ Minimize' : '▲ Expand'}</span>
          </div>
        </div>

        {terminalOpen && (
          <div className="h-[calc(100%-2.5rem)] p-4 overflow-y-auto font-mono text-xs text-slate-300 space-y-1 bg-slate-950">
            {liveLogs.length === 0 ? (
              <p className="text-slate-600">Terminal ready. Output will stream here during execution.</p>
            ) : (
              liveLogs.map((line, idx) => (
                <div
                  key={idx}
                  className={`leading-relaxed ${
                    line.includes('[ERROR]') || line.includes('[FATAL]')
                      ? 'text-rose-400'
                      : line.includes('[PREFLIGHT]')
                      ? 'text-purple-300'
                      : line.includes('✔') || line.includes('finished')
                      ? 'text-emerald-400'
                      : 'text-slate-300'
                  }`}
                >
                  {line}
                </div>
              ))
            )}
            <div ref={terminalEndRef} />
          </div>
        )}
      </div>
    </>
  );
}
