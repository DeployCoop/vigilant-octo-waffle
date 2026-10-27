'use client';

import { useState, useEffect } from 'react';
import {
  ShieldCheck,
  FileCode,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Play,
  Copy,
  Check,
  Sliders,
  Sparkles,
} from 'lucide-react';

interface AdmissionPolicyRule {
  id: string;
  name: string;
  category: 'SECURITY' | 'RELIABILITY' | 'BEST_PRACTICES';
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  description: string;
  ruleType: 'VALIDATING' | 'MUTATING';
  enabled: boolean;
}

interface EvaluationFinding {
  ruleId: string;
  ruleName: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  passed: boolean;
  message: string;
  path?: string;
}

interface EvaluationResult {
  totalRules: number;
  passedRules: number;
  failedRules: number;
  score: number;
  compliant: boolean;
  findings: EvaluationFinding[];
  mutatedYaml?: string;
}

const SAMPLE_VULNERABLE_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: insecure-payment-service
  namespace: default
  labels:
    app: payment-service
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: payment-api
        image: payment-api:latest # BAD: mutable tag
        securityContext:
          privileged: true # BAD: root node access
        # BAD: missing resources limits
`;

const SAMPLE_SECURE_YAML = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: hardened-payment-service
  namespace: default
  labels:
    app: payment-service
    app.kubernetes.io/managed-by: vigilant-octo-waffle
spec:
  replicas: 2
  template:
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 10001
      containers:
      - name: payment-api
        image: payment-api:v2.4.1
        securityContext:
          privileged: false
          readOnlyRootFilesystem: true
        resources:
          limits:
            cpu: 500m
            memory: 512Mi
          requests:
            cpu: 100m
            memory: 128Mi
`;

export default function GuardStudioPage() {
  const [policies, setPolicies] = useState<AdmissionPolicyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [yamlInput, setYamlInput] = useState(SAMPLE_VULNERABLE_YAML);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [copied, setCopied] = useState(false);

  const fetchPolicies = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/guard');
      const data = await res.json();
      setPolicies(data.policies || []);
    } catch (err) {
      console.error('Failed to load admission policies:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  const handleEvaluate = async () => {
    setEvaluating(true);
    try {
      const res = await fetch('/api/guard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yaml: yamlInput }),
      });
      const data = await res.json();
      if (data.success) {
        setEvaluation(data.evaluation);
      }
    } catch (err) {
      console.error('Evaluation failed:', err);
    } finally {
      setEvaluating(false);
    }
  };

  const handleToggle = async (ruleId: string, currentEnabled: boolean) => {
    try {
      const res = await fetch('/api/guard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', ruleId, enabled: !currentEnabled }),
      });
      const data = await res.json();
      if (data.success) {
        fetchPolicies();
      }
    } catch (err) {
      console.error('Toggle failed:', err);
    }
  };

  const handleCopy = () => {
    if (evaluation?.mutatedYaml) {
      navigator.clipboard.writeText(evaluation.mutatedYaml);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
            <ShieldCheck className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">OctoGuard: Kyverno & OPA Admission Governance</h1>
            <p className="text-sm text-slate-400">
              Pre-admission validating and mutating webhook enforcement, Pod Security Standards, and auto-mutation sandbox
            </p>
          </div>
        </div>

        <button
          onClick={fetchPolicies}
          disabled={loading}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Rules</span>
        </button>
      </div>

      {/* Rules Summary Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Active Admission Rules</div>
          <div className="text-2xl font-bold text-emerald-400">{policies.filter((p) => p.enabled).length} / {policies.length}</div>
          <div className="text-[11px] text-slate-500 mt-1">Pod Security Standards</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Enforcement Mode</div>
          <div className="text-2xl font-bold text-sky-400">Strict Webhook</div>
          <div className="text-[11px] text-slate-500 mt-1">Intercepts kubectl & Helm</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Auto-Mutating Webhooks</div>
          <div className="text-2xl font-bold text-violet-400">Enabled</div>
          <div className="text-[11px] text-slate-500 mt-1">Auto-injects labels & rootfs</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Admission Sandbox</div>
          <div className="text-2xl font-bold text-amber-400">Ready</div>
          <div className="text-[11px] text-slate-500 mt-1">Pre-flight manifest evaluator</div>
        </div>
      </div>

      {/* Interactive Manifest Evaluation Sandbox */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Manifest Editor */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-4 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center space-x-2">
                <FileCode className="w-4 h-4 text-sky-400" />
                <h2 className="text-sm font-semibold text-slate-200">Admission Manifest Sandbox</h2>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => { setYamlInput(SAMPLE_VULNERABLE_YAML); setEvaluation(null); }}
                  className="px-2.5 py-1 text-[11px] rounded bg-slate-800 text-rose-300 hover:bg-slate-700"
                >
                  Load Vulnerable Spec
                </button>
                <button
                  onClick={() => { setYamlInput(SAMPLE_SECURE_YAML); setEvaluation(null); }}
                  className="px-2.5 py-1 text-[11px] rounded bg-slate-800 text-emerald-300 hover:bg-slate-700"
                >
                  Load Hardened Spec
                </button>
              </div>
            </div>

            <textarea
              value={yamlInput}
              onChange={(e) => setYamlInput(e.target.value)}
              rows={14}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-200 outline-none focus:border-sky-500 leading-relaxed"
            />
          </div>

          <div>
            <button
              onClick={handleEvaluate}
              disabled={evaluating}
              className="w-full flex items-center justify-center space-x-2 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              {evaluating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
              <span>Evaluate Admission Rules</span>
            </button>
          </div>
        </div>

        {/* Right: Evaluation Results & Auto-Mutation */}
        <div className="space-y-4">
          {evaluation ? (
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-4">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <div className="flex items-center space-x-2">
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                      evaluation.compliant
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    }`}
                  >
                    {evaluation.compliant ? 'ADMISSION ACCEPTED' : 'ADMISSION REJECTED'}
                  </span>
                  <span className="text-xs font-mono text-slate-400">Score: {evaluation.score}%</span>
                </div>
                <div className="text-xs text-slate-400 font-mono">
                  {evaluation.passedRules} Passed / {evaluation.failedRules} Failed
                </div>
              </div>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {evaluation.findings.map((f, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-lg border text-xs flex items-start space-x-2.5 ${
                      f.passed
                        ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                        : 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                    }`}
                  >
                    {f.passed ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    )}
                    <div className="flex-1">
                      <div className="font-semibold text-[11px]">{f.ruleName}</div>
                      <div className="text-[11px] opacity-90 mt-0.5">{f.message}</div>
                    </div>
                  </div>
                ))}
              </div>

              {evaluation.mutatedYaml && (
                <div className="space-y-2 pt-3 border-t border-slate-800">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400 font-mono flex items-center space-x-1 text-[11px]">
                      <Sparkles className="w-3 h-3 text-violet-400" />
                      <span>Auto-Mutated Hardened Manifest (Ready to Apply)</span>
                    </span>
                    <button
                      onClick={handleCopy}
                      className="flex items-center space-x-1 text-slate-400 hover:text-slate-200"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span className="text-[11px]">{copied ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl overflow-x-auto text-violet-300 font-mono text-[11px] leading-relaxed max-h-48">
                    {evaluation.mutatedYaml}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 bg-slate-900/40 border border-slate-800 rounded-2xl text-center text-slate-500 text-xs">
              Click &quot;Evaluate Admission Rules&quot; to test your manifest against Kyverno & OPA policies.
            </div>
          )}
        </div>
      </div>

      {/* Rules Registry Table */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Sliders className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-200">Active Admission Webhook Governance Rules</h2>
          </div>
          <span className="text-xs text-slate-500 font-mono">{policies.length} Rules Defined</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider border-b border-slate-800 font-medium">
              <tr>
                <th className="px-4 py-3">Rule Identifier</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Webhook Type</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {policies.map((rule) => (
                <tr key={rule.id} className="hover:bg-slate-900/40 transition">
                  <td className="px-4 py-3 font-mono font-medium text-slate-200">{rule.name}</td>
                  <td className="px-4 py-3 text-slate-400">{rule.category}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-sky-400">{rule.ruleType}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${
                        rule.severity === 'HIGH'
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                      }`}
                    >
                      {rule.severity}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-[11px] max-w-xs">{rule.description}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleToggle(rule.id, rule.enabled)}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition ${
                        rule.enabled
                          ? 'bg-emerald-600/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-800 text-slate-400 border border-slate-700'
                      }`}
                    >
                      {rule.enabled ? 'Enforcing' : 'Disabled'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
