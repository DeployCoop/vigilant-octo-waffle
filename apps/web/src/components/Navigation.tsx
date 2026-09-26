'use client';

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
} from 'lucide-react';

const navItems = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Cluster Control', href: '/cluster', icon: Server },
  { name: 'App Store (45+)', href: '/apps', icon: Layers },
  { name: 'Config Studio', href: '/config', icon: Settings },
  { name: 'TLS & DNS', href: '/certificates', icon: ShieldAlert },
  { name: 'Live Terminal', href: '/terminal', icon: Terminal },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between shrink-0">
      <div>
        <div className="p-5 border-b border-slate-800 flex items-center space-x-3">
          <span className="text-2xl">🐙</span>
          <div>
            <h1 className="font-bold text-slate-100 text-sm tracking-wide">Vigilant Octo Waffle</h1>
            <p className="text-xs text-slate-400">Local DevOps Control Plane</p>
          </div>
        </div>

        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center space-x-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-sky-400' : 'text-slate-400'}`} />
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
  return (
    <header className="h-16 bg-slate-950/80 backdrop-blur border-b border-slate-800 px-6 flex items-center justify-between sticky top-0 z-20">
      <div className="flex items-center space-x-3">
        <span className="text-xs font-semibold px-2.5 py-1 bg-slate-900 text-slate-300 border border-slate-700 rounded-md flex items-center space-x-1.5">
          <Activity className="w-3.5 h-3.5 text-sky-400" />
          <span>Control Plane Active</span>
        </span>
      </div>

      <div className="flex items-center space-x-3">
        <Link
          href="/terminal"
          className="text-xs font-medium bg-slate-900 hover:bg-slate-800 text-slate-300 px-3 py-1.5 rounded-md border border-slate-700 flex items-center space-x-1.5 transition-colors"
        >
          <Terminal className="w-3.5 h-3.5 text-sky-400" />
          <span>Console</span>
        </Link>
        <Link
          href="/apps"
          className="text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white px-3.5 py-1.5 rounded-md transition-colors shadow-sm flex items-center space-x-1.5"
        >
          <span>Catalog & Enablers</span>
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>
    </header>
  );
}
