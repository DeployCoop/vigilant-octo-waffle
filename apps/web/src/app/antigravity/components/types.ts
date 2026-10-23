import type { DetectedManifestPayload } from '@/components/YamlDiffModal';

export type AIProvider = 'antigravity' | 'ollama' | 'vllm';

export interface AIProviderInfo {
  id: AIProvider;
  name: string;
  available: boolean;
  baseUrl?: string;
  models: string[];
  defaultModel: string;
}

export interface ChatMessage {
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

export interface EngineInfo {
  available: boolean;
  version?: string;
  defaultProvider: AIProvider;
  defaultModel: string;
  availableModels: string[];
  providers: Record<AIProvider, AIProviderInfo>;
  platform: string;
}

export interface ClusterSnapshot {
  connected: boolean;
  context: string;
  platform: string;
  nodeCount: number;
  podCount: number;
  unhealthyPods: string[];
  applicationsCount: number;
}

export interface CopilotToolItem {
  id: string;
  name: string;
  description: string;
  category: 'remediation' | 'inspection' | 'scaling' | 'diagnostics';
  parameters?: Record<string, any>;
}
