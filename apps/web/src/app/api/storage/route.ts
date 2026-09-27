import { NextResponse } from 'next/server';
import { K8sClient } from '@vow/orchestrator';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const k8sClient = new K8sClient();
    const storage = await k8sClient.getStorage();
    return NextResponse.json(storage);
  } catch (err: any) {
    return NextResponse.json(
      { storageClasses: [], persistentVolumes: [], persistentVolumeClaims: [], error: err.message },
      { status: 500 }
    );
  }
}
