'use client';

import { Cpu, Download, Flame, Settings2, Sparkles, Trash2, Zap } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { AIProvider, AIProviderInfo, ChatMessage, EngineInfo } from './types';

interface HeaderControlsProps {
  selectedProvider: AIProvider;
  engine: EngineInfo | null;
  currentProviderInfo: AIProviderInfo | undefined;
  selectedModel: string;
  selectedEffort: 'low' | 'medium' | 'high';
  showEndpointSettings: boolean;
  includeClusterContext: boolean;
  loading: boolean;
  messages: ChatMessage[];
  handleProviderChange: (newProvider: AIProvider) => void;
  setSelectedModel: Dispatch<SetStateAction<string>>;
  setCustomModel: Dispatch<SetStateAction<string>>;
  setSelectedEffort: Dispatch<SetStateAction<'low' | 'medium' | 'high'>>;
  setShowEndpointSettings: Dispatch<SetStateAction<boolean>>;
  setIncludeClusterContext: Dispatch<SetStateAction<boolean>>;
  handleSendMessage: (textToSend?: string) => Promise<void>;
  handleExportChat: () => void;
  handleClearChat: () => void;
}

export default function HeaderControls({
  selectedProvider,
  engine,
  currentProviderInfo,
  selectedModel,
  selectedEffort,
  showEndpointSettings,
  includeClusterContext,
  loading,
  messages,
  handleProviderChange,
  setSelectedModel,
  setCustomModel,
  setSelectedEffort,
  setShowEndpointSettings,
  setIncludeClusterContext,
  handleSendMessage,
  handleExportChat,
  handleClearChat,
}: HeaderControlsProps) {
  return (
        <div className="flex items-center flex-wrap gap-2.5 text-xs">
          {/* Provider Tabs */}
          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-lg p-0.5">
            <button
              onClick={() => handleProviderChange('antigravity')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                selectedProvider === 'antigravity'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles className="w-3 h-3 text-sky-300" />
              <span>Antigravity</span>
            </button>

            <button
              onClick={() => handleProviderChange('ollama')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                selectedProvider === 'ollama'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="text-xs">🦙</span>
              <span>Ollama</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  engine?.providers?.ollama?.available ? 'bg-emerald-400' : 'bg-slate-600'
                }`}
                title={engine?.providers?.ollama?.available ? 'Ollama Online' : 'Ollama Standby / Offline'}
              />
            </button>

            <button
              onClick={() => handleProviderChange('vllm')}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                selectedProvider === 'vllm'
                  ? 'bg-sky-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Zap className="w-3 h-3 text-amber-400" />
              <span>vLLM</span>
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  engine?.providers?.vllm?.available ? 'bg-emerald-400' : 'bg-slate-600'
                }`}
                title={engine?.providers?.vllm?.available ? 'vLLM Online' : 'vLLM Standby / Offline'}
              />
            </button>
          </div>

          {/* Model Selector */}
          <div className="flex items-center space-x-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5">
            <Cpu className="w-3.5 h-3.5 text-sky-400" />
            <select
              value={selectedModel}
              onChange={(e) => {
                setSelectedModel(e.target.value);
                setCustomModel('');
              }}
              className="bg-transparent text-slate-200 text-xs focus:outline-none cursor-pointer pr-1 max-w-[160px] truncate"
            >
              {currentProviderInfo?.models ? (
                currentProviderInfo.models.map((m) => (
                  <option key={m} value={m} className="bg-slate-900 text-slate-200">
                    {m}
                  </option>
                ))
              ) : (
                <option value={selectedModel}>{selectedModel}</option>
              )}
            </select>
          </div>

          {/* Effort Selector for Antigravity */}
          {selectedProvider === 'antigravity' && (
            <div className="flex items-center space-x-1 bg-slate-950 border border-slate-800 rounded-lg p-0.5">
              {(['low', 'medium', 'high'] as const).map((lvl) => (
                <button
                  key={lvl}
                  onClick={() => setSelectedEffort(lvl)}
                  className={`px-2 py-1 rounded text-[11px] font-medium capitalize transition-colors ${
                    selectedEffort === lvl
                      ? 'bg-sky-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={`Reasoning effort: ${lvl}`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          )}

          {/* Endpoint Settings Button */}
          {(selectedProvider === 'ollama' || selectedProvider === 'vllm') && (
            <button
              onClick={() => setShowEndpointSettings(!showEndpointSettings)}
              className={`p-1.5 rounded-lg border transition-colors ${
                showEndpointSettings
                  ? 'bg-sky-600 border-sky-500 text-white'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
              title="Configure Endpoint URL & Custom Model"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Context Injection Toggle */}
          <label className="flex items-center space-x-1.5 bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 cursor-pointer text-slate-300 select-none">
            <input
              type="checkbox"
              checked={includeClusterContext}
              onChange={(e) => setIncludeClusterContext(e.target.checked)}
              className="rounded border-slate-700 text-sky-600 focus:ring-0 cursor-pointer"
            />
            <span className="text-[11px]">Live Cluster Telemetry</span>
          </label>

          {/* Watchdog Scan Button */}
          <button
            onClick={() =>
              handleSendMessage(
                'Perform a comprehensive cluster health and reliability inspection. Analyze active node resource saturation, check pod crash loops, inspect recent warning events, verify ingress routes, and highlight top 3 risk factors with concrete kubectl fix commands.'
              )
            }
            disabled={loading}
            className="flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-xs font-medium transition-colors disabled:opacity-50 shadow-sm"
            title="Trigger deep automated Cluster Watchdog inspection"
          >
            <Flame className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Watchdog Scan</span>
          </button>

          {/* Clear & Export Buttons */}
          {messages.length > 0 && (
            <div className="flex items-center space-x-1">
              <button
                onClick={handleExportChat}
                className="p-1.5 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
                title="Export Conversation (.md)"
              >
                <Download className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleClearChat}
                className="p-1.5 rounded-lg border border-slate-800 hover:bg-rose-950/40 text-slate-400 hover:text-rose-400 transition-colors"
                title="Clear Chat"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
  );
}
