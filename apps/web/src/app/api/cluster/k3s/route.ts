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

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'K3s operation failed' },
      { status: 500 }
    );
  }
}
