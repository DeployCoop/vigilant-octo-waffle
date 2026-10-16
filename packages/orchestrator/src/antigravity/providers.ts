/**
 * AI provider detection and status: agy binary, Ollama, vLLM, model defaults (WS6 split of antigravity.ts).
 * Behavior-preserving file motion only — see the WS6 decomposition PR.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { type AIProvider, type AIProviderInfo, type AntigravityEngineStatus } from './types.js';

/**
 * Strips trailing slashes without a regex: /\/+$/ backtracks quadratically
 * on slash-heavy input (CodeQL js/polynomial-redos).
 */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

/**
 * Whether a caller-supplied model endpoint may be fetched server-side.
 * Status checks run with a low-privilege principal, so a custom endpoint is
 * an SSRF primitive unless it is confined to the operator's own machine and
 * LAN: http/https only, loopback / RFC1918 / unique-local addresses, or a
 * local-style hostname (single-label, .local/.lan/.internal/.home/.svc).
 * Public hosts and link-local/metadata addresses (169.254.0.0/16,
 * fe80::/10) are rejected. Operator-configured env endpoints are trusted
 * and do not pass through here.
 */
/**
 * Plan II §4.1 (§16 Q1): agy may skip its tool-call permission prompts only
 * when the operator explicitly opts in with VOW_AGY_SKIP_PERMISSIONS=1.
 * Default off — the same default-false rule the paperclip agy adapter uses.
 */
export function agySkipPermissionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VOW_AGY_SKIP_PERMISSIONS === '1';
}

export function isAllowedCustomEndpoint(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost') return true;
  if (!host.includes('.') && !host.includes(':')) return true;
  if (
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host.endsWith('.internal') ||
    host.endsWith('.home') ||
    host.endsWith('.svc') ||
    host.endsWith('.cluster.local')
  ) {
    return true;
  }
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    if (v4.slice(1).some((octet) => Number(octet) > 255)) return false;
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (host.includes(':')) {
    if (host === '::1') return true;
    const first = parseInt(host.split(':')[0] || '0', 16);
    return (first & 0xfe00) === 0xfc00;
  }
  return false;
}


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
  if (customUrl && !isAllowedCustomEndpoint(customUrl)) {
    return { available: false, models: [], baseUrl: stripTrailingSlashes(customUrl) };
  }
  const baseUrl = stripTrailingSlashes(customUrl || process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434');

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
  if (customUrl && !isAllowedCustomEndpoint(customUrl)) {
    return { available: false, models: [], baseUrl: stripTrailingSlashes(customUrl) };
  }
  const baseUrl = stripTrailingSlashes(customUrl || process.env.VLLM_BASE_URL || 'http://localhost:8000');

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
      skipPermissions: agySkipPermissionsEnabled(),
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
