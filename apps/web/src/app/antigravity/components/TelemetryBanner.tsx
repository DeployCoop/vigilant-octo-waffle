'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowRight, RefreshCw } from 'lucide-react';
import type { ClusterSnapshot } from './types';

interface TelemetryBannerProps {
  clusterSnapshot: ClusterSnapshot | null;
  fetchStatus: () => Promise<void>;
}

export default function TelemetryBanner({ clusterSnapshot, fetchStatus }: TelemetryBannerProps) {
  return (
      <div className="bg-slate-900/50 border-b border-slate-800/80 px-6 py-2 flex flex-wrap items-center justify-between text-xs text-slate-400 gap-3">
        <div className="flex items-center flex-wrap gap-4">
          <div className="flex items-center space-x-1.5">
            <span
              className={`w-2 h-2 rounded-full ${
                clusterSnapshot?.connected
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-amber-400'
              }`}
            />
            <span className="font-semibold text-slate-200">
              {clusterSnapshot?.connected ? 'Cluster Connected' : 'Cluster Offline / Initializing'}
            </span>
          </div>

          <div className="flex items-center space-x-1 font-mono text-[11px]">
            <span className="text-slate-500">Context:</span>
            <span className="text-sky-400 font-semibold">{clusterSnapshot?.context || 'none'}</span>
          </div>

          <div className="flex items-center space-x-1 font-mono text-[11px]">
            <span className="text-slate-500">Platform:</span>
            <span className="text-slate-300 uppercase font-semibold">
              {clusterSnapshot?.platform || 'KIND'}
            </span>
          </div>

          <div className="flex items-center space-x-1 text-[11px]">
            <span className="text-slate-500">Nodes:</span>
            <span className="text-slate-200 font-semibold">{clusterSnapshot?.nodeCount ?? 0}</span>
          </div>

          <div className="flex items-center space-x-1 text-[11px]">
            <span className="text-slate-500">Pods:</span>
            <span className="text-slate-200 font-semibold">{clusterSnapshot?.podCount ?? 0}</span>
          </div>

          {clusterSnapshot && clusterSnapshot.unhealthyPods.length > 0 && (
            <div className="flex items-center space-x-1 text-rose-400 bg-rose-950/40 border border-rose-800/60 px-2 py-0.5 rounded text-[11px] font-semibold animate-pulse">
              <AlertTriangle className="w-3 h-3" />
              <span>{clusterSnapshot.unhealthyPods.length} Unhealthy</span>
            </div>
          )}
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={fetchStatus}
            className="flex items-center space-x-1 text-slate-400 hover:text-sky-400 transition-colors text-[11px]"
            title="Refresh Cluster Telemetry"
          >
            <RefreshCw className="w-3 h-3" />
            <span>Refresh</span>
          </button>
          <Link
            href="/cluster"
            className="text-sky-400 hover:text-sky-300 flex items-center space-x-1 text-[11px]"
          >
            <span>Cluster Control</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
  );
}
