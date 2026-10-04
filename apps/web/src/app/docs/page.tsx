'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Ship,
  FolderOpen,
  FileCode,
  Code,
  Terminal,
  Copy,
  Check,
  Play,
  Layers,
  Settings,
  Server,
  HardDrive,
  Lock,
  Network,
  ChevronRight,
  ExternalLink,
  Sparkles,
  Search,
  CheckCircle2,
  AlertCircle,
  Info,
  ShieldCheck,
  RefreshCw,
  Cpu,
  Zap,
} from 'lucide-react';
import { useTerminal } from '@/context/TerminalContext';
import { copyToClipboard } from '@/lib/clipboard';

interface DocSection {
  id: string;
  title: string;
  category: string;
  icon: any;
  keywords: string[];
}

const SECTIONS: DocSection[] = [
  // Custom Charts (Featured)
  { id: 'custom-charts-overview', title: 'Overview & Auto-Discovery', category: 'Custom & Local Charts', icon: Ship, keywords: ['local', 'custom', 'helm', 'discovery', 'catalog', 'apps'] },
  { id: 'custom-charts-directory', title: 'Configuring Directory Path', category: 'Custom & Local Charts', icon: FolderOpen, keywords: ['THIS_CHARTS_DIR', 'env', 'path', 'directory', 'folder', 'configure'] },
  { id: 'custom-charts-structure', title: 'Required Directory Layout', category: 'Custom & Local Charts', icon: Layers, keywords: ['structure', 'layout', 'files', 'hierarchy', 'templates'] },
  { id: 'custom-charts-chart-yaml', title: 'Writing Chart.yaml', category: 'Custom & Local Charts', icon: FileCode, keywords: ['chart.yaml', 'metadata', 'version', 'appVersion', 'icon', 'description'] },
  { id: 'custom-charts-values-yaml', title: 'Writing values.yaml', category: 'Custom & Local Charts', icon: Settings, keywords: ['values.yaml', 'defaults', 'configuration', 'overrides', 'replicas'] },
  { id: 'custom-charts-templates', title: 'Kubernetes Templates & Helpers', category: 'Custom & Local Charts', icon: Code, keywords: ['templates', 'deployment', 'service', '_helpers.tpl', 'helpers'] },
  { id: 'custom-charts-tls-ingress', title: 'TLS, Ingress & Domain Routing', category: 'Custom & Local Charts', icon: Lock, keywords: ['tls', 'ingress', 'mkcert', 'cert-manager', 'traefik', 'domain'] },
  { id: 'custom-charts-storage', title: 'Storage & Persistent Volumes', category: 'Custom & Local Charts', icon: HardDrive, keywords: ['storage', 'pvc', 'local-path', 'openebs', 'volumes'] },
  { id: 'custom-charts-lint-template', title: 'Linting & Dry-Run Preview', category: 'Custom & Local Charts', icon: ShieldCheck, keywords: ['lint', 'helm lint', 'template', 'helm template', 'dry run'] },
  { id: 'custom-charts-deploy', title: 'Deploying & Managing Releases', category: 'Custom & Local Charts', icon: Play, keywords: ['deploy', 'install', 'upgrade', 'web ui', 'cli', 'release'] },
  { id: 'custom-charts-examples', title: 'Included Reference Examples', category: 'Custom & Local Charts', icon: Sparkles, keywords: ['sample-app', 'static-site', 'example.charts', 'scaffold'] },
  { id: 'custom-charts-troubleshooting', title: 'Troubleshooting & FAQ', category: 'Custom & Local Charts', icon: AlertCircle, keywords: ['troubleshooting', 'error', 'flannel', 'docker', '400', 'pause'] },

  // Architecture
  { id: 'arch-overview', title: 'Architecture & Core Loop', category: 'Platform Architecture', icon: Server, keywords: ['architecture', 'kind', 'k3s', 'envsubst', 'core loop'] },
  { id: 'arch-multinode', title: 'K3s Multi-Node & SSH Provisioning', category: 'Platform Architecture', icon: Network, keywords: ['k3s', 'multi-node', 'agent', 'server', 'ha', 'ssh', 'join'] },

  // GitOps
  { id: 'gitops-runners', title: 'ArgoCD vs FluxCD Dual-Runner', category: 'GitOps Engines', icon: Zap, keywords: ['gitops', 'argocd', 'flux', 'runner', 'synthesis', 'overrides'] },
  { id: 'gitops-enablers', title: '45+ Built-in Application Enablers', category: 'GitOps Engines', icon: Layers, keywords: ['apps', 'catalog', 'enablers', 'presets', 'keycloak', 'nextcloud'] },

  // CLI
  { id: 'cli-reference', title: 'CLI Reference & Scripts', category: 'CLI & Automation', icon: Terminal, keywords: ['cli', './up', './down', 'scripts', 'status.sh', 'newApp.sh'] },
  { id: 'cli-env', title: 'Environment Variables (.env)', category: 'CLI & Automation', icon: Settings, keywords: ['env', 'default.env', 'variables', 'config'] },
];

export default function DocumentationPage() {
  const { openTerminal } = useTerminal();
  const [activeSection, setActiveSection] = useState<string>('custom-charts-overview');
  const [search, setSearch] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [runningCmd, setRunningCmd] = useState<string | null>(null);

  // Sync hash from URL if present
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.replace('#', '');
      const match = SECTIONS.find((s) => s.id === hash);
      if (match) {
        setActiveSection(match.id);
        const el = document.getElementById(match.id);
        if (el) el.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, []);

  const handleCopy = async (text: string, key: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    }
  };

  const handleRunCommand = async (cmd: string) => {
    setRunningCmd(cmd);
    try {
      const parts = cmd.trim().split(/\s+/);
      const command = parts[0];
      const args = parts.slice(1);

      const res = await fetch('/api/tasks/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, args }),
      });
      const data = await res.json();
      if (data.taskId) {
        openTerminal(data.taskId, cmd);
      }
    } catch {
      // transient
    } finally {
      setRunningCmd(null);
    }
  };

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    if (typeof window !== 'undefined') {
      window.history.pushState(null, '', `#${id}`);
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  };

  const filteredSections = SECTIONS.filter((s) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      s.category.toLowerCase().includes(q) ||
      s.keywords.some((k) => k.toLowerCase().includes(q))
    );
  });

  const categories = Array.from(new Set(SECTIONS.map((s) => s.category)));

  // Helper Code Block Component
  const CodeBlock = ({
    code,
    language = 'bash',
    id,
    allowRun = false,
  }: {
    code: string;
    language?: string;
    id: string;
    allowRun?: boolean;
  }) => {
    const isCopied = copiedKey === id;
    const isRunning = runningCmd === code;

    return (
      <div className="my-3 rounded-xl border border-slate-800 bg-slate-950 overflow-hidden shadow-sm">
        <div className="flex items-center justify-between px-3.5 py-1.5 bg-slate-900/90 border-b border-slate-800 text-[11px] font-mono">
          <span className="font-semibold text-slate-400 uppercase tracking-wider">{language}</span>
          <div className="flex items-center space-x-2">
            {allowRun && (
              <button
                onClick={() => handleRunCommand(code)}
                disabled={isRunning}
                className="flex items-center space-x-1 px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white font-sans text-[10px] transition-colors cursor-pointer"
                title={`Run command in live terminal: ${code}`}
              >
                <Play className={`w-2.5 h-2.5 fill-current ${isRunning ? 'animate-spin' : ''}`} />
                <span>{isRunning ? 'Running...' : 'Run in Terminal'}</span>
              </button>
            )}
            <button
              onClick={() => handleCopy(code, id)}
              className="flex items-center space-x-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-sans text-[10px] transition-colors cursor-pointer"
              title="Copy snippet"
            >
              {isCopied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>
        <pre className="p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8 pb-20">
      {/* Top Hero Banner */}
      <div className="p-6 md:p-8 bg-gradient-to-r from-slate-900 via-slate-900 to-sky-950/40 border border-slate-800 rounded-2xl relative overflow-hidden shadow-lg">
        <div className="relative z-10 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded-full text-xs font-semibold flex items-center space-x-1.5">
              <BookOpen className="w-3.5 h-3.5" />
              <span>Platform Documentation & Field Guide</span>
            </span>
            <span className="px-2.5 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full text-xs font-mono">
              Helm 3 • K3s • KinD • ArgoCD • FluxCD
            </span>
          </div>

          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Vigilant Octo Waffle Knowledge Base
          </h1>
          <p className="text-sm md:text-base text-slate-300 max-w-3xl leading-relaxed">
            Everything you need to build, test, and deploy workloads. Learn how to configure your own local Helm charts directory, architect production-grade manifests with automatic TLS, and operate multi-node GitOps clusters.
          </p>

          {/* Quick jump highlights */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              onClick={() => scrollToSection('custom-charts-overview')}
              className="text-xs px-3 py-1.5 bg-sky-600/90 hover:bg-sky-500 text-white rounded-lg flex items-center space-x-1.5 transition-colors font-medium shadow-sm"
            >
              <Ship className="w-3.5 h-3.5" />
              <span>Custom Helm Charts Guide</span>
            </button>
            <Link
              href="/helm"
              className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg flex items-center space-x-1.5 transition-colors font-medium"
            >
              <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
              <span>Open Helm Hub UI</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </Link>
            <Link
              href="/apps"
              className="text-xs px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg flex items-center space-x-1.5 transition-colors font-medium"
            >
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>Browse App Store</span>
              <ExternalLink className="w-3 h-3 text-slate-400" />
            </Link>
          </div>
        </div>

        {/* Decorative background glow */}
        <div className="absolute right-0 top-0 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl pointer-events-none" />
      </div>

      {/* Main Grid: Sidebar Navigator + Content Area */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8 items-start">
        {/* LEFT COLUMN: Table of Contents & Search */}
        <div className="lg:col-span-1 space-y-4 sticky top-20 bg-slate-950 z-10 p-1">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            <input
              type="text"
              placeholder="Search documentation..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition-colors"
            />
          </div>

          {/* Navigation Tree */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-3 space-y-4 max-h-[calc(100vh-180px)] overflow-y-auto">
            {categories.map((cat) => {
              const catSections = filteredSections.filter((s) => s.category === cat);
              if (catSections.length === 0) return null;

              return (
                <div key={cat} className="space-y-1.5">
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider px-2 flex items-center space-x-1.5">
                    {cat === 'Custom & Local Charts' && <Ship className="w-3 h-3 text-sky-400" />}
                    {cat === 'Platform Architecture' && <Server className="w-3 h-3 text-emerald-400" />}
                    {cat === 'GitOps Engines' && <Zap className="w-3 h-3 text-indigo-400" />}
                    {cat === 'CLI & Automation' && <Terminal className="w-3 h-3 text-amber-400" />}
                    <span>{cat}</span>
                  </div>

                  <div className="space-y-0.5">
                    {catSections.map((sec) => {
                      const Icon = sec.icon;
                      const isActive = activeSection === sec.id;

                      return (
                        <button
                          key={sec.id}
                          onClick={() => scrollToSection(sec.id)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors ${
                            isActive
                              ? 'bg-sky-500/15 text-sky-300 font-semibold border border-sky-500/30'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                          }`}
                        >
                          <span className="truncate pr-1">{sec.title}</span>
                          <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-500'}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Support Card */}
          <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2 text-xs text-slate-400">
            <div className="flex items-center space-x-2 font-semibold text-slate-200">
              <Sparkles className="w-4 h-4 text-sky-400" />
              <span>Need Live Assistance?</span>
            </div>
            <p className="text-[11px] leading-relaxed">
              Use the Antigravity AI Copilot for interactive diagnostic remediation, architecture reviews, and manifest generation.
            </p>
            <Link
              href="/antigravity"
              className="text-[11px] font-semibold text-sky-400 hover:text-sky-300 flex items-center space-x-1 pt-1"
            >
              <span>Launch Antigravity Copilot</span>
              <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>

        {/* RIGHT COLUMN: Full Documentation Content */}
        <div className="lg:col-span-3 space-y-12">
          {/* ========================================================================= */}
          {/* CATEGORY 1: CUSTOM & LOCAL HELM CHARTS (FEATURED)                         */}
          {/* ========================================================================= */}

          {/* Section: Overview */}
          <section id="custom-charts-overview" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Ship className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Custom & Local Helm Charts: Overview & Auto-Discovery
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Vigilant Octo Waffle features a native <strong>Local Helm Chart Engine</strong>. Instead of publishing charts to an external Helm repository or pushing images to a remote registry, you can point the platform to <strong>any local directory</strong> on your host machine or repo.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-2">
              <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2">
                <div className="flex items-center space-x-2 text-sky-400 text-xs font-bold uppercase tracking-wider">
                  <Layers className="w-4 h-4" />
                  <span>1. Automatic Cataloging</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Every folder with a valid <code className="text-sky-300">Chart.yaml</code> is indexed into the <strong>App Store</strong> under the <em>&quot;Custom & Local Charts&quot;</em> category with metadata, icons, and status badges.
                </p>
              </div>

              <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2">
                <div className="flex items-center space-x-2 text-indigo-400 text-xs font-bold uppercase tracking-wider">
                  <ShieldCheck className="w-4 h-4" />
                  <span>2. In-Browser Lint & Dry-Run</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Validate charts on the fly using integrated <code className="text-sky-300">helm lint</code> and preview rendered Kubernetes manifests with <code className="text-sky-300">helm template</code> before applying to the cluster.
                </p>
              </div>

              <div className="p-4 bg-slate-900/80 border border-slate-800 rounded-xl space-y-2">
                <div className="flex items-center space-x-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                  <Play className="w-4 h-4" />
                  <span>3. 1-Click Deploy & Pop-Out Console</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Deploy instantly with customized values, target namespaces, and real-time streaming output in the pop-out terminal modal.
                </p>
              </div>
            </div>

            <div className="p-4 bg-sky-950/30 border border-sky-800/60 rounded-xl flex items-start space-x-3 text-xs text-sky-200">
              <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
              <div>
                <strong>Out-of-the-box Ready:</strong> Vigilant Octo Waffle ships with a default <code className="font-mono text-sky-300">./charts</code> directory pre-populated with a reference microservice chart (<code className="font-mono text-sky-300">sample-app</code>), plus an extensive reference directory at <code className="font-mono text-sky-300">example.charts/</code>.
              </div>
            </div>
          </section>

          {/* Section: Configuring Directory Path */}
          <section id="custom-charts-directory" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <FolderOpen className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Configuring the Charts Directory Path
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              The charts directory can be set to <strong>any valid filesystem path</strong>. Both relative paths (relative to the repository root) and absolute paths (anywhere on your system) are fully supported.
            </p>

            <h3 className="text-sm font-semibold text-slate-200 pt-2">Method A: Through the Web UI (Helm Hub)</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              1. Open the <Link href="/helm" className="text-sky-400 underline">Helm Hub</Link>.<br />
              2. In the <strong>Configured Charts Directory</strong> box, type your directory path (e.g. <code className="font-mono text-slate-300">./charts</code>, <code className="font-mono text-slate-300">./example.charts</code>, or <code className="font-mono text-slate-300">/opt/custom-charts</code>).<br />
              3. Click <strong>Apply Directory</strong>. The platform creates the directory if it does not exist, saves the path to <code className="font-mono text-slate-300">.env</code>, and immediately refreshes the chart catalog.
            </p>

            <h3 className="text-sm font-semibold text-slate-200 pt-2">Method B: Via Environment Variable in `.env`</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              You can declare the directory in your root <code className="font-mono text-slate-300">.env</code> or <code className="font-mono text-slate-300">src/default.env</code> using the <code className="font-mono text-sky-300">THIS_CHARTS_DIR</code> variable:
            </p>

            <CodeBlock
              id="env-charts-dir"
              language="bash"
              code={`# Relative to repo root:
THIS_CHARTS_DIR="./charts"

# Or point to the included reference directory:
THIS_CHARTS_DIR="./example.charts"

# Or an absolute path on your host:
THIS_CHARTS_DIR="/home/developer/helm-charts"`}
            />
          </section>

          {/* Section: Required Directory Layout */}
          <section id="custom-charts-structure" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Layers className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Required Directory Layout & Folder Hierarchy
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Each chart must reside inside its own folder directly within your configured <code className="text-sky-300 font-mono">THIS_CHARTS_DIR</code>. Helm 3 conventions are strictly followed:
            </p>

            <CodeBlock
              id="dir-tree"
              language="text"
              code={`charts/ (or whatever path is set in THIS_CHARTS_DIR)
├── sample-app/                 # Folder name (also serves as default ID)
│   ├── Chart.yaml              # REQUIRED: Chart metadata, version & description
│   ├── values.yaml             # REQUIRED: Default configurable values
│   ├── templates/              # REQUIRED: Kubernetes manifest templates
│   │   ├── _helpers.tpl        # Template helper definitions (labels, names)
│   │   ├── deployment.yaml     # Workload Deployment or StatefulSet
│   │   ├── service.yaml        # Service definition (ClusterIP / NodePort)
│   │   ├── ingress.yaml        # Ingress route with automatic TLS certs
│   │   ├── configmap.yaml      # Environment configs or static files
│   │   ├── serviceaccount.yaml # Pod RBAC service account
│   │   └── NOTES.txt           # Informational instructions printed after install
│   └── README.md               # Optional: In-depth chart documentation
└── static-site/                # Additional charts in adjacent folders...
    ├── Chart.yaml
    ├── values.yaml
    └── templates/`}
            />

            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2 text-xs text-slate-300">
              <h4 className="font-semibold text-slate-100 flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Validation Requirements</span>
              </h4>
              <ul className="list-disc list-inside space-y-1 text-slate-400">
                <li>The directory must contain a readable <code className="text-slate-200">Chart.yaml</code> file with <code className="text-slate-200">apiVersion: v2</code>.</li>
                <li>The <code className="text-slate-200">templates/</code> directory must exist and contain at least one <code className="text-slate-200">.yaml</code> manifest or <code className="text-slate-200">_helpers.tpl</code>.</li>
                <li>A <code className="text-slate-200">values.yaml</code> file should provide default values for all templated parameters.</li>
              </ul>
            </div>
          </section>

          {/* Section: Writing Chart.yaml */}
          <section id="custom-charts-chart-yaml" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <FileCode className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Writing `Chart.yaml`: Metadata Specification
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              The <code className="text-sky-300 font-mono">Chart.yaml</code> file provides the identity and UI presentation for your application in Vigilant Octo Waffle:
            </p>

            <CodeBlock
              id="chart-yaml-example"
              language="yaml"
              code={`apiVersion: v2
name: sample-app
version: 1.0.0
appVersion: "1.0.0"
description: "High-performance NGINX microservice with health probes and TLS ingress"
type: application
keywords:
  - web
  - api
  - nginx
  - microservice
home: "https://github.com/thoth77/vigilant-octo-waffle"
icon: "https://raw.githubusercontent.com/walkxcode/dashboard-icons/main/svg/nginx.svg"
maintainers:
  - name: "DevOps Team"
    email: "devops@example.com"`}
            />

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300 border border-slate-800 rounded-lg overflow-hidden">
                <thead className="bg-slate-900 border-b border-slate-800 text-slate-200 font-semibold">
                  <tr>
                    <th className="px-4 py-2.5">Field</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Description & Platform Behavior</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/60">
                  <tr>
                    <td className="px-4 py-2 font-mono text-sky-300">apiVersion</td>
                    <td className="px-4 py-2 font-mono text-slate-400">string</td>
                    <td className="px-4 py-2">Must be <code className="text-slate-200">v2</code> for Helm 3.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-sky-300">name</td>
                    <td className="px-4 py-2 font-mono text-slate-400">string</td>
                    <td className="px-4 py-2">Unique identifier in kebab-case. Used as application ID in <code className="text-slate-200">/apps/&lt;name&gt;</code>.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-sky-300">version</td>
                    <td className="px-4 py-2 font-mono text-slate-400">string</td>
                    <td className="px-4 py-2">SemVer chart package version (e.g. <code className="text-slate-200">1.0.0</code>). Displayed on card badges.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-sky-300">appVersion</td>
                    <td className="px-4 py-2 font-mono text-slate-400">string</td>
                    <td className="px-4 py-2">Version of the containerized workload software. Displayed in app details.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-sky-300">description</td>
                    <td className="px-4 py-2 font-mono text-slate-400">string</td>
                    <td className="px-4 py-2">Card summary shown in both App Store and Helm Hub.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-sky-300">keywords</td>
                    <td className="px-4 py-2 font-mono text-slate-400">string[]</td>
                    <td className="px-4 py-2">Tag chips for rapid search filtering in the catalog.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-sky-300">icon</td>
                    <td className="px-4 py-2 font-mono text-slate-400">string</td>
                    <td className="px-4 py-2">URL to SVG/PNG logo, or a Lucide icon name (e.g. <code className="text-slate-200">Ship</code>, <code className="text-slate-200">Boxes</code>).</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Section: Writing values.yaml */}
          <section id="custom-charts-values-yaml" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Settings className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Writing `values.yaml`: Defaults & Resource Sizing
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              The <code className="text-sky-300 font-mono">values.yaml</code> file provides default values that can be customized in the UI modal before deployment, or persistently overridden via <code className="text-sky-300 font-mono">.chart_overrides/&lt;app&gt;/values.yaml</code>.
            </p>

            <CodeBlock
              id="values-yaml-example"
              language="yaml"
              code={`replicaCount: 1

image:
  repository: nginx
  pullPolicy: IfNotPresent
  tag: "alpine"

service:
  type: ClusterIP
  port: 80
  targetPort: 80

ingress:
  enabled: true
  className: "traefik"
  issuer: "mkcert-issuer"    # Uses Vigilant Octo Waffle local CA
  host: "sample.cluster.local"
  path: /
  tls: true

resources:
  limits:
    cpu: 200m
    memory: 128Mi
  requests:
    cpu: 50m
    memory: 64Mi

probes:
  liveness:
    path: /
    initialDelaySeconds: 5
    periodSeconds: 10
  readiness:
    path: /
    initialDelaySeconds: 2
    periodSeconds: 5`}
            />

            <div className="p-4 bg-amber-950/30 border border-amber-800/60 rounded-xl text-xs text-amber-200 space-y-1">
              <div className="font-semibold flex items-center space-x-1.5">
                <Cpu className="w-4 h-4 text-amber-400" />
                <span>Laptop RAM Profiler Integration</span>
              </div>
              <p className="text-amber-300 leading-relaxed">
                Always set explicit <code className="font-mono text-amber-100">resources.requests.memory</code> in your <code className="font-mono text-amber-100">values.yaml</code>. The App Store uses this to calculate total cluster RAM consumption and warn you before your laptop experiences memory exhaustion or OOM kills.
              </p>
            </div>
          </section>

          {/* Section: Kubernetes Manifest Templates */}
          <section id="custom-charts-templates" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Code className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Kubernetes Manifest Templates & Helpers
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Place all Kubernetes manifests inside the <code className="text-sky-300 font-mono">templates/</code> directory. Use standard Helm Go templating with helpers defined in <code className="text-sky-300 font-mono">_helpers.tpl</code>:
            </p>

            <h3 className="text-sm font-semibold text-slate-200">1. Standard `templates/_helpers.tpl`</h3>
            <CodeBlock
              id="helpers-tpl-example"
              language="gotemplate"
              code={`{{/*
Expand the name of the chart.
*/}}
{{- define "sample-app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "sample-app.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Standard Kubernetes Common Labels
*/}}
{{- define "sample-app.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
app.kubernetes.io/name: {{ include "sample-app.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}`}
            />

            <h3 className="text-sm font-semibold text-slate-200 pt-2">2. Production Deployment (`templates/deployment.yaml`)</h3>
            <CodeBlock
              id="deployment-yaml-example"
              language="yaml"
              code={`apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "sample-app.fullname" . }}
  labels:
    {{- include "sample-app.labels" . | nindent 4 }}
spec:
  replicas: {{ .Values.replicaCount }}
  selector:
    matchLabels:
      app.kubernetes.io/name: {{ include "sample-app.name" . }}
      app.kubernetes.io/instance: {{ .Release.Name }}
  template:
    metadata:
      labels:
        app.kubernetes.io/name: {{ include "sample-app.name" . }}
        app.kubernetes.io/instance: {{ .Release.Name }}
    spec:
      containers:
        - name: {{ .Chart.Name }}
          image: "{{ .Values.image.repository }}:{{ .Values.image.tag }}"
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          ports:
            - name: http
              containerPort: {{ .Values.service.targetPort }}
              protocol: TCP
          livenessProbe:
            httpGet:
              path: {{ .Values.probes.liveness.path }}
              port: http
            initialDelaySeconds: {{ .Values.probes.liveness.initialDelaySeconds }}
            periodSeconds: {{ .Values.probes.liveness.periodSeconds }}
          readinessProbe:
            httpGet:
              path: {{ .Values.probes.readiness.path }}
              port: http
            initialDelaySeconds: {{ .Values.probes.readiness.initialDelaySeconds }}
            periodSeconds: {{ .Values.probes.readiness.periodSeconds }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}`}
            />
          </section>

          {/* Section: TLS, Ingress & Domain Routing */}
          <section id="custom-charts-tls-ingress" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Lock className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                TLS, Ingress & Domain Routing Integration
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Vigilant Octo Waffle ships with **Traefik** as its Ingress Controller and **cert-manager** configured with a local Root Certificate Authority (<code className="text-sky-300 font-mono">mkcert-issuer</code>).
            </p>

            <p className="text-xs text-slate-400 leading-relaxed">
              To give your custom chart automatic, trusted HTTPS in your browser, configure your <code className="text-sky-300 font-mono">templates/ingress.yaml</code> with the <code className="text-sky-300 font-mono">cert-manager.io/cluster-issuer</code> annotation:
            </p>

            <CodeBlock
              id="ingress-yaml-example"
              language="yaml"
              code={`{{- if .Values.ingress.enabled -}}
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "sample-app.fullname" . }}
  labels:
    {{- include "sample-app.labels" . | nindent 4 }}
  annotations:
    cert-manager.io/cluster-issuer: {{ .Values.ingress.issuer | default "mkcert-issuer" | quote }}
    traefik.ingress.kubernetes.io/router.entrypoints: websecure
spec:
  ingressClassName: {{ .Values.ingress.className | default "traefik" }}
  tls:
    - hosts:
        - {{ .Values.ingress.host }}
      secretName: {{ include "sample-app.fullname" . }}-tls
  rules:
    - host: {{ .Values.ingress.host }}
      http:
        paths:
          - path: {{ .Values.ingress.path | default "/" }}
            pathType: Prefix
            backend:
              service:
                name: {{ include "sample-app.fullname" . }}
                port:
                  number: {{ .Values.service.port }}
{{- end }}`}
            />

            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2 text-xs text-slate-300">
              <span className="font-semibold text-slate-100">How Domain Resolution Works:</span>
              <ul className="list-disc list-inside space-y-1 text-slate-400">
                <li>By default, <code className="text-slate-200">*.cluster.local</code> or your custom domain resolves to the cluster ingress IP.</li>
                <li>The CLI script <code className="text-slate-200">src/hostr.sh</code> automatically updates your <code className="text-slate-200">/etc/hosts</code> file with custom subdomains.</li>
                <li>The <code className="text-slate-200">mkcert</code> CA is installed into your system and browser trust stores, so you get green HTTPS lock icons with zero SSL warnings.</li>
              </ul>
            </div>
          </section>

          {/* Section: Storage & Persistent Volumes */}
          <section id="custom-charts-storage" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <HardDrive className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Storage & Persistent Volumes
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Vigilant Octo Waffle provides high-performance local storage via the **Local Path Provisioner** and **OpenEBS LVM/Hostpath**.
            </p>

            <CodeBlock
              id="pvc-yaml-example"
              language="yaml"
              code={`apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: {{ include "sample-app.fullname" . }}-data
  labels:
    {{- include "sample-app.labels" . | nindent 4 }}
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: {{ .Values.storage.className | default "local-path" }}
  resources:
    requests:
      storage: {{ .Values.storage.size | default "2Gi" }}`}
            />
          </section>

          {/* Section: Linting & Dry-Run Preview */}
          <section id="custom-charts-lint-template" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <ShieldCheck className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Testing Charts: Linting & Dry-Run Template Preview
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Never deploy blind. You can test your charts directly in the Web UI or via the terminal.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-slate-200 flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>1. Linting (`helm lint`)</span>
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Checks for YAML syntax errors, missing <code className="text-slate-300">Chart.yaml</code> fields, and template discrepancies. In the Helm Hub UI, click the shield icon on any chart card.
                </p>
                <CodeBlock
                  id="cli-lint"
                  language="bash"
                  code="helm lint ./example.charts/sample-app"
                  allowRun
                />
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-slate-200 flex items-center space-x-2">
                  <Code className="w-4 h-4 text-indigo-400" />
                  <span>2. Template Rendering (`helm template`)</span>
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Renders all Go templates with default or custom values, producing the exact Kubernetes manifests that would be submitted to the cluster. In Helm Hub UI, click the code icon.
                </p>
                <CodeBlock
                  id="cli-template"
                  language="bash"
                  code="helm template sample-app ./example.charts/sample-app"
                  allowRun
                />
              </div>
            </div>
          </section>

          {/* Section: Deploying & Managing Releases */}
          <section id="custom-charts-deploy" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Play className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Deploying & Managing Releases
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Vigilant Octo Waffle offers three ways to deploy your local charts:
            </p>

            <div className="space-y-4 text-xs">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-sm font-semibold text-slate-100 flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-full bg-sky-600 text-white flex items-center justify-center text-[11px] font-bold">1</span>
                  <span>Deploy via Web UI (Helm Hub or App Store)</span>
                </h4>
                <p className="text-slate-400 leading-relaxed">
                  Navigate to <Link href="/helm" className="text-sky-400 underline">Helm Hub</Link> or the <Link href="/apps" className="text-sky-400 underline">App Store</Link>, find your chart, and click <strong>Deploy / Install</strong>.
                  A modal will appear allowing you to override the Release Name, Target Namespace, and edit the <code className="text-slate-300">values.yaml</code> in real time. Upon submitting, the <strong>Live Terminal Modal</strong> automatically pops open with streaming logs.
                </p>
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-sm font-semibold text-slate-100 flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[11px] font-bold">2</span>
                  <span>Deploy via CLI (`helm upgrade --install`)</span>
                </h4>
                <p className="text-slate-400 leading-relaxed">
                  You can deploy directly using the standard Helm CLI:
                </p>
                <CodeBlock
                  id="cli-deploy"
                  language="bash"
                  code="helm upgrade --install sample-app ./example.charts/sample-app --namespace default --create-namespace --wait --timeout 3m"
                  allowRun
                />
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-sm font-semibold text-slate-100 flex items-center space-x-2">
                  <span className="w-5 h-5 rounded-full bg-purple-600 text-white flex items-center justify-center text-[11px] font-bold">3</span>
                  <span>Check In-Cluster Releases & Inspect Values</span>
                </h4>
                <p className="text-slate-400 leading-relaxed">
                  Switch to the <strong>In-Cluster Releases</strong> tab in Helm Hub to view all deployed revisions, namespaces, and inspect raw deployed values with one click.
                </p>
                <CodeBlock
                  id="cli-helm-list"
                  language="bash"
                  code="helm list -A"
                  allowRun
                />
              </div>
            </div>
          </section>

          {/* Section: Included Reference Examples */}
          <section id="custom-charts-examples" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Sparkles className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Included Reference Examples in `example.charts/`
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Two complete, production-ready Helm 3 charts are included in the repository as templates you can inspect, copy, or adapt:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-100 font-mono">example.charts/sample-app</h4>
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-sky-950 text-sky-400 border border-sky-800/40 rounded">v1.0.0</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  A complete API microservice architecture featuring NGINX, configurable health probes (liveness & readiness), Traefik Ingress with TLS certificate issuance, ConfigMap injection, and Pod SecurityContext.
                </p>
                <div className="text-[11px] font-mono text-slate-500 space-y-1">
                  <div>• 5 templates: deployment, service, ingress, configmap, serviceaccount</div>
                  <div>• Validated with 0 lint errors</div>
                </div>
              </div>

              <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-slate-100 font-mono">example.charts/static-site</h4>
                  <span className="text-[10px] font-mono px-2 py-0.5 bg-indigo-950 text-indigo-400 border border-indigo-800/40 rounded">v1.0.0</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  A static website server showing how to mount custom HTML files from a Kubernetes ConfigMap into an NGINX container without rebuilding Docker images.
                </p>
                <div className="text-[11px] font-mono text-slate-500 space-y-1">
                  <div>• 4 templates: deployment, service, ingress, configmap</div>
                  <div>• Ideal for docs, landing pages, or mock backends</div>
                </div>
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <h4 className="text-xs font-semibold text-slate-200">How to Copy a Sample Chart into Your Active Directory:</h4>
              <CodeBlock
                id="copy-sample-cmd"
                language="bash"
                code="cp -r example.charts/sample-app ./charts/my-new-app"
                allowRun
              />
              <p className="text-xs text-slate-400">
                Or simply click the <strong>&quot;Populate Example Chart&quot;</strong> button on the <Link href="/helm" className="text-sky-400 underline">Helm Hub</Link> page.
              </p>
            </div>
          </section>

          {/* Section: Troubleshooting & FAQ */}
          <section id="custom-charts-troubleshooting" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <AlertCircle className="w-5 h-5 text-sky-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Troubleshooting & Common Pitfalls
              </h2>
            </div>

            <div className="space-y-4 text-xs">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                <h4 className="font-semibold text-rose-400">Chart Not Appearing in Catalog</h4>
                <p className="text-slate-400 leading-relaxed">
                  Ensure the chart folder contains a readable <code className="text-slate-200">Chart.yaml</code> file with lowercase name and <code className="text-slate-200">apiVersion: v2</code>. Also check that your <code className="text-slate-200">THIS_CHARTS_DIR</code> setting points to the parent folder containing chart subdirectories (not the chart folder itself).
                </p>
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                <h4 className="font-semibold text-amber-400">Docker Hub Rate Limits or `mirrored-pause:3.10.2: 400 Bad Request`</h4>
                <p className="text-slate-400 leading-relaxed">
                  In K3s or KinD on certain networks, unauthenticated pulls of pause images may trigger 400 or 429 errors from Docker Hub. You can pre-pull the image or configure a mirror in <code className="text-slate-200">/etc/rancher/k3s/registries.yaml</code>.
                </p>
                <CodeBlock
                  id="cli-docker-pause"
                  language="bash"
                  code="docker pull rancher/mirrored-pause:3.10.2 && k3s ctr images import ..."
                />
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                <h4 className="font-semibold text-amber-400">Flannel `subnet.env: no such file or directory`</h4>
                <p className="text-slate-400 leading-relaxed">
                  Occurs on fresh K3s baremetal node starts while the Flannel CNI pod is initializing. Kubelet waits until Flannel allocates the node&apos;s pod CIDR subnet. Verify Flannel daemonset status:
                </p>
                <CodeBlock
                  id="cli-flannel"
                  language="bash"
                  code="kubectl -n kube-system get pods -l app=flannel"
                  allowRun
                />
              </div>
            </div>
          </section>

          {/* ========================================================================= */}
          {/* CATEGORY 2: PLATFORM ARCHITECTURE                                        */}
          {/* ========================================================================= */}

          <section id="arch-overview" className="space-y-4 scroll-mt-24 pt-8 border-t border-slate-800">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Server className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Platform Architecture & The `envsubst` Core Loop
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Vigilant Octo Waffle provides a unified local Kubernetes development environment designed to reproduce production-like network topologies, GitOps pipelines, and TLS certificates directly on your laptop.
            </p>

            <CodeBlock
              id="arch-flow"
              language="text"
              code={`       [.env / .env.enabler]
                 │
                 ▼
          [envsubst template]
                 │
        ┌────────┼──────────────────────┐
        ▼        ▼                      ▼
   [init/]    [argo/ manifests]    [flux/ manifests]
        │        │                      │
        ▼        ▼                      ▼
  kubectl apply  ArgoCD App Create     FluxCD GitRepo / HelmRelease / Kustomization`}
            />

            <p className="text-xs text-slate-400 leading-relaxed">
              Environment variables from <code className="text-slate-200">.env</code> and <code className="text-slate-200">.env.enabler</code> are dynamically substituted into YAML manifests using <code className="text-slate-200">envsubst</code>. This allows seamless variable interpolation (such as hostnames, domains, storage classes, and credentials) across all applications.
            </p>
          </section>

          {/* Section: Multi-Node K3s */}
          <section id="arch-multinode" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Network className="w-5 h-5 text-emerald-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                K3s Multi-Node Architecture & Remote SSH Node Provisioner
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              When running K3s (<code className="text-sky-300 font-mono">THIS_K8S_TYPE=&quot;k3s&quot;</code>), you can expand from a single laptop control plane to a full baremetal or virtualized multi-node cluster.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                <h4 className="font-semibold text-slate-100">Worker (Agent) Node Joining</h4>
                <p className="text-slate-400 leading-relaxed">
                  Worker nodes execute user workloads. Generate join scripts or copy single-line curl commands from <Link href="/cluster" className="text-sky-400 underline">Cluster Control</Link> or run:
                </p>
                <CodeBlock
                  id="cli-add-node"
                  language="bash"
                  code="./up k3s:add-node --role agent"
                  allowRun
                />
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2">
                <h4 className="font-semibold text-slate-100">Automated Remote SSH Provisioning</h4>
                <p className="text-slate-400 leading-relaxed">
                  Provision and join remote machines non-interactively over SSH with automatic token distribution:
                </p>
                <CodeBlock
                  id="cli-ssh-join"
                  language="bash"
                  code="./up k3s:add-node --role agent --ssh ubuntu@192.168.1.50"
                  allowRun
                />
              </div>
            </div>
          </section>

          {/* ========================================================================= */}
          {/* CATEGORY 3: GITOPS DELIVERY (ARGOCD & FLUXCD)                             */}
          {/* ========================================================================= */}

          <section id="gitops-runners" className="space-y-4 scroll-mt-24 pt-8 border-t border-slate-800">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Zap className="w-5 h-5 text-indigo-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                GitOps Delivery: ArgoCD & FluxCD Dual-Runner Engine
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              Vigilant Octo Waffle supports both **ArgoCD** and **FluxCD** as first-class GitOps controllers. You can run either or both simultaneously via <code className="text-sky-300 font-mono">THIS_CD_RUNNER=&quot;argocd&quot; | &quot;flux&quot; | &quot;both&quot;</code>.
            </p>

            <div className="p-4 bg-slate-900 border border-slate-800 rounded-xl space-y-2 text-xs text-slate-300">
              <span className="font-semibold text-slate-100">Synthetic Flux Manifest Generation:</span>
              <p className="text-slate-400 leading-relaxed">
                If an application only has an <code className="text-slate-200">argo/&lt;app&gt;/argocd.yaml</code> manifest, the orchestrator and <code className="text-slate-200">fluxRunner.bash</code> automatically synthesize equivalent Flux <code className="text-slate-200">GitRepository</code>, <code className="text-slate-200">HelmRelease</code>, and <code className="text-slate-200">Kustomization</code> CRDs on the fly.
              </p>
            </div>
          </section>

          {/* Section: 45+ Enablers */}
          <section id="gitops-enablers" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Layers className="w-5 h-5 text-indigo-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                45+ Built-in Application Enablers
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              The platform includes production-hardened configurations for over 45 cloud-native applications:
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-xs font-mono">
              {[
                'ArgoCD', 'FluxCD', 'Keycloak', 'Harbor', 'Nextcloud',
                'Supabase', 'OpenProject', 'HashiCorp Vault', 'OpenBAO',
                'PostgreSQL', 'MySQL', 'MinIO S3', 'Traefik', 'cert-manager',
                'Prometheus', 'Grafana', 'Jaeger', 'Tempo', 'Loki',
                'OpenEBS', 'Longhorn', 'Cilium', 'Hubble', 'Calico',
                'Argo Rollouts', 'Chaos Mesh', 'Litmus', 'Sealed Secrets'
              ].map((app) => (
                <div key={app} className="p-2 bg-slate-900/60 border border-slate-800 rounded-lg text-slate-300 flex items-center space-x-1.5">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span className="truncate">{app}</span>
                </div>
              ))}
            </div>

            <p className="text-xs text-slate-400 pt-1">
              Toggle any application on or off in the <Link href="/apps" className="text-sky-400 underline">App Store</Link> or edit <code className="text-slate-300 font-mono">.env.enabler</code>.
            </p>
          </section>

          {/* ========================================================================= */}
          {/* CATEGORY 4: CLI REFERENCE                                                 */}
          {/* ========================================================================= */}

          <section id="cli-reference" className="space-y-4 scroll-mt-24 pt-8 border-t border-slate-800">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Terminal className="w-5 h-5 text-amber-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                CLI Reference & Automation Scripts
              </h2>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              The primary orchestrator CLI entrypoint is <code className="text-amber-300 font-mono">./up</code>:
            </p>

            <div className="space-y-3">
              <div>
                <span className="text-xs font-semibold text-slate-200">Start the Cluster & Deploy Enabled Workloads:</span>
                <CodeBlock id="cmd-up" language="bash" code="./up" allowRun />
              </div>

              <div>
                <span className="text-xs font-semibold text-slate-200">Deploy a Specific Target Application:</span>
                <CodeBlock id="cmd-up-app" language="bash" code="./up keycloak" allowRun />
              </div>

              <div>
                <span className="text-xs font-semibold text-slate-200">Check Cluster Health & Pod Status:</span>
                <CodeBlock id="cmd-status" language="bash" code="./status.sh" allowRun />
              </div>

              <div>
                <span className="text-xs font-semibold text-slate-200">Scaffold a New Application Template:</span>
                <CodeBlock id="cmd-newapp" language="bash" code="./newApp.sh my-service" allowRun />
              </div>
            </div>
          </section>

          {/* Section: Environment Variables */}
          <section id="cli-env" className="space-y-4 scroll-mt-24">
            <div className="flex items-center space-x-2 pb-2 border-b border-slate-800">
              <Settings className="w-5 h-5 text-amber-400" />
              <h2 className="text-xl font-bold text-white tracking-tight">
                Core Configuration Variables (`.env`)
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-300 border border-slate-800 rounded-lg overflow-hidden">
                <thead className="bg-slate-900 border-b border-slate-800 text-slate-200 font-semibold">
                  <tr>
                    <th className="px-4 py-2.5">Variable</th>
                    <th className="px-4 py-2.5">Default</th>
                    <th className="px-4 py-2.5">Description</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 bg-slate-950/60">
                  <tr>
                    <td className="px-4 py-2 font-mono text-amber-300">THIS_CHARTS_DIR</td>
                    <td className="px-4 py-2 font-mono text-slate-400">./charts</td>
                    <td className="px-4 py-2">Path to directory containing custom local Helm charts.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-amber-300">THIS_K8S_TYPE</td>
                    <td className="px-4 py-2 font-mono text-slate-400">kind</td>
                    <td className="px-4 py-2">Kubernetes runtime engine: <code className="text-slate-200">kind</code> or <code className="text-slate-200">k3s</code>.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-amber-300">THIS_CD_RUNNER</td>
                    <td className="px-4 py-2 font-mono text-slate-400">argocd</td>
                    <td className="px-4 py-2">Active GitOps runner: <code className="text-slate-200">argocd</code>, <code className="text-slate-200">flux</code>, or <code className="text-slate-200">both</code>.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-amber-300">THIS_DOMAIN</td>
                    <td className="px-4 py-2 font-mono text-slate-400">cluster.local</td>
                    <td className="px-4 py-2">Top-level domain for ingress routes and certificates.</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-amber-300">THIS_STORAGECLASS</td>
                    <td className="px-4 py-2 font-mono text-slate-400">local-path</td>
                    <td className="px-4 py-2">Default storage class for persistent volume claims.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
