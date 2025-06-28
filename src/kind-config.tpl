kind: Cluster
name: vigilant-octo-waffle
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  kubeadmConfigPatches:
  - |
    kind: InitConfiguration
    nodeRegistration:
      kubeletExtraArgs:
        node-labels: "ingress-controller=true"
  labels:
    opensearchrole: controlplane
  extraMounts:
  - hostPath: ${THIS_STORAGE_PATH}/controlplane1
    containerPath: /mnt/xfs_backup/example
- role: worker
  labels:
    tier: frontend
    opensearchrole: worker
  extraPortMappings:
  - containerPort: 80
    hostPort: 80
    protocol: TCP
  - containerPort: 443
    hostPort: 443
    protocol: TCP
  extraMounts:
  - hostPath: ${THIS_STORAGE_PATH}/worker1
    containerPath: /mnt/xfs_backup/example
- role: worker
  labels:
    opensearchrole: worker
  extraMounts:
  - hostPath: ${THIS_STORAGE_PATH}/worker2
    containerPath: /mnt/xfs_backup/example
- role: worker
  labels:
    opensearchrole: worker
  extraMounts:
  - hostPath: ${THIS_STORAGE_PATH}/worker3
    containerPath: /mnt/xfs_backup/example
containerdConfigPatches:
- |-
  [plugins."io.containerd.grpc.v1.cri".registry]
    config_path = "/etc/containerd/certs.d"
