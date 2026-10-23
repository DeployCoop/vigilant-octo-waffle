'use client';

import { RefreshCw, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { AIProvider } from './types';

interface EndpointDrawerProps {
  showEndpointSettings: boolean;
  selectedProvider: AIProvider;
  ollamaUrl: string;
  vllmUrl: string;
  customModel: string;
  endpointTesting: boolean;
  setOllamaUrl: Dispatch<SetStateAction<string>>;
  setVllmUrl: Dispatch<SetStateAction<string>>;
  setCustomModel: Dispatch<SetStateAction<string>>;
  setEndpointTesting: Dispatch<SetStateAction<boolean>>;
  setShowEndpointSettings: Dispatch<SetStateAction<boolean>>;
  fetchStatus: () => Promise<void>;
}

export default function EndpointDrawer({
  showEndpointSettings,
  selectedProvider,
  ollamaUrl,
  vllmUrl,
  customModel,
  endpointTesting,
  setOllamaUrl,
  setVllmUrl,
  setCustomModel,
  setEndpointTesting,
  setShowEndpointSettings,
  fetchStatus,
}: EndpointDrawerProps) {
  return (
    <>
      {showEndpointSettings && (selectedProvider === 'ollama' || selectedProvider === 'vllm') && (
        <div className="bg-slate-900 border-b border-slate-800 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 text-xs animate-in slide-in-from-top-2">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center space-x-2">
              <span className="text-slate-400 font-semibold uppercase">
                {selectedProvider} Base URL:
              </span>
              <input
                type="text"
                value={selectedProvider === 'ollama' ? ollamaUrl : vllmUrl}
                onChange={(e) =>
                  selectedProvider === 'ollama'
                    ? setOllamaUrl(e.target.value)
                    : setVllmUrl(e.target.value)
                }
                className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-sky-400 font-mono text-xs w-64 focus:outline-none focus:border-sky-500"
                placeholder={selectedProvider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:8000'}
              />
            </div>

            <div className="flex items-center space-x-2">
              <span className="text-slate-400">Custom Model Tag:</span>
              <input
                type="text"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-slate-200 font-mono text-xs w-48 focus:outline-none focus:border-sky-500"
                placeholder="e.g. qwen2.5-coder:7b"
              />
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={async () => {
                setEndpointTesting(true);
                await fetchStatus();
                setEndpointTesting(false);
              }}
              disabled={endpointTesting}
              className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold flex items-center space-x-1"
            >
              <RefreshCw className={`w-3 h-3 ${endpointTesting ? 'animate-spin' : ''}`} />
              <span>Probe Endpoint</span>
            </button>
            <button
              onClick={() => setShowEndpointSettings(false)}
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
