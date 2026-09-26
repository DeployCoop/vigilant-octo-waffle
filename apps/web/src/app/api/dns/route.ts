import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  loadProjectConfig,
  generateHostsBlock,
  generateBindRecords,
  generateCloudflareRecords,
  checkEtcHosts,
} from '@vow/orchestrator';

export async function GET(req: Request) {
  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const domain = config.cluster.domain;

    const url = new URL(req.url);
    const ipsParam = url.searchParams.get('ips');
    const ips = ipsParam ? ipsParam.split(',').map((s) => s.trim()) : ['1.2.3.4'];

    const hostsBlock = generateHostsBlock(domain);
    const bindBlock = generateBindRecords(domain, ips);
    const cloudflareBlock = generateCloudflareRecords(domain, ips);
    const status = checkEtcHosts(domain);

    return NextResponse.json({
      domain,
      hostsBlock,
      bindBlock,
      cloudflareBlock,
      status,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
