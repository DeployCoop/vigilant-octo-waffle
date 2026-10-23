'use client';

import {
  Copy,
  Check,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function CommandPanel({ state }: { state: ClusterPageState }) {
  const { k3sRole, k3sServerUrl, k3sToken, k3sNodeName, k3sNodeIp, k3sLabels, copied, copyToClipboard } = state;
  return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Run this command as root (or sudo) on the target machine:</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(
                          `curl -sfL https://get.k3s.io | K3S_URL="${k3sServerUrl || 'https://<SERVER_IP>:6443'}" K3S_TOKEN="${k3sToken || '<TOKEN>'}" sh -s - ${k3sRole}${k3sNodeName ? ` --node-name ${k3sNodeName}` : ''}${k3sNodeIp ? ` --node-ip ${k3sNodeIp}` : ''}${k3sLabels ? ` ${k3sLabels.split(',').filter(Boolean).map((l) => `--node-label ${l.trim()}`).join(' ')}` : ''}`,
                          'oneliner'
                        )
                      }
                      className="text-purple-400 hover:text-purple-300 font-medium flex items-center space-x-1"
                    >
                      {copied === 'oneliner' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied === 'oneliner' ? 'Copied!' : 'Copy Command'}</span>
                    </button>
                  </div>
                  <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 whitespace-pre-wrap break-all leading-relaxed">
                    {`curl -sfL https://get.k3s.io | K3S_URL="${k3sServerUrl || 'https://<SERVER_IP>:6443'}" K3S_TOKEN="${k3sToken || '<TOKEN>'}" sh -s - ${k3sRole}${k3sNodeName ? ` --node-name ${k3sNodeName}` : ''}${k3sNodeIp ? ` --node-ip ${k3sNodeIp}` : ''}${k3sLabels ? ` ${k3sLabels.split(',').filter(Boolean).map((l) => `--node-label ${l.trim()}`).join(' ')}` : ''}`}
                  </pre>
                </div>
  );
}
