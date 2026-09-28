import { NextResponse } from 'next/server';
import {
  listClusterNodeDetails,
  scaleK3dNodes,
  getK3sJoinInfo,
  saveK3sJoinScript,
  provisionK3sNodeViaSsh,
} from '@vow/orchestrator';
import { getProjectRoot } from '@/lib/project';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const nodes = await listClusterNodeDetails();
    return NextResponse.json({ nodes });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Failed to list cluster nodes', nodes: [] },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const root = getProjectRoot();
    const { action, clusterName = 'vigilant-octo-waffle', targetAgentCount, delta = 1 } = body;

    if (action === 'scale_k3d') {
      const currentNodes = await listClusterNodeDetails();
      const currentWorkers = currentNodes.filter((n) => n.role === 'worker').length;
      const target = typeof targetAgentCount === 'number' ? targetAgentCount : Math.max(1, currentWorkers + delta);
      const result = await scaleK3dNodes(clusterName, target);
      return NextResponse.json(result);
    }

    if (action === 'k3s_join_info') {
      const info = getK3sJoinInfo(root, {
        serverIp: body.serverIp,
        serverUrl: body.serverUrl,
        token: body.token,
        role: body.role,
        nodeName: body.nodeName,
        nodeIp: body.nodeIp,
        labels: body.labels,
        taints: body.taints,
      });
      return NextResponse.json({ success: true, ...info });
    }

    if (action === 'k3s_generate_script') {
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

    if (action === 'k3s_ssh_join') {
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
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `SSH node provisioning dispatched (Task: ${task.id})`,
      });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Node operation failed' },
      { status: 500 }
    );
  }
}
