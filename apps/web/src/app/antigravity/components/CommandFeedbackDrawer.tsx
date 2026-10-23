'use client';

import Link from 'next/link';
import { ExternalLink, Terminal, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

type CommandOutput = { command: string; output: string; status: 'running' | 'done' | 'failed' };

interface CommandFeedbackDrawerProps {
  commandOutput: CommandOutput | null;
  setCommandOutput: Dispatch<SetStateAction<CommandOutput | null>>;
}

export default function CommandFeedbackDrawer({ commandOutput, setCommandOutput }: CommandFeedbackDrawerProps) {
  return (
    <>
      {commandOutput && (
        <div className="bg-slate-900/95 border-t border-slate-800 px-6 py-3 flex items-center justify-between text-xs font-mono">
          <div className="flex items-center space-x-3 overflow-hidden">
            <Terminal className="w-4 h-4 text-sky-400 shrink-0" />
            <div className="truncate">
              <span className="text-slate-400 font-semibold">$ {commandOutput.command}</span>
              <p className="text-slate-300 text-[11px] truncate">{commandOutput.output}</p>
            </div>
          </div>
          <div className="flex items-center space-x-2 shrink-0">
            <Link
              href="/terminal"
              className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-sans flex items-center space-x-1"
            >
              <span>Open Console</span>
              <ExternalLink className="w-3 h-3" />
            </Link>
            <button
              onClick={() => setCommandOutput(null)}
              className="p-1 text-slate-400 hover:text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
