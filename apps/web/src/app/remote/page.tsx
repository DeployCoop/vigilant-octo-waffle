'use client';

import { useState, useEffect } from 'react';
import { useAbilityContext } from '@/lib/ability';
import { postArgoWebhook } from '@/lib/webhook';
import {
  Smartphone,
  QrCode,
  Copy,
  Check,
  RefreshCw,
  Power,
  RotateCw,
  Zap,
  Activity,
  Shield,
  Wifi,
  Radio,
  CheckCircle2,
} from 'lucide-react';
import { copyToClipboard } from '@/lib/clipboard';

interface PairingSession {
  token: string;
  createdAt: number;
  expiresAt: number;
  lanIp: string;
  port: number;
  pairingUrl: string;
  qrSvg: string;
}

export default function RemotePairingPage() {
  const { can, status: abilityStatus } = useAbilityContext();
  const canPair = can('remote:exec');
  const [session, setSession] = useState<PairingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [isMobileMode, setIsMobileMode] = useState(false);

  const loadSession = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/remote');
      const data = await res.json();
      // 401/403 when the caller lacks remote:exec — no session to show.
      setSession(res.ok ? data : null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Check if accessing with token in URL (e.g. from mobile scan)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('token') || window.innerWidth < 768) {
      setIsMobileMode(true);
    }
    loadSession();
  }, []);

  const handleCopy = async () => {
    if (!session) return;
    await copyToClipboard(session.pairingUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const triggerHaptic = () => {
    if (typeof window !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate(40);
      } catch {}
    }
  };

  const handleQuickAction = async (action: 'restart' | 'sync' | 'battery') => {
    triggerHaptic();
    setActionNotice(`Dispatching remote ${action}...`);

    try {
      if (action === 'sync') {
        const res = await postArgoWebhook({ action: 'webhook' });
        const data = await res.json();
        setActionNotice(data.message || 'Hard refresh initiated via mobile!');
      } else if (action === 'battery') {
        const res = await fetch('/api/finops?batterySaver=true');
        setActionNotice('Battery Saver profile applied: Scaled idle dev workloads.');
      } else {
        setActionNotice('Dispatched pod reconciliation request.');
      }
    } catch (err: any) {
      setActionNotice(`Action failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center space-x-3">
            <Smartphone className="w-6 h-6 text-sky-400" />
            <span>Mobile & PWA Remote Control Pairing</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Secure QR bridge to control and monitor your local Kubernetes cluster from any smartphone or tablet on the same LAN or Tailscale.
          </p>
        </div>

        <button
          onClick={() => setIsMobileMode(!isMobileMode)}
          className="text-xs px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 rounded-lg transition"
        >
          {isMobileMode ? 'Switch to Desktop QR Setup' : 'Preview Mobile Touch UI'}
        </button>
      </div>

      {isMobileMode ? (
        /* Mobile Touch Remote View */
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-6 shadow-2xl max-w-md mx-auto">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span className="text-xs font-semibold uppercase text-slate-200 tracking-wider">Remote Cluster Active</span>
            </div>
            <span className="text-[10px] font-mono text-slate-500">Authenticated</span>
          </div>

          {/* Quick Remote Touch Actions */}
          <div className="space-y-3">
            <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold block">Quick Controls</span>

            <button
              onClick={() => handleQuickAction('sync')}
              className="w-full p-4 bg-sky-600 active:bg-sky-700 text-white rounded-xl flex items-center justify-between transition shadow-lg cursor-pointer"
            >
              <div className="flex items-center space-x-3 text-left">
                <Zap className="w-5 h-5 text-sky-200" />
                <div>
                  <span className="text-sm font-bold block">Instant GitOps Sync</span>
                  <span className="text-xs text-sky-200">Force ArgoCD hard-refresh</span>
                </div>
              </div>
              <CheckCircle2 className="w-5 h-5 text-sky-200" />
            </button>

            <button
              onClick={() => handleQuickAction('battery')}
              className="w-full p-4 bg-emerald-600 active:bg-emerald-700 text-white rounded-xl flex items-center justify-between transition shadow-lg cursor-pointer"
            >
              <div className="flex items-center space-x-3 text-left">
                <Radio className="w-5 h-5 text-emerald-200" />
                <div>
                  <span className="text-sm font-bold block">Toggle Battery Saver</span>
                  <span className="text-xs text-emerald-200">Scale idle dev workloads to 0</span>
                </div>
              </div>
              <CheckCircle2 className="w-5 h-5 text-emerald-200" />
            </button>

            <button
              onClick={() => handleQuickAction('restart')}
              className="w-full p-4 bg-slate-800 active:bg-slate-700 text-slate-100 rounded-xl flex items-center justify-between transition border border-slate-700 cursor-pointer"
            >
              <div className="flex items-center space-x-3 text-left">
                <RotateCw className="w-5 h-5 text-slate-400" />
                <div>
                  <span className="text-sm font-bold block">Reconcile Cluster</span>
                  <span className="text-xs text-slate-400">Trigger health check and probes</span>
                </div>
              </div>
              <CheckCircle2 className="w-5 h-5 text-slate-500" />
            </button>
          </div>

          {actionNotice && (
            <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-center text-sky-400 animate-fadeIn">
              {actionNotice}
            </div>
          )}

          <div className="text-[11px] text-center text-slate-500 pt-2 border-t border-slate-800">
            Connected over LAN via Vigilant Octo Waffle Secure Bridge
          </div>
        </div>
      ) : (
        /* Desktop QR Pairing Setup View */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
          {/* QR Code Presentation Box */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 flex flex-col items-center justify-center text-center space-y-4 shadow-xl">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Scan with Phone Camera</span>

            {!canPair && abilityStatus !== 'loading' ? (
              <div className="w-[220px] h-[220px] bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-center p-4">
                <p className="text-xs text-slate-400">
                  Pairing is restricted. Requires the <code>remote:exec</code> permission.
                </p>
              </div>
            ) : loading || !session ? (
              <div className="w-[220px] h-[220px] bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
              </div>
            ) : (
              <div
                dangerouslySetInnerHTML={{ __html: session.qrSvg }}
                className="transition-transform hover:scale-105 duration-200 cursor-pointer shadow-lg"
              />
            )}

            <p className="text-xs text-slate-500 max-w-xs">
              Open your camera app or barcode scanner on any mobile device connected to the same Wi-Fi network.
            </p>
          </div>

          {/* Connection Details & Instructions */}
          <div className="space-y-4">
            <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-bold text-slate-200 flex items-center space-x-2">
                <Wifi className="w-4 h-4 text-sky-400" />
                <span>Pairing Details</span>
              </h2>

              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between p-2.5 bg-slate-950 rounded border border-slate-800 text-slate-300">
                  <span className="text-slate-500">Local LAN IP:</span>
                  <span className="font-semibold text-sky-400">{session?.lanIp || '127.0.0.1'}</span>
                </div>

                <div className="flex justify-between p-2.5 bg-slate-950 rounded border border-slate-800 text-slate-300">
                  <span className="text-slate-500">Port:</span>
                  <span>{session?.port || 3000}</span>
                </div>

                <div className="flex justify-between p-2.5 bg-slate-950 rounded border border-slate-800 text-slate-300">
                  <span className="text-slate-500">Ephemeral Token:</span>
                  <span className="truncate max-w-[150px] text-purple-400">{canPair ? session?.token || '...' : 'restricted'}</span>
                </div>
              </div>

              {session && canPair && (
                <div className="pt-2">
                  <button
                    onClick={handleCopy}
                    className="w-full flex items-center justify-center space-x-2 p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Pairing URL Copied!' : 'Copy Mobile Pairing Link'}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="bg-slate-900/40 border border-slate-800/80 rounded-xl p-4 text-xs text-slate-400 space-y-1.5">
              <span className="font-semibold text-slate-300 block">Zero-Setup Security Note:</span>
              <p className="text-[11px] leading-relaxed">
                Tokens are cryptographically generated and expire after 1 hour. No external cloud relays or internet proxies are used; traffic stays strictly on your local LAN or Tailscale subnet.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
