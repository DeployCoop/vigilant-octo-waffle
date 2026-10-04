'use client';

import { useState, useEffect, useRef } from 'react';
import { apiErrorMessage } from '@/lib/envelope';
import Link from 'next/link';
import {
  Bot,
  Send,
  Sparkles,
  RefreshCw,
  Server,
  Layers,
  Terminal,
  Activity,
  Trash2,
  Download,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  ArrowRight,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  X,
  Play,
  Flame,
  Shield,
  Settings2,
  Check,
  Zap,
  GitCompare,
  Wrench,
} from 'lucide-react';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { YamlDiffModal, type DetectedManifestPayload } from '@/components/YamlDiffModal';
import { useTerminal } from '@/context/TerminalContext';

type AIProvider = 'antigravity' | 'ollama' | 'vllm';

interface AIProviderInfo {
  id: AIProvider;
  name: string;
  available: boolean;
  baseUrl?: string;
  models: string[];
  defaultModel: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  provider?: AIProvider;
  durationSeconds?: number;
  tokensUsed?: number;
  modelUsed?: string;
  detectedManifests?: DetectedManifestPayload[];
  clusterSnapshot?: {
    connected: boolean;
    context: string;
    platform: string;
    nodeCount: number;
    podCount: number;
    unhealthyPods: string[];
    applicationsCount: number;
  };
}

interface EngineInfo {
  available: boolean;
  version?: string;
  defaultProvider: AIProvider;
  defaultModel: string;
  availableModels: string[];
  providers: Record<AIProvider, AIProviderInfo>;
  platform: string;
}

interface ClusterSnapshot {
  connected: boolean;
  context: string;
  platform: string;
  nodeCount: number;
  podCount: number;
  unhealthyPods: string[];
  applicationsCount: number;
}

interface CopilotToolItem {
  id: string;
  name: string;
  description: string;
  category: 'remediation' | 'inspection' | 'scaling' | 'diagnostics';
  parameters?: Record<string, any>;
}

const SAMPLE_PROMPTS = [
  {
    icon: Activity,
    title: 'Cluster Health Overview',
    prompt: 'Give me a complete health check of the Kubernetes cluster, active nodes, and pod workloads.',
  },
  {
    icon: AlertTriangle,
    title: 'Detect Failing Pods',
    prompt: 'Are there any failing pods, CrashLoopBackOff, or degraded workloads in any namespace?',
  },
  {
    icon: Layers,
    title: 'ArgoCD & Flux Applications',
    prompt: 'List all deployed GitOps applications, their sync status, and destination namespaces.',
  },
  {
    icon: Server,
    title: 'Scaling & Adding Nodes',
    prompt: 'How do I add more worker nodes to this cluster or scale the existing control plane?',
  },
  {
    icon: Shield,
    title: 'Security & Network Audit',
    prompt: 'Analyze cluster network policies, ingress endpoints, and identify potential security risks.',
  },
  {
    icon: Terminal,
    title: 'Recommended CLI Actions',
    prompt: 'What are the top 5 kubectl commands I should run right now to verify cluster readiness?',
  },
];

export default function AntigravityPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [engine, setEngine] = useState<EngineInfo | null>(null);
  const [clusterSnapshot, setClusterSnapshot] = useState<ClusterSnapshot | null>(null);
  const { openTerminal } = useTerminal();

  // Provider & Model State
  const [selectedProvider, setSelectedProvider] = useState<AIProvider>('antigravity');
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash-high');
  const [customModel, setCustomModel] = useState('');
  const [selectedEffort, setSelectedEffort] = useState<'low' | 'medium' | 'high'>('low');
  const [includeClusterContext, setIncludeClusterContext] = useState(true);
  const [conversationId, setConversationId] = useState<string | undefined>(undefined);

  // Custom Endpoints
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [vllmUrl, setVllmUrl] = useState('http://localhost:8000');
  const [showEndpointSettings, setShowEndpointSettings] = useState(false);
  const [endpointTesting, setEndpointTesting] = useState(false);

  // Streaming and Manifest Review State
  const [streamStatus, setStreamStatus] = useState<string>('');
  const [reviewManifest, setReviewManifest] = useState<DetectedManifestPayload | null>(null);
  const [isDiffModalOpen, setIsDiffModalOpen] = useState<boolean>(false);

  // Command Runner State
  const [commandOutput, setCommandOutput] = useState<{ command: string; output: string; status: 'running' | 'done' | 'failed' } | null>(null);

  // Copilot Autonomous Tools State
  const [copilotTools, setCopilotTools] = useState<CopilotToolItem[]>([]);
  const [toolExecuting, setToolExecuting] = useState<string | null>(null);
  const [showCopilotTools, setShowCopilotTools] = useState(false);
  const [toolNotice, setToolNotice] = useState<{ toolId: string; message: string; taskId?: string; error?: boolean } | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadCopilotTools = async () => {
    try {
      const res = await fetch('/api/cluster/k3s?action=copilot-tools');
      if (res.ok) {
        const data = await res.json();
        setCopilotTools(data.tools || []);
      }
    } catch {
      // offline fallback
    }
  };

  const handleExecuteCopilotTool = async (toolId: string, params: Record<string, any> = {}) => {
    setToolExecuting(toolId);
    setToolNotice(null);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'copilot-tool-exec',
          toolName: toolId,
          arguments: params,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setToolNotice({ toolId, message: apiErrorMessage(data, 'Execution failed'), error: true });
      } else {
        setToolNotice({
          toolId,
          message: data.message || `Tool '${toolId}' dispatched successfully`,
          taskId: data.taskId,
        });

        if (data.taskId) {
          openTerminal(data.taskId, `AI Copilot: ${toolId}`);
        }

        const toolEventMsg: ChatMessage = {
          id: `tool-${Date.now()}`,
          role: 'system',
          content: `⚡ **Autonomous Tool Dispatched**: \`${toolId}\`\n\n${data.message || 'Task initiated in background.'}\n${data.taskId ? `**Task ID**: \`${data.taskId}\` (Check Live Terminal console for real-time streaming output)` : ''}`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        setMessages((prev) => [...prev, toolEventMsg]);
      }
    } catch (err: any) {
      setToolNotice({ toolId, message: err.message, error: true });
    } finally {
      setToolExecuting(null);
    }
  };

  // Fetch engine and cluster telemetry
  const fetchStatus = async () => {
    try {
      const query = new URLSearchParams({
        ollamaEndpoint: ollamaUrl,
        vllmEndpoint: vllmUrl,
      });

      const res = await fetch(`/api/antigravity?${query.toString()}`);
      const data = await res.json();

      if (data.engine) {
        setEngine(data.engine);
        if (data.engine.providers?.[selectedProvider]?.defaultModel && !customModel) {
          setSelectedModel(data.engine.providers[selectedProvider].defaultModel);
        }
      }
      if (data.clusterSnapshot) {
        setClusterSnapshot(data.clusterSnapshot);
      }
    } catch {
      // offline fallback
    }
  };

  useEffect(() => {
    fetchStatus();
    loadCopilotTools();
  }, [ollamaUrl, vllmUrl]);

  // Update selected model when provider changes
  const handleProviderChange = (newProvider: AIProvider) => {
    setSelectedProvider(newProvider);
    setCustomModel('');
    if (engine?.providers?.[newProvider]) {
      setSelectedModel(engine.providers[newProvider].defaultModel);
    } else {
      if (newProvider === 'ollama') setSelectedModel('llama3:latest');
      else if (newProvider === 'vllm') setSelectedModel('meta-llama/Meta-Llama-3-8B-Instruct');
      else setSelectedModel('gemini-3.8-flash-high');
    }
  };

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleOpenManifestReview = (manifestOrRaw: DetectedManifestPayload | string) => {
    if (typeof manifestOrRaw === 'string') {
      const kindMatch = /(?:^|\n)\s*kind:\s*([A-Za-z0-9_-]+)/.exec(manifestOrRaw);
      const nameMatch = /(?:^|\n)\s*name:\s*([A-Za-z0-9_.-]+)/.exec(manifestOrRaw);
      setReviewManifest({
        raw: manifestOrRaw,
        kind: kindMatch ? kindMatch[1] : undefined,
        name: nameMatch ? nameMatch[1] : undefined,
      });
    } else {
      setReviewManifest(manifestOrRaw);
    }
    setIsDiffModalOpen(true);
  };

  const handleSendMessage = async (textToSend?: string) => {
    const messageText = (textToSend || input).trim();
    if (!messageText || loading) return;

    const activeModel = customModel.trim() || selectedModel;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageText,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const botMessageId = `bot-${Date.now()}`;
    const initialBotMessage: ChatMessage = {
      id: botMessageId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      provider: selectedProvider,
      modelUsed: activeModel,
      detectedManifests: [],
    };

    setMessages((prev) => [...prev, userMessage, initialBotMessage]);
    setInput('');
    setLoading(true);
    setStreamStatus(`Connecting to ${selectedProvider}...`);

    try {
      const customEndpoint =
        selectedProvider === 'ollama' ? ollamaUrl : selectedProvider === 'vllm' ? vllmUrl : undefined;

      const res = await fetch('/api/antigravity/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: messageText,
          provider: selectedProvider,
          model: activeModel,
          customEndpoint,
          conversationId,
          effort: selectedEffort,
          includeClusterContext,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP status ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulatedText = '';
      const detectedManifestsList: DetectedManifestPayload[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const block of parts) {
          const lines = block.split('\n');
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(trimmed.slice(6));
              if (event.type === 'status') {
                if (event.statusMessage) {
                  setStreamStatus(event.statusMessage);
                }
              } else if (event.type === 'chunk') {
                accumulatedText += event.text || '';
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === botMessageId
                      ? { ...m, content: accumulatedText }
                      : m
                  )
                );
              } else if (event.type === 'manifest') {
                if (event.manifest) {
                  detectedManifestsList.push(event.manifest);
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === botMessageId
                        ? { ...m, detectedManifests: [...detectedManifestsList] }
                        : m
                    )
                  );
                }
              } else if (event.type === 'done') {
                const resp = event.response;
                if (resp) {
                  if (resp.conversationId) setConversationId(resp.conversationId);
                  if (resp.clusterSnapshot) setClusterSnapshot(resp.clusterSnapshot);
                  setMessages((prev) =>
                    prev.map((m) =>
                      m.id === botMessageId
                        ? {
                            ...m,
                            content: resp.response || accumulatedText,
                            durationSeconds: resp.durationSeconds,
                            tokensUsed: resp.usage?.total_tokens,
                            modelUsed: resp.modelUsed || activeModel,
                            clusterSnapshot: resp.clusterSnapshot,
                            detectedManifests: [...detectedManifestsList],
                          }
                        : m
                    )
                  );
                }
              } else if (event.type === 'error') {
                throw new Error(event.error || 'Streaming error');
              }
            } catch {
              // Ignore partial parse
            }
          }
        }
      }
    } catch (err: any) {
      // If streaming fails, fall back to standard non-streaming POST
      try {
        const customEndpoint =
          selectedProvider === 'ollama' ? ollamaUrl : selectedProvider === 'vllm' ? vllmUrl : undefined;

        const fallbackRes = await fetch('/api/antigravity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: messageText,
            provider: selectedProvider,
            model: activeModel,
            customEndpoint,
            conversationId,
            effort: selectedEffort,
            includeClusterContext,
          }),
        });

        const fallbackData = await fallbackRes.json();
        if (fallbackRes.ok && fallbackData.response) {
          if (fallbackData.conversationId) setConversationId(fallbackData.conversationId);
          if (fallbackData.clusterSnapshot) setClusterSnapshot(fallbackData.clusterSnapshot);

          setMessages((prev) =>
            prev.map((m) =>
              m.id === botMessageId
                ? {
                    ...m,
                    content: fallbackData.response,
                    durationSeconds: fallbackData.durationSeconds,
                    tokensUsed: fallbackData.usage?.total_tokens,
                    modelUsed: fallbackData.modelUsed || activeModel,
                    clusterSnapshot: fallbackData.clusterSnapshot,
                  }
                : m
            )
          );
          return;
        }
      } catch {}

      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMessageId
            ? {
                ...m,
                role: 'system',
                content: `⚠️ Error contacting ${selectedProvider.toUpperCase()}: ${err.message}`,
              }
            : m
        )
      );
    } finally {
      setLoading(false);
      setStreamStatus('');
      textareaRef.current?.focus();
    }
  };

  const handleClearChat = () => {
    if (confirm('Clear the current conversation?')) {
      setMessages([]);
      setConversationId(undefined);
    }
  };

  const handleExportChat = () => {
    const text = messages
      .map(
        (m) =>
          `### ${m.role === 'user' ? 'User' : `AI (${m.provider || 'Antigravity'} - ${m.modelUsed || ''})`} [${m.timestamp}]\n\n${m.content}\n`
      )
      .join('\n---\n\n');

    const blob = new Blob([text], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cluster-copilot-conversation-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Execute recommended CLI commands via orchestrator allowlist
  const handleExecuteCommand = async (commandStr: string) => {
    const trimmed = commandStr.replace(/^[$#]\s*/, '').trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0];
    const args = parts.slice(1);

    setCommandOutput({
      command: trimmed,
      output: 'Executing command via orchestrator...',
      status: 'running',
    });

    try {
      const res = await fetch('/api/tasks/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd, args }),
      });

      const data = await res.json();
      if (!res.ok || data.error) {
        setCommandOutput({
          command: trimmed,
          output: `Command rejected or failed: ${apiErrorMessage(data)}`,
          status: 'failed',
        });
      } else {
        setCommandOutput({
          command: trimmed,
          output: `Task spawned successfully with ID: ${data.taskId}\nReal-time logs stream in the Live Terminal console.`,
          status: 'done',
        });
        if (data.taskId) {
          openTerminal(data.taskId, `CLI: ${trimmed}`);
        }
      }
    } catch (err: any) {
      setCommandOutput({
        command: trimmed,
        output: `Execution error: ${err.message}`,
        status: 'failed',
      });
    }
  };

  const currentProviderInfo = engine?.providers?.[selectedProvider];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Header Bar */}
      <div className="bg-slate-900/90 backdrop-blur border-b border-slate-800 px-6 py-3 flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="font-bold text-base text-slate-100 tracking-wide">
                Cluster AI Copilot
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center space-x-1">
                <Sparkles className="w-2.5 h-2.5" />
                <span>Multi-Engine</span>
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Ask Antigravity, Ollama, or vLLM with live Kubernetes telemetry grounding
            </p>
          </div>
        </div>

        {/* Controls */}
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
      </div>

      {/* Endpoint Configuration Dropdown Drawer */}
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

      {/* Cluster Telemetry Pill Banner */}
      <div className="bg-slate-900/50 border-b border-slate-800/80 px-6 py-2 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-3">
        <div className="flex items-center flex-wrap gap-4">
          <div className="flex items-center space-x-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                clusterSnapshot?.connected
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-amber-400'
              }`}
            />
            <span className="font-semibold text-slate-200">
              {clusterSnapshot?.connected ? 'Cluster Connected' : 'Cluster Offline / Initializing'}
            </span>
          </div>

          <div className="flex items-center space-x-1 font-mono text-[11px]">
            <span className="text-slate-500">Context:</span>
            <span className="text-sky-400 font-semibold">{clusterSnapshot?.context || 'none'}</span>
          </div>

          <div className="flex items-center space-x-1 font-mono text-[11px]">
            <span className="text-slate-500">Platform:</span>
            <span className="text-slate-300 uppercase font-semibold">
              {clusterSnapshot?.platform || 'KIND'}
            </span>
          </div>

          <div className="flex items-center space-x-1 text-[11px]">
            <span className="text-slate-500">Nodes:</span>
            <span className="text-slate-200 font-semibold">{clusterSnapshot?.nodeCount ?? 0}</span>
          </div>

          <div className="flex items-center space-x-1 text-[11px]">
            <span className="text-slate-500">Pods:</span>
            <span className="text-slate-200 font-semibold">{clusterSnapshot?.podCount ?? 0}</span>
          </div>

          {clusterSnapshot && clusterSnapshot.unhealthyPods.length > 0 && (
            <div className="flex items-center space-x-1 text-rose-400 bg-rose-950/40 border border-rose-800/60 px-2 py-0.5 rounded text-[11px] font-semibold animate-pulse">
              <AlertTriangle className="w-3 h-3" />
              <span>{clusterSnapshot.unhealthyPods.length} Unhealthy</span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchStatus}
            className="flex items-center space-x-1 text-slate-400 hover:text-sky-400 transition-colors text-[11px]"
            title="Refresh Cluster Telemetry"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh</span>
          </button>
          <Link
            href="/cluster"
            className="text-sky-400 hover:text-sky-300 flex items-center space-x-1 text-[11px]"
          >
            <span>Cluster Control</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Main Chat Messages Container */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 ? (
          <div className="max-w-3xl mx-auto py-8">
            {/* Empty State Welcome Hero */}
            <div className="text-center space-y-3 mb-8">
              <div className="inline-flex p-4 rounded-2xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 border border-sky-500/30 text-sky-400 shadow-xl shadow-sky-500/10">
                <Bot className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold text-slate-100">
                Ask About Your Kubernetes Cluster
              </h2>
              <p className="text-xs text-slate-400 max-w-lg mx-auto leading-relaxed">
                Autonomous DevOps copilot powered by{' '}
                <span className="text-sky-400 font-semibold">Google Antigravity</span>,{' '}
                <span className="text-emerald-400 font-semibold">Ollama</span>, or{' '}
                <span className="text-amber-400 font-semibold">vLLM</span>. Inspect cluster health,
                diagnose pod failures, review GitOps manifests, and run recommended fixes.
              </p>

              {/* Provider Quick Indicator */}
              <div className="flex items-center justify-center space-x-3 pt-2">
                <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] text-slate-300">
                  Active Engine:{' '}
                  <strong className="text-sky-400 capitalize">
                    {selectedProvider === 'antigravity'
                      ? 'Antigravity (AGY)'
                      : selectedProvider === 'ollama'
                      ? 'Ollama Local'
                      : 'vLLM Engine'}
                  </strong>{' '}
                  ({customModel || selectedModel})
                </span>
              </div>
            </div>

            {/* Prompt Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {SAMPLE_PROMPTS.map((sample, idx) => {
                const Icon = sample.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => handleSendMessage(sample.prompt)}
                    className="flex items-start space-x-3 p-3.5 rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-900 hover:border-sky-500/40 text-left transition-all group"
                  >
                    <div className="p-2 rounded-lg bg-slate-800 group-hover:bg-sky-500/10 group-hover:text-sky-400 text-slate-400 transition-colors shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-slate-200 group-hover:text-sky-300 transition-colors">
                        {sample.title}
                      </h3>
                      <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5 leading-relaxed">
                        {sample.prompt}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto space-y-6">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex items-start space-x-3 ${
                  m.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {/* Assistant Avatar */}
                {m.role !== 'user' && (
                  <div
                    className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 shadow-md ${
                      m.provider === 'ollama'
                        ? 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white'
                        : m.provider === 'vllm'
                        ? 'bg-gradient-to-br from-amber-600 to-orange-700 text-white'
                        : 'bg-gradient-to-br from-sky-500 to-indigo-600 text-white'
                    }`}
                  >
                    {m.provider === 'ollama' ? (
                      <span className="text-sm">🦙</span>
                    ) : m.provider === 'vllm' ? (
                      <Zap className="w-4 h-4 text-white" />
                    ) : (
                      <Bot className="w-4 h-4 text-white" />
                    )}
                  </div>
                )}

                {/* Message Bubble */}
                <div
                  className={`max-w-[85%] rounded-2xl p-4 shadow-sm text-xs ${
                    m.role === 'user'
                      ? 'bg-sky-600 text-white rounded-tr-none ml-12'
                      : m.role === 'system'
                      ? 'bg-rose-950/40 border border-rose-800/60 text-rose-300'
                      : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-none'
                  }`}
                >
                  {/* Top Bar for Assistant Message */}
                  {m.role === 'assistant' && (
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800 text-[11px] text-slate-400">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-slate-200 capitalize">
                          {m.provider || 'Antigravity'}
                        </span>
                        {m.modelUsed && (
                          <span className="font-mono text-[10px] text-slate-400 bg-slate-950 px-1.5 py-0.5 rounded border border-slate-800">
                            {m.modelUsed}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center space-x-2 text-[10px] text-slate-500">
                        {m.durationSeconds !== undefined && (
                          <span>{m.durationSeconds.toFixed(1)}s</span>
                        )}
                        {m.tokensUsed !== undefined && (
                          <span>• {m.tokensUsed} tokens</span>
                        )}
                        <span>• {m.timestamp}</span>
                      </div>
                    </div>
                  )}

                  {/* Message Content */}
                  {m.role === 'user' ? (
                    <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                  ) : (
                    <>
                      <MarkdownRenderer
                        content={m.content}
                        onExecuteCommand={handleExecuteCommand}
                        onReviewManifest={handleOpenManifestReview}
                      />
                      {m.detectedManifests && m.detectedManifests.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-slate-800 flex flex-wrap items-center gap-2">
                          {m.detectedManifests.map((man, manIdx) => (
                            <button
                              key={manIdx}
                              onClick={() => handleOpenManifestReview(man)}
                              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-[11px] font-medium transition-colors shadow-sm"
                            >
                              <GitCompare className="w-3 h-3" />
                              <span>
                                Review & Apply Patch: {man.kind || 'Manifest'} {man.name ? `(${man.name})` : ''}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* User Avatar */}
                {m.role === 'user' && (
                  <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 text-slate-300 font-semibold text-xs">
                    You
                  </div>
                )}
              </div>
            ))}

            {/* Loading Indicator */}
            {loading && (!messages[messages.length - 1] || messages[messages.length - 1].role === 'user' || !messages[messages.length - 1].content) && (
              <div className="flex items-start space-x-3">
                <div
                  className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 animate-pulse ${
                    selectedProvider === 'ollama'
                      ? 'bg-gradient-to-br from-emerald-600 to-teal-700 text-white'
                      : selectedProvider === 'vllm'
                      ? 'bg-gradient-to-br from-amber-600 to-orange-700 text-white'
                      : 'bg-gradient-to-br from-sky-500 to-indigo-600 text-white'
                  }`}
                >
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <div className="bg-slate-900 border border-slate-800 rounded-2xl rounded-tl-none p-4 text-xs text-slate-300 flex items-center space-x-2">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400 animate-spin" />
                  <span className="text-slate-400">
                    {streamStatus ||
                      (selectedProvider === 'ollama'
                        ? 'Ollama is generating response...'
                        : selectedProvider === 'vllm'
                        ? 'vLLM is running inference...'
                        : 'Antigravity is inspecting cluster telemetry and reasoning...')}
                  </span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Quick Command Execution Feedback Drawer */}
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

      {/* Input Area */}
      <div className="p-4 bg-slate-900/90 border-t border-slate-800 shrink-0">
        <div className="max-w-4xl mx-auto space-y-2">
          {/* Quick Pill Suggestions */}
          <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 text-[11px] scrollbar-none">
            <span className="text-slate-500 shrink-0">Suggestions:</span>
            {[
              'Cluster Health Overview',
              'Check for Failing Pods',
              'ArgoCD Sync Status',
              'How to Add Worker Nodes',
              'Inspect Ingress & Certificates',
            ].map((label, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(label)}
                disabled={loading}
                className="px-2 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 shrink-0 transition-colors border border-slate-700/60"
              >
                {label}
              </button>
            ))}
          </div>

          {/* Autonomous Copilot Tools Bar */}
          <div className="flex items-center justify-between pb-1 text-[11px] border-t border-slate-800/80 pt-1.5">
            <div className="flex items-center space-x-1.5 overflow-x-auto scrollbar-none py-0.5">
              <span className="text-sky-400 font-semibold flex items-center space-x-1 shrink-0">
                <Wrench className="w-3 h-3 text-sky-400" />
                <span>Autonomous Tools:</span>
              </span>
              <button
                onClick={() => handleExecuteCopilotTool('run_cluster_healer', { autoRemediate: true })}
                disabled={Boolean(toolExecuting)}
                className="px-2 py-0.5 rounded-full bg-emerald-950/70 hover:bg-emerald-900 text-emerald-300 border border-emerald-800/60 shrink-0 transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <span>⚡ Run Healer</span>
              </button>
              <button
                onClick={() => handleExecuteCopilotTool('run_dr_drill', { dryRun: false, namespace: 'dr-sandbox' })}
                disabled={Boolean(toolExecuting)}
                className="px-2 py-0.5 rounded-full bg-indigo-950/70 hover:bg-indigo-900 text-indigo-300 border border-indigo-800/60 shrink-0 transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <span>🛡️ DR Game Day</span>
              </button>
              <button
                onClick={() => handleExecuteCopilotTool('inspect_finops')}
                disabled={Boolean(toolExecuting)}
                className="px-2 py-0.5 rounded-full bg-amber-950/70 hover:bg-amber-900 text-amber-300 border border-amber-800/60 shrink-0 transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <span>💰 Inspect FinOps & GPU</span>
              </button>
              <button
                onClick={() => handleExecuteCopilotTool('drain_idle_nodes', { dryRun: true })}
                disabled={Boolean(toolExecuting)}
                className="px-2 py-0.5 rounded-full bg-purple-950/70 hover:bg-purple-900 text-purple-300 border border-purple-800/60 shrink-0 transition-colors flex items-center space-x-1 cursor-pointer"
              >
                <span>📉 Drain Idle Nodes</span>
              </button>
            </div>

            <button
              onClick={() => setShowCopilotTools((prev) => !prev)}
              className="text-slate-400 hover:text-slate-200 flex items-center space-x-1 shrink-0 ml-2 px-2 py-0.5 rounded bg-slate-800/60 transition cursor-pointer"
            >
              <span>All Tools ({copilotTools.length || 9})</span>
              {showCopilotTools ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>

          {/* Expandable Tools Drawer */}
          {showCopilotTools && (
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3.5 space-y-3 shadow-2xl max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-sky-400" />
                  <span>Copilot Autonomous Tool Calling Catalog</span>
                </span>
                <span className="text-[10px] text-slate-500 font-mono">Dispatched directly to cluster orchestrator</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {(copilotTools.length > 0
                  ? copilotTools
                  : [
                      { id: 'run_cluster_healer', name: 'Autonomous Cluster Healer', description: 'Remediate disk pressure, certs, crashloops', category: 'remediation' as const },
                      { id: 'run_dr_drill', name: 'DR Game Day Drill', description: 'Snapshot integrity & sandbox restore test', category: 'inspection' as const },
                      { id: 'inspect_finops', name: 'FinOps & GPU Economics', description: 'P95 right-sizing & RTX 3060 wattage telemetry', category: 'inspection' as const },
                      { id: 'provision_hybrid_node', name: 'Provision Hybrid Node', description: 'Multipass/libvirt/Docker worker burst', category: 'scaling' as const },
                      { id: 'drain_idle_nodes', name: 'Drain Idle Pooled Nodes', description: 'Scale-to-zero idle hybrid machines', category: 'scaling' as const },
                      { id: 'split_canary_traffic', name: 'Gateway Canary Split', description: 'HTTPRoute dynamic weighted traffic split', category: 'scaling' as const },
                      { id: 'kubectl_restart_rollout', name: 'Restart Rollout', description: 'Graceful rolling bounce of workload', category: 'remediation' as const },
                      { id: 'kubectl_describe_pod', name: 'Describe Unhealthy Pod', description: 'Fetch container events & status', category: 'diagnostics' as const },
                      { id: 'kubectl_tail_logs', name: 'Tail Pod Logs', description: 'Fetch last 100 log lines from workload', category: 'diagnostics' as const },
                    ]
                ).map((tool) => (
                  <div key={tool.id} className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 space-y-1.5 flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-200">{tool.name}</span>
                        <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          {tool.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{tool.description}</p>
                    </div>

                    <button
                      onClick={() => handleExecuteCopilotTool(tool.id)}
                      disabled={toolExecuting === tool.id}
                      className="w-full mt-1 px-2 py-1 rounded bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 text-white text-[11px] font-medium transition cursor-pointer flex items-center justify-center space-x-1"
                    >
                      {toolExecuting === tool.id ? (
                        <>
                          <RefreshCw className="w-3 h-3 animate-spin" />
                          <span>Dispatching...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3" />
                          <span>Trigger Tool</span>
                        </>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {toolNotice && (
            <div className={`p-2.5 rounded-lg border text-xs font-mono flex items-center justify-between ${
              toolNotice.error ? 'bg-rose-950/40 border-rose-800/60 text-rose-300' : 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
            }`}>
              <div className="flex items-center space-x-2 truncate">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{toolNotice.message}</span>
              </div>
              {toolNotice.taskId && (
                <Link href="/terminal" className="text-sky-400 hover:underline shrink-0 ml-2 font-sans text-[11px]">
                  View Task &rarr;
                </Link>
              )}
            </div>
          )}

          {/* Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-end space-x-2 bg-slate-950 border border-slate-800 rounded-xl p-2 focus-within:border-sky-500/80 transition-all shadow-inner"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={`Ask ${
                selectedProvider === 'ollama' ? 'Ollama' : selectedProvider === 'vllm' ? 'vLLM' : 'Antigravity'
              } anything about your Kubernetes cluster, pods, ArgoCD, or GitOps...`}
              rows={1}
              disabled={loading}
              className="flex-1 bg-transparent text-xs text-slate-100 placeholder-slate-500 focus:outline-none resize-none px-2 py-1 max-h-32 min-h-[36px]"
            />

            <button
              type="submit"
              disabled={loading || !input.trim()}
              className={`p-2 rounded-lg transition-all shrink-0 ${
                input.trim() && !loading
                  ? 'bg-sky-600 hover:bg-sky-500 text-white shadow-md shadow-sky-600/20'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed'
              }`}
              title="Send to Copilot (Enter)"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>

          <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
            <span>
              Engine: <strong className="text-slate-400 capitalize">{selectedProvider}</strong> (
              {customModel || selectedModel}) • Press{' '}
              <kbd className="bg-slate-800 px-1 rounded text-slate-400">Enter</kbd> to send
            </span>
            <span>Grounded in live local cluster state</span>
          </div>
        </div>
      </div>

      {/* Manifest Diff & 1-Click Apply Modal */}
      <YamlDiffModal
        isOpen={isDiffModalOpen}
        onClose={() => setIsDiffModalOpen(false)}
        manifest={reviewManifest}
        onExecuteCommand={handleExecuteCommand}
        onApplied={fetchStatus}
      />
    </div>
  );
}
