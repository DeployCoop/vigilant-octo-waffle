'use client';

import { useState, useEffect } from 'react';
import { copyToClipboard as copyText } from '@/lib/clipboard';
import { useTerminal } from '@/context/TerminalContext';
import { useAbilityContext, useCan } from '@/lib/ability';
import { apiErrorMessage } from '@/lib/envelope';

interface ClusterData {
  platform: string;
  isRunning: boolean;
  name: string;
  ingress: string;
  clusterIssuer: string;
  domain: string;
  telemetry?: {
    nodeCount: number;
    podCount: number;
    namespaceCount: number;
    ingressCount: number;
    nodes: Array<{ name: string; status: string; roles: string[]; age: string }>;
    namespaces: string[];
    ingresses: Array<{ name: string; namespace: string; host: string; class: string }>;
  };
}


export function useClusterPage() {
  const { openSignInPrompt } = useAbilityContext();
  const canManageCluster = useCan('cluster:manage');
  const canJoinNodes = useCan('cluster:nodes:join');
  const [cluster, setCluster] = useState<ClusterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [scaling, setScaling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nodeMetrics, setNodeMetrics] = useState<Record<string, { cpu: string; memory: string }>>({});
  const { openTerminal } = useTerminal();

  // K3s multi-node join & operations state
  const [showK3sModal, setShowK3sModal] = useState(false);
  const [k3sRole, setK3sRole] = useState<'agent' | 'server'>('agent');
  const [k3sServerUrl, setK3sServerUrl] = useState('');
  const [k3sToken, setK3sToken] = useState('');
  const [k3sNodeName, setK3sNodeName] = useState('');
  const [k3sNodeIp, setK3sNodeIp] = useState('');
  const [k3sLabels, setK3sLabels] = useState('');
  const [k3sSshHost, setK3sSshHost] = useState('');
  const [k3sSshPort, setK3sSshPort] = useState('22');
  const [k3sSshKey, setK3sSshKey] = useState('');
  const [k3sBatchTargets, setK3sBatchTargets] = useState('');
  const [k3sTargetsFile, setK3sTargetsFile] = useState('targets');
  const [k3sParallel, setK3sParallel] = useState('10');
  const [k3sTune, setK3sTune] = useState(true);
  const [k3sCopyRegistries, setK3sCopyRegistries] = useState(true);
  const [k3sCopyKubeconfig, setK3sCopyKubeconfig] = useState(false);
  const [k3sRegistriesFile, setK3sRegistriesFile] = useState('');
  const [k3sActiveTab, setK3sActiveTab] = useState<
    'command' | 'script' | 'ssh' | 'batch' | 'ops' | 'etcd' | 'certs' | 'cis' | 'upgrade' |
    'vip' | 'cni' | 'secrets' | 'security' | 'storage' | 'monitoring' | 'gpu' | 'sync' |
    'healer' | 'dr-drill' | 'pool'
  >('command');
  const [k3sJoinInfo, setK3sJoinInfo] = useState<any>(null);
  const [k3sLoading, setK3sLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Production state
  const [k3sHealth, setK3sHealth] = useState<any>(null);
  const [k3sEtcd, setK3sEtcd] = useState<any>(null);
  const [k3sCerts, setK3sCerts] = useState<any>(null);
  const [k3sCis, setK3sCis] = useState<any>(null);
  const [upgradeVersion, setUpgradeVersion] = useState('');
  const [upgradeDryRun, setUpgradeDryRun] = useState(false);
  const [snapshotName, setSnapshotName] = useState('');

  // Enterprise enhancements state
  const [k3sVip, setK3sVip] = useState<any>(null);
  const [k3sCni, setK3sCni] = useState<any>(null);
  const [k3sSecrets, setK3sSecrets] = useState<any>(null);
  const [k3sSecurity, setK3sSecurity] = useState<any>(null);
  const [k3sStorage, setK3sStorage] = useState<any>(null);
  const [k3sMonitoring, setK3sMonitoring] = useState<any>(null);
  const [k3sGpu, setK3sGpu] = useState<any>(null);
  const [k3sModelCache, setK3sModelCache] = useState<any>(null);

  // Cutting-Edge Autonomy state (Phases 7-10)
  const [k3sHealer, setK3sHealer] = useState<any>(null);
  const [k3sDrDrill, setK3sDrDrill] = useState<any>(null);
  const [k3sPool, setK3sPool] = useState<any>(null);
  const [poolHypervisor, setPoolHypervisor] = useState('multipass');
  const [poolRole, setPoolRole] = useState<'agent' | 'server'>('agent');
  const [poolCpu, setPoolCpu] = useState('2');
  const [poolMem, setPoolMem] = useState('4');
  const [poolDisk, setPoolDisk] = useState('20');

  const fetchK3sProductionData = async () => {
    try {
      const [hRes, eRes, cRes, cisRes, vipRes, cniRes, secRes, trivyRes, storRes, monRes, gpuRes, cacheRes, healRes, drRes, poolRes] =
        await Promise.all([
          fetch('/api/cluster/k3s?action=health'),
          fetch('/api/cluster/k3s?action=etcd'),
          fetch('/api/cluster/k3s?action=certs'),
          fetch('/api/cluster/k3s?action=cis'),
          fetch('/api/cluster/k3s?action=vip'),
          fetch('/api/cluster/k3s?action=cni'),
          fetch('/api/cluster/k3s?action=secrets'),
          fetch('/api/cluster/k3s?action=security-status'),
          fetch('/api/cluster/k3s?action=storage'),
          fetch('/api/cluster/k3s?action=monitoring'),
          fetch('/api/cluster/k3s?action=gpu'),
          fetch('/api/cluster/k3s?action=model-cache'),
          fetch('/api/cluster/k3s?action=healer'),
          fetch('/api/cluster/k3s?action=dr-drill'),
          fetch('/api/cluster/k3s?action=pool'),
        ]);
      const [
        hData,
        eData,
        cData,
        cisData,
        vipData,
        cniData,
        secData,
        trivyData,
        storData,
        monData,
        gpuData,
        cacheData,
        healData,
        drData,
        poolData,
      ] = await Promise.all([
        hRes.json(),
        eRes.json(),
        cRes.json(),
        cisRes.json(),
        vipRes.json(),
        cniRes.json(),
        secRes.json(),
        trivyRes.json(),
        storRes.json(),
        monRes.json(),
        gpuRes.json(),
        cacheRes.json(),
        healRes.json(),
        drRes.json(),
        poolRes.json(),
      ]);
      setK3sHealth(hData);
      setK3sEtcd(eData);
      setK3sCerts(cData);
      setK3sCis(cisData);
      setK3sVip(vipData);
      setK3sCni(cniData);
      setK3sSecrets(secData);
      setK3sSecurity(trivyData);
      setK3sStorage(storData);
      setK3sMonitoring(monData);
      setK3sGpu(gpuData);
      setK3sModelCache(cacheData);
      setK3sHealer(healData);
      setK3sDrDrill(drData);
      setK3sPool(poolData);
    } catch {
      // offline / ignore
    }
  };

  const fetchCluster = async () => {
    try {
      const res = await fetch('/api/cluster');
      const data = await res.json();
      setCluster(data);
    } catch {
      // offline
    } finally {
      setLoading(false);
    }
  };

  const fetchNodeMetrics = async () => {
    try {
      const res = await fetch('/api/k8s/metrics?type=node');
      const data = await res.json();
      if (data.nodes) {
        const map: Record<string, { cpu: string; memory: string }> = {};
        data.nodes.forEach((n: any) => {
          map[n.nodeName] = {
            cpu: n.cpuFormatted,
            memory: n.memoryFormatted,
          };
        });
        setNodeMetrics(map);
      }
    } catch {}
  };

  const handleScaleNodes = async (delta: number) => {
    setScaling(true);
    setMessage(null);
    try {
      const res = await fetch('/api/cluster/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scale_k3d',
          clusterName: cluster?.name || 'vigilant-octo-waffle',
          delta,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(data.message || `Scaled cluster nodes by ${delta}`);
        fetchCluster();
      } else {
        setMessage(`Scaling notice: ${data.message || apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Scale error: ${err.message}`);
    } finally {
      setScaling(false);
    }
  };

  const openK3sModal = async (tab?: 'command' | 'script' | 'ssh' | 'batch' | 'ops' | 'etcd' | 'certs' | 'cis' | 'upgrade') => {
    if (tab) setK3sActiveTab(tab);
    setShowK3sModal(true);
    fetchK3sProductionData();
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s');
      const data = await res.json();
      setK3sJoinInfo(data);
      if (data.serverUrl) setK3sServerUrl(data.serverUrl);
      if (data.token) setK3sToken(data.token);
    } catch {} finally {
      setK3sLoading(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    await copyText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2500);
  };

  const handleSaveK3sScript = async () => {
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate-script',
          role: k3sRole,
          serverUrl: k3sServerUrl || undefined,
          token: k3sToken || undefined,
          nodeName: k3sNodeName || undefined,
          nodeIp: k3sNodeIp || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`K3s ${k3sRole} join script saved to ${data.relativePath}`);
      } else {
        setMessage(`Script generation error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    }
  };

  const handleSshProvision = async () => {
    if (!k3sSshHost.trim()) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'ssh-join',
          targetHost: k3sSshHost.trim(),
          port: Number(k3sSshPort) || 22,
          sshKey: k3sSshKey.trim() || undefined,
          role: k3sRole,
          serverUrl: k3sServerUrl || undefined,
          token: k3sToken || undefined,
          nodeName: k3sNodeName || undefined,
          nodeIp: k3sNodeIp || undefined,
          tune: k3sTune,
          copyRegistries: k3sCopyRegistries,
          copyKubeconfig: k3sCopyKubeconfig,
          registriesFile: k3sRegistriesFile.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`SSH provision dispatched for ${k3sSshHost} (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, `SSH Provision: ${k3sSshHost}`);
        }
        setShowK3sModal(false);
      } else {
        setMessage(`SSH provision error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  const handleBatchJoin = async () => {
    setK3sLoading(true);
    try {
      const targetsList = k3sBatchTargets
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch-join',
          targetsFile: k3sTargetsFile.trim() || undefined,
          targets: targetsList.length > 0 ? targetsList : undefined,
          parallel: Number(k3sParallel) || 10,
          tune: k3sTune,
          copyRegistries: k3sCopyRegistries,
          copyKubeconfig: k3sCopyKubeconfig,
          registriesFile: k3sRegistriesFile.trim() || undefined,
          role: k3sRole,
          serverUrl: k3sServerUrl || undefined,
          token: k3sToken || undefined,
          sshKey: k3sSshKey.trim() || undefined,
          port: Number(k3sSshPort) || 22,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Batch join dispatched (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, `K3s Batch Join (${k3sRole})`);
        }
        setShowK3sModal(false);
      } else {
        setMessage(`Batch join error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  const handleK3sOp = async (op: 'ping' | 'tune' | 'kmod' | 'registries' | 'kill' | 'build' | 'rebuild') => {
    if (op === 'kill' && !confirm('WARNING: Are you sure you want to tear down K3s on these nodes?')) return;
    if (op === 'rebuild' && !confirm('WARNING: Full rebuild will teardown existing cluster and recreate all nodes. Proceed?')) return;
    setK3sLoading(true);
    try {
      const targetsList = k3sBatchTargets
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: op,
          targetsFile: k3sTargetsFile.trim() || undefined,
          targets: targetsList.length > 0 ? targetsList : undefined,
          remoteHost: k3sSshHost.trim() || undefined,
          port: Number(k3sSshPort) || 22,
          sshKey: k3sSshKey.trim() || undefined,
          parallel: Number(k3sParallel) || 10,
          all: true,
          copyKubeconfig: true,
          registriesFile: k3sRegistriesFile.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`K3s ${op} operation dispatched (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, `K3s ${op.toUpperCase()}`);
        }
        setShowK3sModal(false);
      } else {
        setMessage(`Operation error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  const handleDrainNode = async (nodeName: string) => {
    if (!confirm(`Are you sure you want to drain node ${nodeName}? This will evict all workload pods for maintenance.`)) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'drain', nodeName }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Node drain dispatched for ${nodeName} (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, `Drain Node: ${nodeName}`);
        }
        fetchCluster();
      } else {
        setMessage(`Drain error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  const handleCordonNode = async (nodeName: string) => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cordon', nodeName }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Node ${nodeName} cordoned.`);
        fetchCluster();
      } else {
        setMessage(`Cordon error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  const handleUncordonNode = async (nodeName: string) => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'uncordon', nodeName }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Node ${nodeName} uncordoned (schedulable).`);
        fetchCluster();
      } else {
        setMessage(`Uncordon error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  const handleSnapshotOp = async (operation: 'save' | 'restore' | 'delete' | 'defrag', targetName?: string) => {
    if (operation === 'restore' && !confirm(`DANGER: Restoring snapshot '${targetName}' will replace the active etcd database. Proceed?`)) return;
    if (operation === 'delete' && !confirm(`Are you sure you want to delete snapshot '${targetName}'?`)) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'snapshot', operation, name: targetName || snapshotName.trim() || undefined }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`etcd snapshot ${operation} task started (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, `etcd Snapshot: ${operation}`);
        }
        if (operation === 'save') setSnapshotName('');
        setTimeout(fetchK3sProductionData, 2000);
      } else {
        setMessage(`Snapshot error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  const handleTakeSnapshot = () => handleSnapshotOp('save');

  const handleRotateCerts = async () => {
    if (!confirm('Rotate all internal TLS certificates and reload K3s services?')) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rotate-certs' }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Certificate rotation dispatched (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, 'Rotate K3s Certificates');
        }
        setTimeout(fetchK3sProductionData, 3000);
      } else {
        setMessage(`Rotation error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  const handleUpgrade = async () => {
    if (!confirm(`Trigger zero-downtime rolling upgrade to ${upgradeVersion || 'latest stable'}?`)) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upgrade',
          options: {
            targetVersion: upgradeVersion.trim() || undefined,
            dryRun: upgradeDryRun,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Rolling upgrade started (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, `K3s Upgrade (${upgradeVersion || 'latest'})`);
        }
        setShowK3sModal(false);
      } else {
        setMessage(`Upgrade error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setK3sLoading(false);
    }
  };

  const handleVipSetup = async (vipAddr: string, iface: string) => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vip-setup', options: { vip: vipAddr, interface: iface } }),
      });
      const data = await res.json();
      setMessage(data.message || 'VIP setup dispatched');
      setTimeout(fetchK3sProductionData, 3000);
    } catch (e: any) { setMessage(`VIP error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleVipTeardown = async () => {
    if (!confirm('Tear down kube-vip floating virtual IP?')) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'vip-teardown' }),
      });
      const data = await res.json();
      setMessage(data.message || 'VIP teardown dispatched');
      setTimeout(fetchK3sProductionData, 2000);
    } catch (e: any) { setMessage(`Error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleCniInstall = async () => {
    if (!confirm('Deploy Cilium eBPF CNI with Hubble visualizer and Tetragon security sensor?')) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cni-install', options: { withHubble: true, withTetragon: true } }),
      });
      const data = await res.json();
      setMessage(data.message || 'Cilium installation task dispatched');
      setTimeout(fetchK3sProductionData, 3000);
    } catch (e: any) { setMessage(`CNI error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleSecretsRotate = async () => {
    if (!confirm('Rotate secrets encryption AES key in etcd and re-encrypt all stored secrets?')) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'secrets-rotate' }),
      });
      const data = await res.json();
      setMessage(data.message || 'Secrets rotation task dispatched');
      setTimeout(fetchK3sProductionData, 3000);
    } catch (e: any) { setMessage(`Rotation error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleSecurityScan = async () => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'security-scan' }),
      });
      const data = await res.json();
      setMessage(data.message || 'Container security audit dispatched');
      setTimeout(fetchK3sProductionData, 3000);
    } catch (e: any) { setMessage(`Scan error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleStorageInstall = async (engine: 'longhorn' | 'openebs') => {
    if (!confirm(`Deploy ${engine === 'longhorn' ? 'Longhorn Distributed Storage' : 'OpenEBS'} into the cluster?`)) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'storage-install', options: { engine, replicas: 2 } }),
      });
      const data = await res.json();
      setMessage(data.message || 'Storage installation dispatched');
      setTimeout(fetchK3sProductionData, 3000);
    } catch (e: any) { setMessage(`Storage error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleMonitoringInstall = async () => {
    if (!confirm('Deploy VictoriaMetrics and proactive alerting rules into monitoring namespace?')) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'monitoring-install', options: { retention: '1M' } }),
      });
      const data = await res.json();
      setMessage(data.message || 'VictoriaMetrics deployment dispatched');
      setTimeout(fetchK3sProductionData, 3000);
    } catch (e: any) { setMessage(`Monitoring error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleAlertTest = async () => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'alert-dispatch', title: 'Test Alert', message: 'Manual test from dashboard', severity: 'info' }),
      });
      const data = await res.json();
      setMessage(data.message || 'Test alert dispatched');
    } catch (e: any) { setMessage(`Alert error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleGpuSetup = async () => {
    if (!confirm('Configure containerd for NVIDIA GPU acceleration and deploy device plugin?')) return;
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gpu-setup' }),
      });
      const data = await res.json();
      setMessage(data.message || 'GPU accelerator setup dispatched');
      setTimeout(fetchK3sProductionData, 3000);
    } catch (e: any) { setMessage(`GPU error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleModelCacheSetup = async () => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'model-cache-setup', options: { size: '50Gi' } }),
      });
      const data = await res.json();
      setMessage(data.message || 'Model cache PVC created');
      setTimeout(fetchK3sProductionData, 2000);
    } catch (e: any) { setMessage(`Cache error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleBackupSync = async () => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backup-sync', options: { action: 'push', encrypt: true } }),
      });
      const data = await res.json();
      setMessage(data.message || 'Encrypted remote DR sync dispatched');
    } catch (e: any) { setMessage(`Sync error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleAirgapBundle = async () => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'airgap-bundle' }),
      });
      const data = await res.json();
      setMessage(data.message || 'Airgap bundle generation started');
    } catch (e: any) { setMessage(`Bundle error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleHealerRun = async (autoRemediate = true, runbook?: string) => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'healer-run', autoRemediate, runbook }),
      });
      const data = await res.json();
      setMessage(data.message || 'Autonomous Healer run initiated');
      setTimeout(fetchK3sProductionData, 2000);
    } catch (e: any) { setMessage(`Healer error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handleDrDrillRun = async (dryRun = false) => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dr-drill-run', dryRun, namespace: 'dr-sandbox' }),
      });
      const data = await res.json();
      setMessage(data.message || 'Disaster Recovery Game Day drill initiated');
      setTimeout(fetchK3sProductionData, 3000);
    } catch (e: any) { setMessage(`DR Drill error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handlePoolProvision = async () => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'pool-provision',
          hypervisor: poolHypervisor,
          role: poolRole,
          cpu: Number(poolCpu),
          memGb: Number(poolMem),
          diskGb: Number(poolDisk),
        }),
      });
      const data = await res.json();
      setMessage(data.message || 'Hybrid node provisioning initiated');
      setTimeout(fetchK3sProductionData, 3000);
    } catch (e: any) { setMessage(`Pool error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  const handlePoolDrain = async () => {
    setK3sLoading(true);
    try {
      const res = await fetch('/api/cluster/k3s', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pool-drain', maxIdleMinutes: 30 }),
      });
      const data = await res.json();
      setMessage(data.message || 'Idle node drain initiated');
      setTimeout(fetchK3sProductionData, 2000);
    } catch (e: any) { setMessage(`Drain error: ${e.message}`); } finally { setK3sLoading(false); }
  };

  useEffect(() => {
    fetchCluster();
    fetchNodeMetrics();
    fetchK3sProductionData();
    const interval = setInterval(() => {
      fetchCluster();
      fetchNodeMetrics();
      fetchK3sProductionData();
    }, 8000);
    return () => clearInterval(interval);
  }, []);


  const handleAction = async (action: 'start' | 'stop' | 'up') => {
    if (action === 'stop' && !confirm('Are you sure you want to delete the local cluster?')) return;
    setActionLoading(true);
    setMessage(null);
    try {
      let res;
      if (action === 'stop') {
        res = await fetch('/api/cluster', { method: 'DELETE' });
      } else {
        res = await fetch('/api/cluster', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
      }
      const data = await res.json();
      if (data.success) {
        setMessage(`Action '${action}' dispatched (Task ID: ${data.taskId})`);
        if (data.taskId) {
          openTerminal(data.taskId, `Cluster Action: ${action}`);
        }
      } else {
        setMessage(`Error: ${apiErrorMessage(data)}`);
      }
    } catch (err: any) {
      setMessage(`Failed: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  };

  return {
    openSignInPrompt, canManageCluster, canJoinNodes, cluster, setCluster, loading, setLoading, actionLoading, setActionLoading, scaling, setScaling, message, setMessage, nodeMetrics, setNodeMetrics, openTerminal, showK3sModal, setShowK3sModal, k3sRole, setK3sRole, k3sServerUrl, setK3sServerUrl, k3sToken, setK3sToken, k3sNodeName, setK3sNodeName, k3sNodeIp, setK3sNodeIp, k3sLabels, setK3sLabels, k3sSshHost, setK3sSshHost, k3sSshPort, setK3sSshPort, k3sSshKey, setK3sSshKey, k3sBatchTargets, setK3sBatchTargets, k3sTargetsFile, setK3sTargetsFile, k3sParallel, setK3sParallel, k3sTune, setK3sTune, k3sCopyRegistries, setK3sCopyRegistries, k3sCopyKubeconfig, setK3sCopyKubeconfig, k3sRegistriesFile, setK3sRegistriesFile, k3sActiveTab, setK3sActiveTab, k3sJoinInfo, setK3sJoinInfo, k3sLoading, setK3sLoading, copied, setCopied, k3sHealth, setK3sHealth, k3sEtcd, setK3sEtcd, k3sCerts, setK3sCerts, k3sCis, setK3sCis, upgradeVersion, setUpgradeVersion, upgradeDryRun, setUpgradeDryRun, snapshotName, setSnapshotName, k3sVip, setK3sVip, k3sCni, setK3sCni, k3sSecrets, setK3sSecrets, k3sSecurity, setK3sSecurity, k3sStorage, setK3sStorage, k3sMonitoring, setK3sMonitoring, k3sGpu, setK3sGpu, k3sModelCache, setK3sModelCache, k3sHealer, setK3sHealer, k3sDrDrill, setK3sDrDrill, k3sPool, setK3sPool, poolHypervisor, setPoolHypervisor, poolRole, setPoolRole, poolCpu, setPoolCpu, poolMem, setPoolMem, poolDisk, setPoolDisk, fetchK3sProductionData, fetchCluster, fetchNodeMetrics, handleScaleNodes, openK3sModal, copyToClipboard, handleSaveK3sScript, handleSshProvision, handleBatchJoin, handleK3sOp, handleDrainNode, handleCordonNode, handleUncordonNode, handleSnapshotOp, handleTakeSnapshot, handleRotateCerts, handleUpgrade, handleVipSetup, handleVipTeardown, handleCniInstall, handleSecretsRotate, handleSecurityScan, handleStorageInstall, handleMonitoringInstall, handleAlertTest, handleGpuSetup, handleModelCacheSetup, handleBackupSync, handleAirgapBundle, handleHealerRun, handleDrDrillRun, handlePoolProvision, handlePoolDrain, handleAction,
  };
}

export type ClusterPageState = ReturnType<typeof useClusterPage>;
