/**
 * AI provider detection and status: agy binary, Ollama, vLLM, model defaults (WS6 split of antigravity.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { type AIProvider, type AIProviderInfo, type AntigravityEngineStatus } from './types.js';

const DEFAULT_ANTIGRAVITY_MODELS = [
  'gemini-3.8-flash-high',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-low',
  'gemini-3.7-flash-high',
  'gemini-3.7-flash-medium',
  'gemini-3.1-pro-high',
  'claude-sonnet-4-6',
  'claude-opus-4-6-thinking',
  'gpt-oss-120b-medium',
];

const DEFAULT_OLLAMA_MODELS = [
  'llama3:latest',
  'mistral:latest',
  'deepseek-r1:latest',
  'qwen2.5-coder:latest',
  'codellama:latest',
  'phi4:latest',
];

const DEFAULT_VLLM_MODELS = [
  'meta-llama/Meta-Llama-3-8B-Instruct',
  'mistralai/Mistral-7B-Instruct-v0.2',
  'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
  'Qwen/Qwen2.5-Coder-7B-Instruct',
];

/**
 * Searches common locations for the Antigravity CLI binary (`agy`).
 */
export function findAgyBinary(): string | null {
  if (process.env.ANTIGRAVITY_AGENTAPI_EXE && fs.existsSync(process.env.ANTIGRAVITY_AGENTAPI_EXE)) {
    return process.env.ANTIGRAVITY_AGENTAPI_EXE;
  }

  const home = process.env.HOME || '';
  const candidates = [
    path.join(home, '.local', 'bin', 'agy'),
    '/usr/local/bin/agy',
    '/usr/bin/agy',
    path.join(home, '.gemini', 'antigravity-cli', 'bin', 'agy'),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  try {
    const which = execSync('which agy 2>/dev/null', { encoding: 'utf-8' }).trim();
    if (which && fs.existsSync(which)) {
      return which;
    }
  } catch {}

  return null;
}

/**
 * Checks if Ollama is running and retrieves installed models.
 */
export async function checkOllamaStatus(customUrl?: string): Promise<{
  available: boolean;
  models: string[];
  baseUrl: string;
}> {
  const baseUrl = (customUrl || process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/+$/, '');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data: any = await res.json();
      const tags = (data.models || []).map((m: any) => m.name || m.model).filter(Boolean);
      return {
        available: true,
        models: tags.length > 0 ? tags : DEFAULT_OLLAMA_MODELS,
        baseUrl,
      };
    }
  } catch {}

  return {
    available: false,
    models: DEFAULT_OLLAMA_MODELS,
    baseUrl,
  };
}

/**
 * Checks if vLLM is running and retrieves served models.
 */
export async function checkVllmStatus(customUrl?: string): Promise<{
  available: boolean;
  models: string[];
  baseUrl: string;
}> {
  const baseUrl = (customUrl || process.env.VLLM_BASE_URL || 'http://localhost:8000').replace(/\/+$/, '');

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);

    const res = await fetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data: any = await res.json();
      const models = (data.data || []).map((m: any) => m.id).filter(Boolean);
      return {
        available: true,
        models: models.length > 0 ? models : DEFAULT_VLLM_MODELS,
        baseUrl,
      };
    }
  } catch {}

  return {
    available: false,
    models: DEFAULT_VLLM_MODELS,
    baseUrl,
  };
}

/**
 * Returns current status, binary path, and models for all supported providers:
 * Antigravity (agy), Ollama, and vLLM.
 */
export async function getAntigravityEngineStatus(endpoints?: {
  ollama?: string;
  vllm?: string;
}): Promise<AntigravityEngineStatus> {
  const binary = findAgyBinary();
  const agyAvailable = Boolean(binary);
  const version = process.env.ANTIGRAVITY_LS_VERSION || 'cli-2.17.0';

  const [ollamaStatus, vllmStatus] = await Promise.all([
    checkOllamaStatus(endpoints?.ollama),
    checkVllmStatus(endpoints?.vllm),
  ]);

  const providers: Record<AIProvider, AIProviderInfo> = {
    antigravity: {
      id: 'antigravity',
      name: 'Google Antigravity (AGY)',
      available: agyAvailable,
      models: DEFAULT_ANTIGRAVITY_MODELS,
      defaultModel: 'gemini-3.8-flash-high',
    },
    ollama: {
      id: 'ollama',
      name: 'Ollama (Local / On-Prem)',
      available: ollamaStatus.available,
      baseUrl: ollamaStatus.baseUrl,
      models: ollamaStatus.models,
      defaultModel: ollamaStatus.models[0] || 'llama3:latest',
    },
    vllm: {
      id: 'vllm',
      name: 'vLLM (High-Throughput)',
      available: vllmStatus.available,
      baseUrl: vllmStatus.baseUrl,
      models: vllmStatus.models,
      defaultModel: vllmStatus.models[0] || 'meta-llama/Meta-Llama-3-8B-Instruct',
    },
  };

  return {
    available: agyAvailable || ollamaStatus.available || vllmStatus.available,
    binaryPath: binary || undefined,
    version,
    defaultProvider: agyAvailable ? 'antigravity' : ollamaStatus.available ? 'ollama' : 'antigravity',
    defaultModel: 'gemini-3.8-flash-high',
    availableModels: DEFAULT_ANTIGRAVITY_MODELS,
    providers,
    platform: process.platform,
  };
}
