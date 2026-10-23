'use client';

import { HardDrive } from 'lucide-react';

interface DeepDiveTabProps {
  targetVg: string;
  fsType: 'ext4' | 'xfs' | 'btrfs';
}

export default function DeepDiveTab({ targetVg, fsType }: DeepDiveTabProps) {
  return (
        <div className="space-y-6">
          <div className="p-6 bg-slate-900 border border-slate-800 rounded-2xl space-y-6 text-xs text-slate-300 leading-relaxed">
            <div className="border-b border-slate-800 pb-4">
              <h2 className="text-base font-black text-white uppercase tracking-wider flex items-center space-x-2">
                <HardDrive className="w-5 h-5 text-sky-400" />
                <span>OpenEBS Architecture &amp; Engine Mechanics</span>
              </h2>
              <p className="text-slate-400 mt-1">
                Deep dive into Kubernetes Container Attached Storage (CAS), CSI controllers, kernel block devices, and storage topologies.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                  1. LocalPV LVM (Zero Network Latency)
                </h4>
                <p className="text-[11px] text-slate-400">
                  Carves out raw logical volumes directly from a designated host Linux Volume Group (<code className="text-slate-300 font-mono">AirVG</code> on <code className="text-slate-300 font-mono">/dev/sdb</code>).
                </p>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
                  <li><strong>Line-rate I/O</strong>: Bypasses network hops completely; reads/writes occur at native SSD bus speed.</li>
                  <li><strong>Driver</strong>: <code className="text-slate-300 font-mono">local.csi.openebs.io</code> with CSI Node DaemonSet and CSI Controller StatefulSet.</li>
                  <li><strong>Topology</strong>: Automatically binds pods to the node possessing the requested Volume Group.</li>
                  <li><strong>Expansion</strong>: Online volume resizing with zero pod downtime.</li>
                </ul>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                  2. LocalPV Hostpath (Directory Storage)
                </h4>
                <p className="text-[11px] text-slate-400">
                  File-based persistent storage on the host filesystem at <code className="text-slate-300 font-mono">/var/openebs/local</code>.
                </p>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
                  <li><strong>Ideal for</strong>: Databases with built-in replication (e.g. Postgres, Redis, SeaweedFS).</li>
                  <li><strong>Provisioner</strong>: <code className="text-slate-300 font-mono">openebs.io/local</code>.</li>
                  <li><strong>Resource footprint</strong>: Ultra-lightweight memory footprint (&lt;50MB RAM).</li>
                </ul>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider">
                  3. LocalPV ZFS (Data Integrity &amp; Snapshots)
                </h4>
                <p className="text-[11px] text-slate-400">
                  Creates dedicated ZFS datasets per PVC inside a Zpool (<code className="text-slate-300 font-mono">zfspool</code>).
                </p>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
                  <li><strong>Features</strong>: Transparent ZSTD/LZ4 compression, checksumming, copy-on-write snapshots.</li>
                  <li><strong>Driver</strong>: <code className="text-slate-300 font-mono">zfs.csi.openebs.io</code>.</li>
                  <li><strong>Isolation</strong>: Independent quota limits and I/O scheduler controls per dataset.</li>
                </ul>
              </div>

              <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                  4. Replicated PV Mayastor &amp; NATS Bus
                </h4>
                <p className="text-[11px] text-slate-400">
                  Distributed NVMe-over-TCP block storage engine written in Rust for synchronous multi-node replication.
                </p>
                <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-400">
                  <li><strong>Coordination</strong>: Powered by an integrated high-speed <strong>NATS message bus</strong>.</li>
                  <li><strong>High Availability</strong>: Automatic failover if a storage node disconnects.</li>
                  <li><strong>Kernel Integration</strong>: Utilizes SPDK user-space drivers and <code className="text-slate-300 font-mono">nvme_tcp</code>.</li>
                </ul>
              </div>
            </div>

            <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
              <h4 className="text-xs font-bold text-teal-400 uppercase tracking-wider">
                Storage Allocation Flow in K3s
              </h4>
              <p className="text-[11px] text-slate-400">
                When a workload requests a PVC with <code className="text-sky-400 font-mono">storageClassName: openebs-lvmpv</code>, the Kubernetes scheduler holds binding until the pod is assigned to a node (<code className="text-slate-300 font-mono">WaitForFirstConsumer</code>). The OpenEBS LVM CSI controller executes <code className="text-slate-300 font-mono">lvcreate</code> on host Volume Group <code className="text-slate-300 font-mono">{targetVg}</code>, formats the filesystem (<code className="text-slate-300 font-mono">{fsType}</code>), and the node daemon mounts the device at <code className="text-slate-300 font-mono">/var/lib/kubelet/pods/&lt;uuid&gt;/volumes/kubernetes.io~csi/...</code>.
              </p>
            </div>
          </div>
        </div>
  );
}
