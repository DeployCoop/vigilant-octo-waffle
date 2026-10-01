import { NextResponse } from 'next/server';
import {
  getK3sJoinInfo,
  saveK3sJoinScript,
  provisionK3sNodeViaSsh,
  provisionK3sBatchNodes,
  tuneK3sNode,
  kmodK3sNode,
  pingK3sNodes,
  killK3sCluster,
  buildK3sCluster,
  upK3sCluster,
  deployK3sRegistries,
  listClusterNodeDetails,
  getK3sHealth,
  getEtcdSnapshots,
  manageEtcdSnapshot,
  drainK3sNode,
  uncordonK3sNode,
  cordonK3sNode,
  checkK3sCertificates,
  rotateK3sCertificates,
  auditK3sCis,
  upgradeK3sCluster,
  getK3sVipStatus,
  setupK3sVip,
  teardownK3sVip,
  syncK3sBackups,
  bundleK3sAirgap,
  getK3sCniStatus,
  installK3sCni,
  getK3sSecretsStatus,
  rotateK3sSecrets,
  getK3sSecurityStatus,
  scanK3sSecurity,
  getK3sStorageStatus,
  installK3sStorage,
  snapshotK3sVolume,
  getK3sMonitoringStatus,
  installK3sMonitoring,
  dispatchAlert,
  getK3sGpuStatus,
  setupK3sGpu,
  getK3sModelCacheStatus,
  setupK3sModelCache,
  preloadK3sModel,
  getK3sHealerStatus,
  runK3sHealer,
  getK3sDrDrillStatus,
  runK3sDrDrill,
  getK3sGatewayStatus,
  installK3sGatewayCrds,
  deployK3sGateway,
  createK3sCanaryRoute,
  getK3sPoolStatus,
  provisionK3sPooledNode,
  drainIdleK3sNodes,
  getK3sFinOpsStatus,
  applyK3sRightSizing,
  getCopilotTools,
  executeCopilotTool,
} from '@vow/orchestrator';
import { getProjectRoot } from '@/lib/project';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const root = getProjectRoot();
    const { searchParams } = new URL(req.url);
    const role = (searchParams.get('role') || 'agent') as 'agent' | 'server';
    const serverUrl = searchParams.get('serverUrl') || undefined;
    const token = searchParams.get('token') || undefined;

    const action = searchParams.get('action');
    if (action === 'health') {
      const health = await getK3sHealth(root);
      return NextResponse.json(health);
    }
    if (action === 'etcd') {
      const etcd = await getEtcdSnapshots(root);
      return NextResponse.json(etcd);
    }
    if (action === 'certs') {
      const certs = await checkK3sCertificates(root);
      return NextResponse.json(certs);
    }
    if (action === 'cis') {
      const cis = await auditK3sCis(root);
      return NextResponse.json(cis);
    }
    if (action === 'vip') {
      const vip = await getK3sVipStatus(root, {
        vip: searchParams.get('vip') || undefined,
        interface: searchParams.get('interface') || undefined,
      });
      return NextResponse.json(vip);
    }
    if (action === 'cni') {
      const cni = await getK3sCniStatus(root);
      return NextResponse.json(cni);
    }
    if (action === 'secrets') {
      const secrets = await getK3sSecretsStatus(root);
      return NextResponse.json(secrets);
    }
    if (action === 'security-status') {
      const sec = await getK3sSecurityStatus(root);
      return NextResponse.json(sec);
    }
    if (action === 'storage') {
      const storage = await getK3sStorageStatus(root);
      return NextResponse.json(storage);
    }
    if (action === 'monitoring') {
      const mon = await getK3sMonitoringStatus(root);
      return NextResponse.json(mon);
    }
    if (action === 'gpu') {
      const gpu = await getK3sGpuStatus(root);
      return NextResponse.json(gpu);
    }
    if (action === 'model-cache') {
      const cache = await getK3sModelCacheStatus(root);
      return NextResponse.json(cache);
    }
    if (action === 'healer') {
      const healer = await getK3sHealerStatus(root);
      return NextResponse.json(healer);
    }
    if (action === 'dr-drill') {
      const drill = await getK3sDrDrillStatus(root);
      return NextResponse.json(drill);
    }
    if (action === 'gateway') {
      const gw = await getK3sGatewayStatus(root);
      return NextResponse.json(gw);
    }
    if (action === 'pool') {
      const pool = await getK3sPoolStatus(root);
      return NextResponse.json(pool);
    }
    if (action === 'finops') {
      const finops = await getK3sFinOpsStatus(root);
      return NextResponse.json(finops);
    }
    if (action === 'copilot-tools') {
      const tools = getCopilotTools();
      return NextResponse.json(tools);
    }

    const joinInfo = getK3sJoinInfo(root, { role, serverUrl, token });
    const nodes = await listClusterNodeDetails();

    return NextResponse.json({
      ...joinInfo,
      nodes,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to retrieve K3s cluster join details' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const root = getProjectRoot();
    const body = await req.json();
    const { action = 'join-info' } = body;

    if (action === 'join-info') {
      const joinInfo = getK3sJoinInfo(root, {
        role: body.role,
        serverUrl: body.serverUrl,
        serverIp: body.serverIp,
        token: body.token,
        nodeName: body.nodeName,
        nodeIp: body.nodeIp,
        labels: body.labels,
        taints: body.taints,
      });
      return NextResponse.json({ success: true, ...joinInfo });
    }

    if (action === 'generate-script') {
      const saved = saveK3sJoinScript(root, {
        role: body.role || 'agent',
        serverUrl: body.serverUrl,
        serverIp: body.serverIp,
        token: body.token,
        nodeName: body.nodeName,
        nodeIp: body.nodeIp,
        labels: body.labels,
        taints: body.taints,
      }, body.fileName);
      return NextResponse.json({ success: true, ...saved });
    }

    if (action === 'ssh-join') {
      if (!body.targetHost) {
        return NextResponse.json({ error: 'Target host (user@ip) is required for SSH provisioning' }, { status: 400 });
      }
      const task = provisionK3sNodeViaSsh(root, {
        targetHost: body.targetHost,
        role: body.role || 'agent',
        port: body.port ? Number(body.port) : 22,
        sshKey: body.sshKey,
        serverUrl: body.serverUrl,
        token: body.token,
        nodeName: body.nodeName,
        nodeIp: body.nodeIp,
        labels: body.labels,
        taints: body.taints,
        tune: body.tune === true,
        copyRegistries: body.copyRegistries === true,
        registriesFile: body.registriesFile,
        copyKubeconfig: body.copyKubeconfig === true,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `SSH node provisioning started (Task: ${task.id})`,
      });
    }

    if (action === 'batch-join') {
      const task = provisionK3sBatchNodes(root, {
        targetsFile: body.targetsFile,
        targets: body.targets,
        role: body.role || 'agent',
        parallel: body.parallel ? Number(body.parallel) : 10,
        tune: body.tune !== false,
        copyRegistries: body.copyRegistries !== false,
        registriesFile: body.registriesFile,
        copyKubeconfig: body.copyKubeconfig === true,
        port: body.port ? Number(body.port) : 22,
        sshKey: body.sshKey,
        serverUrl: body.serverUrl,
        token: body.token,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Batch node provisioning started (Task: ${task.id})`,
      });
    }

    if (action === 'tune') {
      const task = tuneK3sNode(root, {
        remoteHost: body.remoteHost,
        targetsFile: body.targetsFile,
        sshPort: body.port ? Number(body.port) : 22,
        sshKey: body.sshKey,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Node OS limits tuning started (Task: ${task.id})`,
      });
    }

    if (action === 'kmod') {
      const task = kmodK3sNode(root, {
        remoteHost: body.remoteHost,
        targetsFile: body.targetsFile,
        sshPort: body.port ? Number(body.port) : 22,
        sshKey: body.sshKey,
        modules: body.modules,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Kernel module provisioning started (Task: ${task.id})`,
      });
    }

    if (action === 'ping') {
      const task = pingK3sNodes(root, {
        targetsFile: body.targetsFile,
        remoteHost: body.remoteHost,
        sshPort: body.port ? Number(body.port) : 22,
        sshKey: body.sshKey,
        parallel: body.parallel ? Number(body.parallel) : 10,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Cluster nodes ping check started (Task: ${task.id})`,
      });
    }

    if (action === 'kill') {
      const task = killK3sCluster(root, {
        local: body.local === true,
        all: body.all === true,
        remoteHost: body.remoteHost,
        targetsFile: body.targetsFile,
        parallel: body.parallel ? Number(body.parallel) : 10,
        sshPort: body.port ? Number(body.port) : 22,
        sshKey: body.sshKey,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `K3s cluster teardown started (Task: ${task.id})`,
      });
    }

    if (action === 'build' || action === 'rebuild') {
      const task = buildK3sCluster(root, {
        rebuild: action === 'rebuild' || body.rebuild === true,
        targetsFile: body.targetsFile,
        parallel: body.parallel ? Number(body.parallel) : 10,
        skipJoin: body.skipJoin === true,
        skipTune: body.skipTune === true,
        skipUp: body.skipUp === true,
        registriesFile: body.registriesFile,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `K3s cluster ${action === 'rebuild' ? 'rebuild' : 'build'} started (Task: ${task.id})`,
      });
    }

    if (action === 'up') {
      const task = upK3sCluster(root, {
        targetsFile: body.targetsFile,
        parallel: body.parallel ? Number(body.parallel) : 10,
        skipJoin: body.skipJoin === true,
        skipTune: body.skipTune === true,
        runPlatformUp: body.runPlatformUp === true,
        registriesFile: body.registriesFile,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `K3s cluster bring-up started (Task: ${task.id})`,
      });
    }

    if (action === 'registries') {
      const task = deployK3sRegistries(root, {
        remoteHost: body.remoteHost,
        targetsFile: body.targetsFile,
        registriesFile: body.registriesFile,
        copyKubeconfig: body.copyKubeconfig === true,
        sshPort: body.port ? Number(body.port) : 22,
        sshKey: body.sshKey,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `K3s registries deployment started (Task: ${task.id})`,
      });
    }

    if (action === 'snapshot') {
      const operation = body.operation || 'save';
      const task = manageEtcdSnapshot(root, operation, body.name || body.target);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `etcd snapshot ${operation} task started (Task: ${task.id})`,
      });
    }

    if (action === 'drain') {
      if (!body.nodeName) {
        return NextResponse.json({ error: 'Node name is required for drain operation' }, { status: 400 });
      }
      const task = drainK3sNode(root, body.nodeName, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Node drain task started for ${body.nodeName} (Task: ${task.id})`,
      });
    }

    if (action === 'uncordon') {
      if (!body.nodeName) {
        return NextResponse.json({ error: 'Node name is required for uncordon operation' }, { status: 400 });
      }
      const task = uncordonK3sNode(root, body.nodeName);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Node uncordon task started for ${body.nodeName} (Task: ${task.id})`,
      });
    }

    if (action === 'cordon') {
      if (!body.nodeName) {
        return NextResponse.json({ error: 'Node name is required for cordon operation' }, { status: 400 });
      }
      const task = cordonK3sNode(root, body.nodeName);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Node cordon task started for ${body.nodeName} (Task: ${task.id})`,
      });
    }

    if (action === 'rotate-certs') {
      const task = rotateK3sCertificates(root);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `TLS certificate rotation task started (Task: ${task.id})`,
      });
    }

    if (action === 'upgrade') {
      const task = upgradeK3sCluster(root, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `K3s zero-downtime rolling upgrade started (Task: ${task.id})`,
      });
    }

    if (action === 'vip-setup') {
      const task = setupK3sVip(root, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `kube-vip deployment task started (Task: ${task.id})`,
      });
    }

    if (action === 'vip-teardown') {
      const task = teardownK3sVip(root);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `kube-vip teardown task started (Task: ${task.id})`,
      });
    }

    if (action === 'backup-sync') {
      const task = syncK3sBackups(root, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Disaster recovery backup sync task started (Task: ${task.id})`,
      });
    }

    if (action === 'airgap-bundle') {
      const task = bundleK3sAirgap(root, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Air-gapped bundle generator task started (Task: ${task.id})`,
      });
    }

    if (action === 'cni-install') {
      const task = installK3sCni(root, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Cilium eBPF CNI installation started (Task: ${task.id})`,
      });
    }

    if (action === 'secrets-rotate') {
      const task = rotateK3sSecrets(root, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Secrets encryption key rotation started (Task: ${task.id})`,
      });
    }

    if (action === 'security-scan') {
      const task = scanK3sSecurity(root, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Trivy container security audit started (Task: ${task.id})`,
      });
    }

    if (action === 'storage-install') {
      const task = installK3sStorage(root, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Distributed storage deployment started (Task: ${task.id})`,
      });
    }

    if (action === 'storage-snapshot') {
      const task = snapshotK3sVolume(root, body.pvcName, body.snapshotName);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `VolumeSnapshot initiated for ${body.pvcName} (Task: ${task.id})`,
      });
    }

    if (action === 'monitoring-install') {
      const task = installK3sMonitoring(root, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `VictoriaMetrics observability deployment started (Task: ${task.id})`,
      });
    }

    if (action === 'alert-dispatch') {
      const task = dispatchAlert(root, {
        title: body.title || 'Cluster Alert',
        message: body.message || 'Notification triggered from dashboard',
        severity: body.severity,
        source: body.source,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Alert dispatched to notification channels (Task: ${task.id})`,
      });
    }

    if (action === 'gpu-setup') {
      const task = setupK3sGpu(root, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `K3s GPU accelerator setup started (Task: ${task.id})`,
      });
    }

    if (action === 'model-cache-setup') {
      const task = setupK3sModelCache(root, body.options);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Shared model cache deployment started (Task: ${task.id})`,
      });
    }

    if (action === 'model-cache-preload') {
      const task = preloadK3sModel(root, body.modelName, body.namespace);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Model preload started for ${body.modelName} (Task: ${task.id})`,
      });
    }

    if (action === 'healer-run') {
      const task = runK3sHealer(root, {
        autoRemediate: body.autoRemediate,
        dryRun: body.dryRun,
        runbook: body.runbook,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Autonomous Healer run initiated (Task: ${task.id})`,
      });
    }

    if (action === 'repair-gotrue') {
      const task = runK3sHealer(root, {
        autoRemediate: true,
        dryRun: false,
        runbook: 'runbook_supabase_compat',
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Supabase GoTrue compatibility repair initiated (Task: ${task.id})`,
      });
    }

    if (action === 'dr-drill-run') {
      const task = runK3sDrDrill(root, {
        dryRun: body.dryRun,
        snapshot: body.snapshot,
        namespace: body.namespace,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Disaster Recovery Game Day drill initiated (Task: ${task.id})`,
      });
    }

    if (action === 'gateway-install-crds') {
      const task = installK3sGatewayCrds(root);
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Gateway API CRDs installation initiated (Task: ${task.id})`,
      });
    }

    if (action === 'gateway-deploy') {
      const task = deployK3sGateway(root, {
        namespace: body.namespace,
        gatewayName: body.gatewayName,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Gateway deployment initiated (Task: ${task.id})`,
      });
    }

    if (action === 'gateway-canary') {
      const task = createK3sCanaryRoute(root, {
        name: body.name || 'canary-route',
        namespace: body.namespace,
        hostname: body.hostname,
        stableService: body.stableService,
        stableWeight: Number(body.stableWeight || 80),
        canaryService: body.canaryService,
        canaryWeight: Number(body.canaryWeight || 20),
        pathPrefix: body.pathPrefix,
        dryRun: body.dryRun,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Gateway API HTTPRoute canary created (Task: ${task.id})`,
      });
    }

    if (action === 'pool-provision') {
      const task = provisionK3sPooledNode(root, {
        hypervisor: body.hypervisor,
        role: body.role,
        cpu: body.cpu ? Number(body.cpu) : undefined,
        memGb: body.memGb ? Number(body.memGb) : undefined,
        diskGb: body.diskGb ? Number(body.diskGb) : undefined,
        dryRun: body.dryRun,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Hybrid pooled node provisioning initiated (Task: ${task.id})`,
      });
    }

    if (action === 'pool-drain') {
      const task = drainIdleK3sNodes(root, {
        maxIdleMinutes: body.maxIdleMinutes ? Number(body.maxIdleMinutes) : undefined,
        dryRun: body.dryRun,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `Idle node drain initiated (Task: ${task.id})`,
      });
    }

    if (action === 'finops-apply') {
      const task = applyK3sRightSizing(root, body.workload, {
        namespace: body.namespace,
        dryRun: body.dryRun,
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `P95 Right-sizing patch applied to ${body.workload} (Task: ${task.id})`,
      });
    }

    if (action === 'copilot-tool-exec') {
      const res = await executeCopilotTool(root, body.toolId, body.params);
      return NextResponse.json(res);
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'K3s operation failed' },
      { status: 500 }
    );
  }
}
