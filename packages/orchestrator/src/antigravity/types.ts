/**
 * Antigravity AI copilot types: providers, streaming events, engine status, ask options (WS6 split of antigravity.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */


export type AIProvider = 'antigravity' | 'ollama' | 'vllm';

export interface DetectedManifest {
  raw: string;
  kind?: string;
  name?: string;
  namespace?: string;
  targetAppId?: string;
  isArgoApp?: boolean;
}

export type StreamEventType = 'status' | 'chunk' | 'manifest' | 'done' | 'error';

export interface StreamEvent {
  type: StreamEventType;
  text?: string;
  statusMessage?: string;
  manifest?: DetectedManifest;
  response?: AntigravityResponse;
  error?: string;
}

export interface AIProviderInfo {
  id: AIProvider;
  name: string;
  available: boolean;
  baseUrl?: string;
  models: string[];
  defaultModel: string;
}

export interface AntigravityEngineStatus {
  available: boolean;
  binaryPath?: string;
  version?: string;
  defaultProvider: AIProvider;
  defaultModel: string;
  availableModels: string[];
  providers: Record<AIProvider, AIProviderInfo>;
  platform: string;
}

export interface AntigravityResponse {
  response: string;
  provider: AIProvider;
  modelUsed: string;
  conversationId?: string;
  durationSeconds?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    thinking_tokens?: number;
    total_tokens?: number;
  };
  engineUsed: 'antigravity-cli' | 'ollama' | 'vllm' | 'cluster-copilot-engine';
  clusterSnapshot: {
    connected: boolean;
    context: string;
    platform: string;
    nodeCount: number;
    podCount: number;
    unhealthyPods: string[];
    applicationsCount: number;
  };
}

export interface AskAntigravityOptions {
  prompt: string;
  provider?: AIProvider;
  model?: string;
  customEndpoint?: string;
  conversationId?: string;
  effort?: 'low' | 'medium' | 'high';
  includeClusterContext?: boolean;
  root: string;
}

export type StreamAntigravityOptions = AskAntigravityOptions;
