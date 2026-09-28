'use client';

import { useState, useEffect } from 'react';
import {
  Key,
  RefreshCw,
  Search,
  Eye,
  EyeOff,
  Copy,
  Check,
  ExternalLink,
  ShieldAlert,
  Database,
  Lock,
  Mail,
} from 'lucide-react';
import { copyToClipboard as copyText } from '@/lib/clipboard';

interface SecretVaultItem {
  key: string;
  category: 'Admin Passwords' | 'Databases' | 'Tokens & Keys' | 'SMTP & Mail';
  targetApp: string;
  kubernetesSecret: string;
  namespace: string;
  value: string;
  masked: string;
  loginSubdomain?: string;
}

const CATEGORIES = ['All', 'Admin Passwords', 'Databases', 'Tokens & Keys', 'SMTP & Mail'];

export default function VaultPage() {
  const [secrets, setSecrets] = useState<SecretVaultItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [domain, setDomain] = useState('127.0.0.1.sslip.io');

  const fetchSecrets = async () => {
    setLoading(true);
    try {
      const [secRes, clusterRes] = await Promise.all([
        fetch('/api/secrets'),
        fetch('/api/cluster'),
      ]);
      const secData = await secRes.json();
      const clusterData = await clusterRes.json();
      setSecrets(secData.secrets || []);
      if (clusterData.domain) setDomain(clusterData.domain);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSecrets();
  }, []);

  const toggleReveal = (key: string) => {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const copyToClipboard = async (key: string, val: string) => {
    await copyText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const filteredSecrets = secrets.filter((s) => {
    const matchesCategory = selectedCategory === 'All' || s.category === selectedCategory;
    const matchesSearch =
      s.key.toLowerCase().includes(search.toLowerCase()) ||
      s.targetApp.toLowerCase().includes(search.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'Admin Passwords':
        return <Lock className="w-4 h-4 text-amber-400" />;
      case 'Databases':
        return <Database className="w-4 h-4 text-emerald-400" />;
      case 'SMTP & Mail':
        return <Mail className="w-4 h-4 text-sky-400" />;
      default:
        return <Key className="w-4 h-4 text-violet-400" />;
    }
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <Key className="w-5 h-5 text-amber-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">Credentials & Secret Vault</h2>
          </div>
          <p className="text-sm text-slate-400">
            Secure browser inspector for cluster passwords, database credentials, tokens, and direct application logins
          </p>
        </div>

        <button
          onClick={fetchSecrets}
          disabled={loading}
          className="text-xs px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg flex items-center space-x-2 self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Secrets</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search keys, app names, or categories..."
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
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Secrets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSecrets.map((secret) => {
          const isRevealed = revealedKeys.has(secret.key);
          const isCopied = copiedKey === secret.key;
          const loginUrl = secret.loginSubdomain ? `https://${secret.loginSubdomain}.${domain}` : undefined;

          return (
            <div
              key={secret.key}
              className="p-5 bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl flex flex-col justify-between transition-colors space-y-4"
            >
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    {getCategoryIcon(secret.category)}
                    <h3 className="font-bold text-sm text-white">{secret.targetApp}</h3>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500 bg-slate-800 px-2 py-0.5 rounded">
                    {secret.category}
                  </span>
                </div>

                <div className="font-mono text-xs text-sky-400 break-all">{secret.key}</div>
                <div className="text-[11px] text-slate-500">
                  K8s Secret: <span className="text-slate-400 font-mono">{secret.kubernetesSecret}</span> ({secret.namespace})
                </div>
              </div>

              {/* Password Value Box */}
              <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between font-mono text-xs">
                <span className="text-slate-200 select-all truncate mr-2">
                  {isRevealed ? secret.value : secret.masked}
                </span>

                <div className="flex items-center space-x-1.5 shrink-0">
                  <button
                    onClick={() => toggleReveal(secret.key)}
                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition-colors"
                    title={isRevealed ? 'Hide secret' : 'Reveal secret'}
                  >
                    {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>

                  <button
                    onClick={() => copyToClipboard(secret.key, secret.value)}
                    className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition-colors"
                    title="Copy value to clipboard"
                  >
                    {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Login Deep Link */}
              {loginUrl && (
                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-end">
                  <a
                    href={loginUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-sky-400 hover:text-sky-300 flex items-center space-x-1 transition-colors"
                  >
                    <span>Open Dashboard</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
