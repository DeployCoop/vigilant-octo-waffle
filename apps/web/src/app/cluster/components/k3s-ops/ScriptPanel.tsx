'use client';

import {
  Copy,
  Check,
  Download,
} from 'lucide-react';
import type { ClusterPageState } from '../../useClusterPage';

export default function ScriptPanel({ state }: { state: ClusterPageState }) {
  const { k3sRole, k3sServerUrl, k3sToken, k3sNodeName, k3sNodeIp, k3sLabels, copied, copyToClipboard, handleSaveK3sScript } = state;
  return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Generated standalone bash script for the target node:</span>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={handleSaveK3sScript}
                        className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-purple-300 rounded text-xs font-medium flex items-center space-x-1 border border-slate-700"
                      >
                        <Download className="w-3 h-3" />
                        <span>Save to .secrets/</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          copyToClipboard(
                            `#!/usr/bin/env bash\nset -euo pipefail\nexport K3S_URL="${k3sServerUrl || 'https://<SERVER_IP>:6443'}"\nexport K3S_TOKEN="${k3sToken || '<TOKEN>'}"\necho "==> Joining K3s cluster at \${K3S_URL} as ${k3sRole}..."\ncurl -sfL https://get.k3s.io | sh -s - ${k3sRole}${k3sNodeName ? ` --node-name ${k3sNodeName}` : ''}${k3sNodeIp ? ` --node-ip ${k3sNodeIp}` : ''}${k3sLabels ? ` ${k3sLabels.split(',').filter(Boolean).map((l) => `--node-label ${l.trim()}`).join(' ')}` : ''}\necho "==> Node successfully joined!"`,
                            'script'
                          )
                        }
                        className="text-purple-400 hover:text-purple-300 font-medium flex items-center space-x-1"
                      >
                        {copied === 'script' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copied === 'script' ? 'Copied!' : 'Copy Script'}</span>
                      </button>
                    </div>
                  </div>
                  <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed">
{`#!/usr/bin/env bash
set -euo pipefail

export K3S_URL="${k3sServerUrl || 'https://<SERVER_IP>:6443'}"
export K3S_TOKEN="${k3sToken || '<TOKEN>'}"

echo "==> Joining K3s cluster at \${K3S_URL} as ${k3sRole}..."
curl -sfL https://get.k3s.io | sh -s - ${k3sRole}${k3sNodeName ? ` --node-name ${k3sNodeName}` : ''}${k3sNodeIp ? ` --node-ip ${k3sNodeIp}` : ''}${k3sLabels ? ` ${k3sLabels.split(',').filter(Boolean).map((l) => `--node-label ${l.trim()}`).join(' ')}` : ''}

echo "==> Node successfully joined!"`}
                  </pre>
                </div>
  );
}
