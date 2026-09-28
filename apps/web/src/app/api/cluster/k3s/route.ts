import { NextResponse } from 'next/server';
import {
  getK3sJoinInfo,
  saveK3sJoinScript,
  provisionK3sNodeViaSsh,
  listClusterNodeDetails,
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
      });
      return NextResponse.json({
        success: true,
        taskId: task.id,
        message: `SSH node provisioning started (Task: ${task.id})`,
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
