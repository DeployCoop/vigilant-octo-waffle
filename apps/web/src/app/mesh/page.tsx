'use client';

import { useState, useEffect } from 'react';
import {
  Lock,
  ShieldCheck,
  ShieldAlert,
  Key,
  RefreshCw,
  Zap,
  ArrowRight,
  CheckCircle2,
  FileCode,
  Check,
} from 'lucide-react';

interface WorkloadIdentity {
  podName: string;
  namespace: string;
  serviceAccount: string;
  spiffeId: string;
  certSerial: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  daysUntilExpiration: number;
  status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';
}

interface TlsConnectionLink {
  id: string;
  sourceWorkload: string;
  sourceNamespace: string;
  targetWorkload: string;
  targetNamespace: string;
  port: number;
  protocol: string;
  tlsMode: 'STRICT_MTLS' | 'PERMISSIVE_TLS' | 'PLAINTEXT';
  cipherSuite: string;
  latencyMs: number;
}

export default function MeshSecurityPage() {
  const [identities, setIdentities] = useState<WorkloadIdentity[]>([]);
  const [links, setLinks] = useState<TlsConnectionLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [enforcingNs, setEnforcingNs] = useState('nextcloud');
  const [enforcing, setEnforcing] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const fetchMeshData = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/mesh');
      const data = await res.json();
      setIdentities(data.identities || []);
      setLinks(data.links || []);
    } catch (err) {
      console.error('Failed to load mesh security data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMeshData();
  }, []);

  const handleEnforceStrict = async (namespace: string) => {
    setEnforcing(true);
    try {
      const res = await fetch('/api/mesh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace }),
      });
      const data = await res.json();
      if (data.success) {
        setActionMessage(data.message);
        fetchMeshData();
      }
    } catch (err) {
      console.error('Enforce strict mTLS failed:', err);
    } finally {
      setEnforcing(false);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-6">
        <div className="flex items-center space-x-3">
          <span className="p-2.5 bg-emerald-500/10 text-emerald-400 rounded-xl border border-emerald-500/20">
            <Lock className="w-6 h-6" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-slate-100">OctoMesh: SPIFFE Identity & mTLS Inspector</h1>
            <p className="text-sm text-slate-400">
              Workload cryptographic SPIFFE identities, x509 certificate expiry radar, and strict mutual TLS topology
            </p>
          </div>
        </div>

        <button
          onClick={fetchMeshData}
          disabled={loading}
          className="flex items-center space-x-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-medium rounded-lg border border-slate-800 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {actionMessage && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300 flex justify-between items-center">
          <span>{actionMessage}</span>
          <button onClick={() => setActionMessage(null)} className="text-slate-400 hover:text-slate-200">✕</button>
        </div>
      )}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Authenticated SPIFFE Identities</div>
          <div className="text-2xl font-bold text-emerald-400">{identities.length} Workloads</div>
          <div className="text-[11px] text-slate-500 mt-1">Cilium / SPIRE CA signed</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Strict mTLS Links</div>
          <div className="text-2xl font-bold text-sky-400">
            {links.filter((l) => l.tlsMode === 'STRICT_MTLS').length} / {links.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Wire encryption enforced</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Plaintext Warning Channels</div>
          <div className="text-2xl font-bold text-rose-400">
            {links.filter((l) => l.tlsMode === 'PLAINTEXT').length} Unencrypted
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Zero-Trust non-compliant</div>
        </div>

        <div className="bg-slate-900/60 border border-slate-800 p-5 rounded-xl">
          <div className="text-xs text-slate-400 mb-1">Cert Rotation Health</div>
          <div className="text-2xl font-bold text-slate-100">
            {identities.filter((i) => i.status === 'EXPIRING_SOON').length} Expiring Soon
          </div>
          <div className="text-[11px] text-amber-400 mt-1">Automatic renewal queued</div>
        </div>
      </div>

      {/* Visual mTLS Communication Links */}
      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Inter-Workload Transport Encryption & Cipher Topology
          </h2>
          <div className="flex items-center space-x-2 text-xs">
            <select
              value={enforcingNs}
              onChange={(e) => setEnforcingNs(e.target.value)}
              className="bg-slate-900 border border-slate-800 text-slate-200 rounded px-2.5 py-1 text-xs outline-none"
            >
              <option value="nextcloud">Enforce on &apos;nextcloud&apos;</option>
              <option value="postgres">Enforce on &apos;postgres&apos;</option>
              <option value="redis">Enforce on &apos;redis&apos;</option>
            </select>
            <button
              onClick={() => handleEnforceStrict(enforcingNs)}
              disabled={enforcing}
              className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium transition"
            >
              Enforce Strict mTLS
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {links.map((link) => {
            const isStrict = link.tlsMode === 'STRICT_MTLS';
            const isPlaintext = link.tlsMode === 'PLAINTEXT';

            return (
              <div
                key={link.id}
                className={`p-5 rounded-2xl border transition space-y-3 ${
                  isStrict
                    ? 'bg-slate-900/40 border-slate-800'
                    : isPlaintext
                    ? 'bg-rose-950/20 border-rose-500/40'
                    : 'bg-amber-950/20 border-amber-500/40'
                }`}
              >
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-2 font-mono text-xs">
                    <span className="text-slate-200 font-semibold">{link.sourceWorkload}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-slate-200 font-semibold">{link.targetWorkload}</span>
                  </div>

                  <span
                    className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                      isStrict
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : isPlaintext
                        ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {link.tlsMode}
                  </span>
                </div>

                <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 space-y-1 text-[11px] font-mono">
                  <div className="flex justify-between text-slate-400">
                    <span>Target Port & Protocol:</span>
                    <span className="text-slate-200">{link.port} / {link.protocol}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Cipher Suite:</span>
                    <span className={isPlaintext ? 'text-rose-400' : 'text-emerald-400'}>{link.cipherSuite}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>Handshake Latency:</span>
                    <span className="text-slate-300">{link.latencyMs} ms</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* SPIFFE Workload Identities Registry */}
      <div className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <Key className="w-4 h-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-200">Workload SPIFFE Cryptographic Identities</h2>
          </div>
          <span className="text-xs text-slate-500 font-mono">spiffe://cluster.local</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wider border-b border-slate-800 font-medium">
              <tr>
                <th className="px-4 py-3">Pod Workload</th>
                <th className="px-4 py-3">SPIFFE ID URI</th>
                <th className="px-4 py-3">Cert Serial</th>
                <th className="px-4 py-3">Issuer Authority</th>
                <th className="px-4 py-3">TTL Validity</th>
                <th className="px-4 py-3 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {identities.map((id) => {
                const isExpiring = id.status === 'EXPIRING_SOON';
                return (
                  <tr key={id.podName} className="hover:bg-slate-900/40 transition">
                    <td className="px-4 py-3 font-mono font-medium text-slate-200">{id.podName}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-sky-400">{id.spiffeId}</td>
                    <td className="px-4 py-3 font-mono text-slate-400 text-[11px]">{id.certSerial}</td>
                    <td className="px-4 py-3 text-slate-400">{id.issuer}</td>
                    <td className="px-4 py-3 font-mono">
                      <span className={isExpiring ? 'text-amber-400 font-bold' : 'text-slate-300'}>
                        {id.daysUntilExpiration} days
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                          isExpiring
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                            : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        }`}
                      >
                        {id.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
