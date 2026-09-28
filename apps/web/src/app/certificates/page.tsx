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
  Zap,
  Server,
  Layers,
  ArrowRight,
} from 'lucide-react';

interface CertificateItem {
  name: string;
  namespace: string;
  ready: boolean;
  status: string;
  secretName: string;
  dnsNames: string[];
  issuer: string;
  renewBefore?: string;
  notAfter?: string;
}

interface ClusterIssuerItem {
  name: string;
  ready: boolean;
  type: string;
  status: string;
}

export default function CertificatesPage() {
  const [data, setData] = useState<any>(null);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'sslip' | 'hosts' | 'bind' | 'cloudflare' | 'coredns'>('sslip');
  const [targetIps, setTargetIps] = useState('1.2.3.4, 1.2.3.5');
  const [switchingDomain, setSwitchingDomain] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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

  const handleSetSslipDomain = async () => {
    setSwitchingDomain(true);
    setMessage(null);
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: {
            THIS_DOMAIN: '127.0.0.1.sslip.io',
          },
        }),
      });
      const resData = await res.json();
      if (resData.success) {
        setMessage('Domain updated to 127.0.0.1.sslip.io! Zero sudo required for subdomains.');
        fetchDns();
      }
    } catch (err: any) {
      setMessage(`Failed to update domain: ${err.message}`);
    } finally {
      setSwitchingDomain(false);
    }
  };

  const certificates: CertificateItem[] = data?.certificates || [];
  const issuers: ClusterIssuerItem[] = data?.clusterIssuers || [];

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
            Local mkcert Certificate Authority, wildcard DNS (sslip.io), and cert-manager monitoring
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg flex items-center space-x-1.5 font-medium">
            <span>Root CA Ready</span>
          </span>
        </div>
      </div>

      {message && (
        <div className="p-4 bg-sky-950/60 border border-sky-800 text-sky-300 text-sm rounded-lg flex items-center justify-between">
          <span>{message}</span>
        </div>
      )}

      {/* Zero Sudo Wildcard Callout */}
      <div className="p-5 bg-gradient-to-r from-sky-950/40 via-slate-900 to-indigo-950/30 border border-sky-800/40 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Zap className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-bold text-white">Recommended: Zero-Sudo Wildcard DNS</h3>
          </div>
          <span className="text-[11px] font-mono px-2 py-0.5 bg-sky-500/10 text-sky-400 border border-sky-500/20 rounded">
            No /etc/hosts changes needed
          </span>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed">
          Using <strong className="text-white">127.0.0.1.sslip.io</strong> allows every subdomain (e.g.{' '}
          <code className="text-sky-300">argocd.127.0.0.1.sslip.io</code>,{' '}
          <code className="text-sky-300">nextcloud.127.0.0.1.sslip.io</code>) to automatically resolve to{' '}
          <code className="text-sky-300">127.0.0.1</code> over public DNS without ever editing{' '}
          <code className="text-slate-400">/etc/hosts</code> or needing sudo privileges!
        </p>
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-slate-400">
            Current domain: <strong className="text-white">{data?.domain || 'example.com'}</strong>
          </span>
          {data?.domain !== '127.0.0.1.sslip.io' && (
            <button
              onClick={handleSetSslipDomain}
              disabled={switchingDomain}
              className="text-xs px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white font-medium rounded-lg transition-colors flex items-center space-x-1.5 shadow-sm disabled:opacity-50"
            >
              <span>Switch to 127.0.0.1.sslip.io</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* mkcert Guidance Banner */}
      <div className="p-5 bg-slate-900 border border-slate-800 rounded-xl space-y-3">
        <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
          <span>Local TLS Trust with mkcert</span>
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          Vigilant Octo Waffle uses <code>mkcert</code> to generate a trusted local Certificate Authority.
          To ensure your browser trusts these certificates without security warnings, run once on your laptop:
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

      {/* Cert-Manager Live Certificates Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 text-violet-400" />
            <h3 className="text-sm font-bold text-white">Cert-Manager Certificates (CRDs)</h3>
          </div>
          <span className="text-xs px-2.5 py-1 bg-slate-800 text-slate-300 rounded-md font-mono">
            {certificates.length} Issued
          </span>
        </div>

        <div className="divide-y divide-slate-800/60">
          {certificates.length > 0 ? (
            certificates.map((cert) => (
              <div key={`${cert.namespace}-${cert.name}`} className="p-4 flex items-center justify-between hover:bg-slate-800/30">
                <div className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-semibold text-slate-200">{cert.name}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded">
                      {cert.namespace}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400">
                    SANs: {cert.dnsNames.join(', ') || 'none'}
                  </div>
                </div>

                <div className="flex items-center space-x-3">
                  <span
                    className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                      cert.ready
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                    }`}
                  >
                    {cert.ready ? 'Ready' : cert.status}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="p-8 text-center text-xs text-slate-500">
              No cert-manager certificates currently detected. Deploy an application with ingress or install cert-manager to view certificates.
            </div>
          )}
        </div>
      </div>

      {/* DNS Record Exporters */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setActiveTab('sslip')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'sslip' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Wildcard sslip.io (Zero Sudo)
            </button>
            <button
              onClick={() => setActiveTab('hosts')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'hosts' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              /etc/hosts (Manual)
            </button>
            <button
              onClick={() => setActiveTab('coredns')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'coredns' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              CoreDNS (Offline)
            </button>
            <button
              onClick={() => setActiveTab('bind')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'bind' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              BIND Zone
            </button>
            <button
              onClick={() => setActiveTab('cloudflare')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                activeTab === 'cloudflare' ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cloudflare
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
              {activeTab === 'sslip' && 'Pattern: <subdomain>.127.0.0.1.sslip.io automatically resolves to 127.0.0.1'}
              {activeTab === 'hosts' && 'Append the following block to your local /etc/hosts file:'}
              {activeTab === 'coredns' && 'CoreDNS configuration for local wildcard resolution in offline environments:'}
              {activeTab === 'bind' && 'Add these A records to your BIND DNS zone file:'}
              {activeTab === 'cloudflare' && 'Import or configure these records in Cloudflare DNS:'}
            </span>
            <button
              onClick={() => {
                const text =
                  activeTab === 'sslip'
                    ? `*.127.0.0.1.sslip.io`
                    : activeTab === 'hosts'
                    ? data?.hostsBlock
                    : activeTab === 'coredns'
                    ? data?.coreDnsBlock
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

          <pre className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 overflow-x-auto max-h-[400px] leading-relaxed">
            {activeTab === 'sslip' &&
              `# No file modification required!
# Every application will be directly accessible via:
https://argocd.127.0.0.1.sslip.io
https://nextcloud.127.0.0.1.sslip.io
https://grafana.127.0.0.1.sslip.io
https://bao.127.0.0.1.sslip.io
https://harbor.127.0.0.1.sslip.io
...`}
            {activeTab === 'hosts' && data?.hostsBlock}
            {activeTab === 'coredns' && data?.coreDnsBlock}
            {activeTab === 'bind' && data?.bindBlock}
            {activeTab === 'cloudflare' && data?.cloudflareBlock}
          </pre>
        </div>
      </div>
    </div>
  );
}
