'use client';

import { useState, useEffect } from 'react';
import {
  ShieldAlert,
  Copy,
  Check,
  Globe,
  FileCode,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';

export default function CertificatesPage() {
  const [data, setData] = useState<any>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'hosts' | 'bind' | 'cloudflare'>('hosts');
  const [targetIps, setTargetIps] = useState('1.2.3.4, 1.2.3.5');

  const fetchDns = async () => {
    try {
      const res = await fetch(`/api/dns?ips=${encodeURIComponent(targetIps)}`);
      const result = await res.json();
      setData(result);
    } catch {
      // offline
    }
  };

  useEffect(() => {
    fetchDns();
  }, [targetIps]);

  const copyToClipboard = (text: string, section: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2500);
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 bg-slate-900 border border-slate-800 rounded-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h2 className="text-xl font-bold text-white tracking-tight">TLS & DNS Configuration</h2>
          </div>
          <p className="text-sm text-slate-400">
            Local mkcert Certificate Authority and DNS record generation for localhost TLS testing
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg flex items-center space-x-1.5 font-medium">
            <span>Root CA Ready</span>
          </span>
        </div>
      </div>

      {/* mkcert Guidance Banner */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
          <span>Local TLS Trust with mkcert</span>
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Vigilant Octo Waffle uses <code>mkcert</code> to generate a trusted local Certificate Authority.
          To ensure your local web browser trusts these certificates without any security warnings, execute once on your laptop:
        </p>
        <div className="p-3 bg-slate-950 border border-slate-800 rounded-lg flex items-center justify-between">
          <code className="text-xs text-sky-400 font-mono">mkcert -install</code>
          <button
            onClick={() => copyToClipboard('mkcert -install', 'mkcert')}
            className="text-xs text-slate-400 hover:text-white flex items-center space-x-1"
          >
            {copiedSection === 'mkcert' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedSection === 'mkcert' ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>

      {/* DNS Record Exporters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex space-x-2">
            <button
              onClick={() => setActiveTab('hosts')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'hosts' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              /etc/hosts (Localhost)
            </button>
            <button
              onClick={() => setActiveTab('bind')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'bind' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              BIND Zone Records
            </button>
            <button
              onClick={() => setActiveTab('cloudflare')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'cloudflare' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cloudflare Format
            </button>
          </div>

          {(activeTab === 'bind' || activeTab === 'cloudflare') && (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-400">Target IPs:</span>
              <input
                type="text"
                value={targetIps}
                onChange={(e) => setTargetIps(e.target.value)}
                className="px-2.5 py-1 text-xs bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-sky-500"
              />
            </div>
          )}
        </div>

        <div className="p-4 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-400">
              {activeTab === 'hosts' && 'Append the following block to your local /etc/hosts file:'}
              {activeTab === 'bind' && 'Add these A records to your BIND DNS zone file:'}
              {activeTab === 'cloudflare' && 'Import or configure these records in Cloudflare DNS:'}
            </span>
            <button
              onClick={() => {
                const text =
                  activeTab === 'hosts'
                    ? data?.hostsBlock
                    : activeTab === 'bind'
                    ? data?.bindBlock
                    : data?.cloudflareBlock;
                copyToClipboard(text || '', activeTab);
              }}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-xs flex items-center space-x-1.5 transition-colors"
            >
              {copiedSection === activeTab ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>{copiedSection === activeTab ? 'Copied' : 'Copy All'}</span>
            </button>
          </div>

          <pre className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 overflow-x-auto max-h-[450px] leading-relaxed">
            {activeTab === 'hosts' && data?.hostsBlock}
            {activeTab === 'bind' && data?.bindBlock}
            {activeTab === 'cloudflare' && data?.cloudflareBlock}
          </pre>
        </div>
      </div>
    </div>
  );
}
