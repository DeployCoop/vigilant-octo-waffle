'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Layers,
  Search,
  ExternalLink,
  Code,
  Play,
  RotateCw,
  Check,
  Globe,
  BookOpen,
} from 'lucide-react';

interface AppItem {
  id: string;
  name: string;
  category: string;
  description: string;
  enablerVar: string;
  enabled: boolean;
  ingressUrl?: string;
  subdomain?: string;
  docsUrl?: string;
}

const CATEGORIES = [
  'All',
  'DevOps & GitOps',
  'Security & Identity',
  'Databases & Storage',
  'Observability & Monitoring',
  'Collaboration & Business',
  'AI, ML & GPU',
  'Messaging & IoT',
];

export default function AppsPage() {
  const [apps, setApps] = useState<AppItem[]>([]);
  const [domain, setDomain] = useState('example.com');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchApps = async () => {
    try {
      const res = await fetch('/api/apps');
      const data = await res.json();
      setApps(data.apps || []);
      if (data.domain) setDomain(data.domain);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchApps();
  }, []);

  const handleToggle = async (app: AppItem) => {
    setUpdatingId(app.id);
    const newStatus = !app.enabled;
    try {
      const res = await fetch('/api/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enablerVar: app.enablerVar,
          enabled: newStatus,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setApps((prev) =>
          prev.map((a) => (a.id === app.id ? { ...a, enabled: newStatus } : a))
        );
        setActionMessage(`Updated ${app.name} -> ${newStatus ? 'ENABLED' : 'DISABLED'}`);
      }
    } catch (err: any) {
      setActionMessage(`Failed to update ${app.name}: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDeploy = async (app: AppItem) => {
    setUpdatingId(app.id);
    try {
      const res = await fetch(`/api/apps/${app.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deploy' }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(`Triggered deployment for ${app.name} (Task: ${data.taskId})`);
      }
    } catch (err: any) {
      setActionMessage(`Deployment error: ${err.message}`);
    } finally {
      setUpdatingId(null);
    }
  };

  const filteredApps = apps.filter((app) => {
    const matchesCat = selectedCategory === 'All' || app.category === selectedCategory;
    const matchesSearch =
      app.name.toLowerCase().includes(search.toLowerCase()) ||
      app.description.toLowerCase().includes(search.toLowerCase()) ||
      app.id.toLowerCase().includes(search.toLowerCase());
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Layers className="w-5 h-5 text-sky-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Service Catalog & App Store</h2>
          </div>
          <p className="text-sm text-slate-400">
            Enable or deploy any of the 45+ pre-configured cloud-native applications via ArgoCD
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <span className="text-xs px-3 py-1.5 bg-slate-800 border border-slate-700 text-slate-300 rounded-lg">
            {apps.filter((a) => a.enabled).length} Enabled / {apps.length} Total
          </span>
        </div>
      </div>

      {actionMessage && (
        <div className="p-4 bg-sky-950/60 border border-sky-800 text-sky-300 text-sm rounded-lg flex items-center justify-between">
          <span>{actionMessage}</span>
          <Link href="/terminal" className="underline hover:text-white text-xs font-semibold">
            View Live Terminal →
          </Link>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search applications, descriptions, technologies..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                selectedCategory === cat
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Apps Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredApps.map((app) => (
          <div
            key={app.id}
            className={`p-5 bg-slate-900 border rounded-xl flex flex-col justify-between transition-all ${
              app.enabled ? 'border-slate-800 hover:border-slate-700' : 'border-slate-800/40 opacity-70'
            }`}
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold text-slate-100">{app.name}</h3>
                  <span className="text-[11px] font-mono text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/40">
                    {app.category}
                  </span>
                </div>

                {/* Enable Switch */}
                <button
                  onClick={() => handleToggle(app)}
                  disabled={updatingId === app.id}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    app.enabled ? 'bg-sky-500' : 'bg-slate-800'
                  }`}
                  title={app.enabled ? 'Enabled in .env.enabler' : 'Disabled in .env.enabler'}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      app.enabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed min-h-[38px]">
                {app.description}
              </p>
            </div>

            <div className="pt-4 mt-4 border-t border-slate-800/80 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Link
                  href={`/apps/${app.id}`}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                  title="Inspect Kubernetes Manifests & Overrides"
                >
                  <Code className="w-4 h-4" />
                </Link>
                {app.docsUrl && (
                  <a
                    href={app.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                    title="Official Documentation"
                  >
                    <BookOpen className="w-4 h-4" />
                  </a>
                )}
                {app.ingressUrl && app.enabled && (
                  <a
                    href={app.ingressUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 bg-sky-950 hover:bg-sky-900 text-sky-400 border border-sky-800/50 rounded-md transition-colors"
                    title={`Open ${app.ingressUrl}`}
                  >
                    <Globe className="w-4 h-4" />
                  </a>
                )}
              </div>

              <button
                onClick={() => handleDeploy(app)}
                disabled={updatingId === app.id || !app.enabled}
                className="text-xs px-2.5 py-1.5 bg-slate-800 hover:bg-sky-600 hover:text-white text-slate-300 border border-slate-700 rounded-md transition-colors flex items-center space-x-1.5 disabled:opacity-40 disabled:hover:bg-slate-800"
              >
                <Play className="w-3 h-3" />
                <span>Deploy / Sync</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
