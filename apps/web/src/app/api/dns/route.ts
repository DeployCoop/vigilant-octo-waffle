import { NextResponse } from 'next/server';
import { getProjectRoot } from '@/lib/project';
import {
  loadProjectConfig,
  generateHostsBlock,
  generateBindRecords,
  generateCloudflareRecords,
  generateCoreDnsConfig,
  getWildcardDomain,
  checkEtcHosts,
  K8sClient,
} from '@vow/orchestrator';

export async function GET(req: Request) {
  try {
    const root = getProjectRoot();
    const config = loadProjectConfig(root);
    const domain = config.cluster.domain;

    const url = new URL(req.url);
    const ipsParam = url.searchParams.get('ips');
    const ips = ipsParam ? ipsParam.split(',').map((s) => s.trim()) : ['1.2.3.4'];

    const appDomains = config.cluster.appDomains || {};
    const ecosystemDomainList = Object.values(appDomains).filter(Boolean);

    const hostsBlock = generateHostsBlock(domain, '127.0.0.1', ecosystemDomainList);
    const bindBlock = generateBindRecords(domain, ips, ecosystemDomainList);
    const cloudflareBlock = generateCloudflareRecords(domain, ips, ecosystemDomainList);
    const coreDnsBlock = generateCoreDnsConfig(domain);
    const sslipDomain = getWildcardDomain('sslip', '127.0.0.1');
    const nipDomain = getWildcardDomain('nip', '127.0.0.1');
    const status = checkEtcHosts(domain, ecosystemDomainList);

    const k8s = new K8sClient();
    const [certificates, clusterIssuers] = await Promise.all([
      k8s.getCertificates().catch(() => []),
      k8s.getClusterIssuers().catch(() => []),
    ]);

    return NextResponse.json({
      domain,
      appDomains,
      sslipDomain,
      nipDomain,
      hostsBlock,
      bindBlock,
      cloudflareBlock,
      coreDnsBlock,
      status,
      certificates,
      clusterIssuers,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
