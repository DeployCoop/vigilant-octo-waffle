'use client';

import { useState, useEffect, useMemo } from 'react';
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
  Search,
  X,
  Radio,
  GitPullRequest,
  GitCompare,
  Timer,
  Zap,
  Target,
  TrendingUp,
  Globe,
  FileText,
  History,
} from 'lucide-react';
import { useTerminal } from '@/context/TerminalContext';
import { useAbilityContext } from '@/lib/ability';
import { AudioToggle } from '@/components/ui/AudioToggle';

export interface NavItem {
  name: string;
  href: string;
  icon: any;
  badge?: string;
}

export interface NavGroup {
  id: string;
  name: string;
  icon: any;
  items: NavItem[];
}

export const directNavItems: NavItem[] = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Antigravity Copilot', href: '/antigravity', icon: Bot, badge: 'AI' },
];

export const navGroups: NavGroup[] = [
  {
    id: 'workloads',
    name: 'Apps & GitOps',
    icon: Layers,
    items: [
      { name: 'App Store', href: '/apps', icon: Layers },
      { name: 'Waffle Pipelines', href: '/waffle', icon: Sparkles },
      { name: 'Helm Hub & Releases', href: '/helm', icon: Ship },
      { name: 'Argo Rollouts', href: '/rollouts', icon: Sliders },
      { name: 'OCI Image Builder', href: '/builder', icon: Boxes },
      { name: 'PR Previews', href: '/previews', icon: GitPullRequest },
      { name: 'OctoDrift Reconciler', href: '/drift', icon: GitCompare },
      { name: 'GitOps Time Machine', href: '/rewind', icon: History },
      { name: 'Wasm Workloads', href: '/wasm', icon: Zap },
    ],
  },
  {
    id: 'infrastructure',
    name: 'Cluster & Workloads',
    icon: Server,
    items: [
      { name: 'Cluster Control', href: '/cluster', icon: Server },
      { name: 'Pod Explorer & Shell', href: '/pods', icon: Boxes },
      { name: 'Architecture Graph', href: '/topology', icon: Network },
      { name: 'Storage & Volumes', href: '/storage', icon: HardDrive },
      { name: 'Backups & Snapshots', href: '/backups', icon: Archive },
      { name: 'KEDA Autoscaler', href: '/keda', icon: TrendingUp },
      { name: 'Multi-Cluster Fleet', href: '/fleet', icon: Globe },
      { name: 'Disaster Recovery', href: '/dr', icon: Timer },
      { name: 'DB Zero-Downtime', href: '/migrate', icon: Database },
    ],
  },
  {
    id: 'security',
    name: 'Network & Security',
    icon: ShieldCheck,
    items: [
      { name: 'Zero-Trust Network', href: '/network', icon: Lock },
      { name: 'TLS & DNS', href: '/certificates', icon: ShieldAlert },
      { name: 'Credentials Vault', href: '/vault', icon: Key },
      { name: 'Security Audit', href: '/security', icon: ShieldCheck },
      { name: 'Access & Audit', href: '/settings/access', icon: Key },
      { name: 'Admission Guard', href: '/guard', icon: ShieldCheck },
      { name: 'SPIFFE & mTLS Mesh', href: '/mesh', icon: Lock },
      { name: 'SecretOps & Leaks', href: '/secretops', icon: ShieldAlert },
    ],
  },
  {
    id: 'observability',
    name: 'Observability & Shell',
    icon: Activity,
    items: [
      { name: 'Trace Waterfalls', href: '/traces', icon: Activity },
      { name: 'FinOps & Wattage', href: '/finops', icon: DollarSign },
      { name: 'Chaos Playground', href: '/chaos', icon: Flame },
      { name: 'Live Terminal', href: '/terminal', icon: Terminal },
      { name: 'Data & DB Studio', href: '/data', icon: Database },
      { name: 'eBPF & CoreDNS', href: '/ebpf', icon: Radio },
      { name: 'SRE & Error Budgets', href: '/slo', icon: Target },
      { name: 'AI Post-Mortems', href: '/postmortem', icon: FileText },
    ],
  },
  {
    id: 'system',
    name: 'System & Tools',
    icon: Settings,
    items: [
      { name: 'Documentation', href: '/docs', icon: BookOpen },
      { name: 'Config Studio', href: '/config', icon: Settings },
      { name: 'Cloud Exporter', href: '/export', icon: Cloud },
      { name: 'Mobile QR Bridge', href: '/remote', icon: Smartphone },
    ],
  },
];

// Flat array for backwards compatibility
export const navItems: NavItem[] = [
  ...directNavItems,
  ...navGroups.flatMap((group) => group.items),
];

export function Sidebar() {
  const pathname = usePathname();
  const [searchQuery, setSearchQuery] = useState('');

  // Find active group based on current pathname
  const activeGroupId = useMemo(() => {
    for (const group of navGroups) {
      if (
        group.items.some(
          (item) => pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href))
        )
      ) {
        return group.id;
      }
    }
    return null;
  }, [pathname]);

  // Track expanded/collapsed state for submenus
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    if (activeGroupId) {
      initial[activeGroupId] = true;
    }
    return initial;
  });

  // Automatically expand the group that contains the current active route
  useEffect(() => {
    if (activeGroupId) {
      setOpenGroups((prev) => ({
        ...prev,
        [activeGroupId]: true,
      }));
    }
  }, [activeGroupId]);

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const expandAll = () => {
    const all: Record<string, boolean> = {};
    navGroups.forEach((g) => (all[g.id] = true));
    setOpenGroups(all);
  };

  const collapseAll = () => {
    setOpenGroups({});
  };

  const allExpanded = navGroups.every((g) => openGroups[g.id]);

  // Filtered items when search query is present
  const query = searchQuery.trim().toLowerCase();
  const isFiltering = query.length > 0;

  const filteredDirectItems = isFiltering
    ? directNavItems.filter((item) => item.name.toLowerCase().includes(query))
    : directNavItems;

  const filteredGroups = isFiltering
    ? navGroups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => item.name.toLowerCase().includes(query)),
        }))
        .filter((group) => group.items.length > 0)
    : navGroups;

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col justify-between shrink-0 h-screen sticky top-0 overflow-hidden select-none">
      <div className="overflow-y-auto flex-1">
        {/* Brand Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-950/95 backdrop-blur z-10">
          <div className="flex items-center space-x-2.5">
            <span className="text-2xl">🐙</span>
            <div>
              <h1 className="font-bold text-slate-100 text-sm tracking-wide">Vigilant Octo Waffle</h1>
              <p className="text-[11px] text-slate-400">Local DevOps Control Plane</p>
            </div>
          </div>
        </div>

        {/* Quick Search / Filter */}
        <div className="px-3 pt-3 pb-1">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter menu..."
              className="w-full bg-slate-900/80 border border-slate-800 rounded-lg pl-8 pr-7 py-1 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500/50 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                title="Clear filter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tree */}
        <nav className="p-3 space-y-1" suppressHydrationWarning>
          {/* Direct Top-Level Items */}
          {filteredDirectItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.name}
                href={item.href}
                suppressHydrationWarning
                className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                    : 'text-slate-300 hover:text-white hover:bg-slate-900/80'
                }`}
              >
                <div className="flex items-center space-x-2.5">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-sky-400' : 'text-slate-400'}`} />
                  <span>{item.name}</span>
                </div>
                {item.badge && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800/40">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}

          {/* Section Divider with Collapse/Expand All controls */}
          <div className="pt-2 pb-1 px-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Navigation Submenus
            </span>
            {!isFiltering && (
              <button
                type="button"
                onClick={allExpanded ? collapseAll : expandAll}
                className="text-[10px] text-slate-500 hover:text-sky-400 transition-colors cursor-pointer"
                title={allExpanded ? 'Collapse all submenus' : 'Expand all submenus'}
              >
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            )}
          </div>

          {/* Submenu Accordion Groups */}
          {filteredGroups.map((group) => {
            const GroupIcon = group.icon;
            const isGroupActive = activeGroupId === group.id;
            const isOpen = isFiltering || Boolean(openGroups[group.id]);

            return (
              <div key={group.id} className="space-y-0.5">
                {/* Submenu Header Button */}
                <button
                  type="button"
                  onClick={() => !isFiltering && toggleGroup(group.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer group ${
                    isGroupActive
                      ? 'text-sky-300 bg-slate-900/50 hover:bg-slate-900'
                      : 'text-slate-300 hover:text-white hover:bg-slate-900/70'
                  }`}
                  title={`${group.name} (${group.items.length} items)`}
                >
                  <div className="flex items-center space-x-2.5 min-w-0">
                    <GroupIcon
                      className={`w-4 h-4 shrink-0 transition-colors ${
                        isGroupActive ? 'text-sky-400' : 'text-slate-400 group-hover:text-slate-200'
                      }`}
                    />
                    <span className="truncate">{group.name}</span>
                    {isGroupActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0" title="Active section" />
                    )}
                  </div>
                  <div className="flex items-center space-x-1 shrink-0 text-slate-500">
                    <span className="text-[10px] font-mono px-1 rounded bg-slate-900 border border-slate-800 text-slate-400">
                      {group.items.length}
                    </span>
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-slate-300' : 'rotate-0 text-slate-500'
                      }`}
                    />
                  </div>
                </button>

                {/* Submenu Items */}
                {isOpen && (
                  <div className="ml-3 pl-3 border-l border-slate-800/80 space-y-0.5 py-1">
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      const isActive =
                        pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));

                      return (
                        <Link
                          key={item.name}
                          href={item.href}
                          suppressHydrationWarning
                          className={`flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-colors ${
                            isActive
                              ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                          }`}
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            <ItemIcon
                              className={`w-3.5 h-3.5 shrink-0 ${
                                isActive ? 'text-sky-400' : 'text-slate-500'
                              }`}
                            />
                            <span className="truncate">{item.name}</span>
                          </div>
                          {item.badge && (
                            <span className="text-[9px] font-mono px-1 rounded bg-slate-900 text-sky-400 border border-slate-800">
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="p-4 border-t border-slate-800 text-xs text-slate-500 space-y-2 bg-slate-950">
        <div className="flex items-center justify-between">
          <span className="flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-slate-400 font-medium">Engine Ready</span>
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
  const { status, principal, openSignInPrompt, signOut } = useAbilityContext();

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
        <AudioToggle />
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

        {/* Auth State / Sign In Widget */}
        {status === 'ready' && principal ? (
          <div className="flex items-center space-x-2 text-xs bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-200 font-medium">{principal.name}</span>
            <span className="text-[10px] text-sky-400 bg-sky-950/60 px-1.5 py-0.5 rounded border border-sky-800/40 uppercase font-mono">
              {principal.role}
            </span>
            <button
              onClick={() => void signOut()}
              title="Sign out of this browser"
              className="text-slate-500 hover:text-rose-400 ml-1 text-[11px] transition-colors cursor-pointer"
            >
              Sign out
            </button>
          </div>
        ) : (status === 'unauthenticated' || status === 'unknown-principal') ? (
          <button
            onClick={openSignInPrompt}
            className="text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-1.5 rounded-md flex items-center space-x-1.5 transition-colors cursor-pointer"
            title="Sign in with principal token"
          >
            <Key className="w-3.5 h-3.5 text-amber-400" />
            <span>Sign In</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
