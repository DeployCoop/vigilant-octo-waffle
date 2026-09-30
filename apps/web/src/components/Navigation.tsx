'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Server,
  Layers,
  Settings,
  ShieldAlert,
  Terminal,
  ExternalLink,
  Activity,
  HardDrive,
  Boxes,
  ChevronDown,
  RefreshCw,
  Network,
  Key,
  Ship,
  Archive,
  Database,
  ShieldCheck,
  Cloud,
  Flame,
  Sliders,
  Lock,
  DollarSign,
  Smartphone,
  Bot,
  Sparkles,
  BookOpen,
} from 'lucide-react';
import { useTerminal } from '@/context/TerminalContext';

const navItems = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Documentation', href: '/docs', icon: BookOpen },
  { name: 'Cluster Control', href: '/cluster', icon: Server },
  { name: 'Antigravity Copilot', href: '/antigravity', icon: Bot },
  { name: 'App Store', href: '/apps', icon: Layers },
  { name: 'Helm Hub & Releases', href: '/helm', icon: Ship },
  { name: 'Architecture Graph', href: '/topology', icon: Network },
  { name: 'Pod Explorer & Shell', href: '/pods', icon: Boxes },
  { name: 'Chaos Playground', href: '/chaos', icon: Flame },
  { name: 'Argo Rollouts', href: '/rollouts', icon: Sliders },
  { name: 'Zero-Trust Network', href: '/network', icon: Lock },
  { name: 'FinOps & Wattage', href: '/finops', icon: DollarSign },
  { name: 'Trace Waterfalls', href: '/traces', icon: Activity },
  { name: 'OCI Image Builder', href: '/builder', icon: Boxes },
  { name: 'Mobile QR Bridge', href: '/remote', icon: Smartphone },
  { name: 'Data & DB Studio', href: '/data', icon: Database },
  { name: 'Security Audit', href: '/security', icon: ShieldCheck },
  { name: 'Cloud Exporter', href: '/export', icon: Cloud },
  { name: 'Storage & Volumes', href: '/storage', icon: HardDrive },
  { name: 'Credentials Vault', href: '/vault', icon: Key },
  { name: 'Backups & Snapshots', href: '/backups', icon: Archive },
  { name: 'Config Studio', href: '/config', icon: Settings },
  { name: 'TLS & DNS', href: '/certificates', icon: ShieldAlert },
  { name: 'Live Terminal', href: '/terminal', icon: Terminal },
];


export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between shrink-0 h-screen sticky top-0 overflow-hidden">
      <div className="overflow-y-auto flex-1">
        <div className="p-5 border-b border-slate-800 flex items-center space-x-3 sticky top-0 bg-slate-950 z-10">
          <span className="text-2xl">🐙</span>
          <div>
            <h1 className="font-bold text-slate-100 text-sm tracking-wide">Vigilant Octo Waffle</h1>
            <p className="text-xs text-slate-400">Local DevOps Control Plane</p>
          </div>
        </div>

        <nav className="p-3 space-y-1" suppressHydrationWarning>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.name}
                href={item.href}
                suppressHydrationWarning
                className={`flex items-center space-x-3 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-sky-400' : 'text-slate-400'}`} suppressHydrationWarning />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </div>


      <div className="p-4 border-t border-slate-800 text-xs text-slate-500 space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-slate-400">Engine Ready</span>
          </span>
          <span className="font-mono text-[10px] text-slate-600">v1.0.0</span>
        </div>
        <p className="text-[11px] leading-relaxed text-slate-500">
          GitOps & TLS Kubernetes environment powered by Next.js & ArgoCD.
        </p>
      </div>
    </aside>
  );
}

export function Header() {
  const [contexts, setContexts] = useState<string[]>([]);
  const [currentContext, setCurrentContext] = useState<string>('');
  const [switching, setSwitching] = useState(false);
  const { runningTaskCount, activeTaskId, isMinimized, openTerminal, restoreTerminal } = useTerminal();

  useEffect(() => {
    fetch('/api/cluster/contexts')
      .then((res) => res.json())
      .then((data) => {
        if (data.contexts) setContexts(data.contexts);
        if (data.current) setCurrentContext(data.current);
      })
      .catch(() => {});
  }, []);

  const handleContextChange = async (newContext: string) => {
    if (!newContext || newContext === currentContext) return;
    setSwitching(true);
    try {
      const res = await fetch('/api/cluster/contexts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contextName: newContext }),
      });
      const data = await res.json();
      if (data.success) {
        setCurrentContext(newContext);
        // refresh window so all panels reload state under new context
        window.location.reload();
      }
    } catch {
      // ignore
    } finally {
      setSwitching(false);
    }
  };

  return (
    <header className="h-16 bg-slate-950/80 backdrop-blur border-b border-slate-800 px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center space-x-3">
        {/* Multi-Cluster Context Selector */}
        <div className="flex items-center space-x-2 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1 text-xs">
          <span className="text-slate-500 font-medium">Context:</span>
          {contexts.length > 0 ? (
            <select
              value={currentContext}
              disabled={switching}
              onChange={(e) => handleContextChange(e.target.value)}
              className="bg-transparent text-sky-400 font-mono text-xs focus:outline-none cursor-pointer pr-1"
            >
              {contexts.map((ctx) => (
                <option key={ctx} value={ctx} className="bg-slate-900 text-slate-200">
                  {ctx}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-slate-400 font-mono text-xs">{currentContext || 'Disconnected'}</span>
          )}
          {switching && <RefreshCw className="w-3 h-3 text-sky-400 animate-spin" />}
        </div>
      </div>

      <div className="flex items-center space-x-3" suppressHydrationWarning>
        <Link
          href="/docs"
          suppressHydrationWarning
          className="text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-md border border-slate-700 flex items-center space-x-1.5 transition-colors"
          title="Vigilant Octo Waffle Documentation & Field Guide"
        >
          <BookOpen className="w-3.5 h-3.5 text-sky-400" suppressHydrationWarning />
          <span>Docs</span>
        </Link>
        <Link
          href="/antigravity"
          suppressHydrationWarning
          className="text-xs font-medium bg-slate-900 hover:bg-slate-800 text-sky-400 hover:text-sky-300 px-3 py-1.5 rounded-md border border-slate-700 flex items-center space-x-1.5 transition-colors"
        >
          <Sparkles className="w-3.5 h-3.5 text-sky-400" suppressHydrationWarning />
          <span>Antigravity</span>
        </Link>
        {runningTaskCount > 0 ? (
          <button
            onClick={() => (isMinimized ? restoreTerminal() : openTerminal(activeTaskId || ''))}
            className="text-xs font-semibold bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 px-3 py-1.5 rounded-md border border-emerald-500/50 flex items-center space-x-1.5 transition-all shadow-sm cursor-pointer animate-pulse"
            title="Open active Terminal execution"
          >
            <RefreshCw className="w-3.5 h-3.5 text-emerald-400 animate-spin" />
            <span>Terminal ({runningTaskCount} active)</span>
          </button>
        ) : (
          <button
            onClick={() => openTerminal(activeTaskId || '')}
            className="text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 px-3 py-1.5 rounded-md border border-slate-700 flex items-center space-x-1.5 transition-colors cursor-pointer"
            title="Open pop-out Terminal console"
          >
            <Terminal className="w-3.5 h-3.5 text-sky-400" suppressHydrationWarning />
            <span>Console</span>
          </button>
        )}
        <Link
          href="/apps"
          suppressHydrationWarning
          className="text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white px-3.5 py-1.5 rounded-md transition-colors shadow-sm flex items-center space-x-1.5"
        >
          <span>Catalog & Enablers</span>
          <ExternalLink className="w-3 h-3" suppressHydrationWarning />
        </Link>
      </div>
    </header>
  );
}
