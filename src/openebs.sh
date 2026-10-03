#!/usr/bin/env bash
THIS_THING=openebs
source src/common.sh
set -euo pipefail

main() {
  echo "============================================================"
  echo "OpenEBS Storage Fabric & LocalPV Orchestrator"
  echo "============================================================"
  
  local ns="${THIS_OPENEBS_NAMESPACE:-openebs}"
  src/namespacer.sh "${ns}"

  # Ensure kernel modules
  if [[ "${THIS_OPENEBS_ENGINE_MAYASTOR:-false}" == "true" ]]; then
    src/kmod.sh nvme_tcp || true
  fi

  # Auto-detect local LVM volume groups if default placeholder was used
  if [[ "${THIS_LVM_VG:-}" == "${THIS_NAME:-}VG" || -z "${THIS_LVM_VG:-}" || "${THIS_LVM_VG:-}" == "exampleVG" ]]; then
    if command -v vgs >/dev/null 2>&1; then
      local detected_vg
      detected_vg=$(sudo -n vgs --noheadings -o vg_name 2>/dev/null | awk '{print $1}' | head -n 1 || true)
      if [[ -n "${detected_vg}" ]]; then
        echo "--> Auto-detected existing LVM Volume Group on host: '${detected_vg}'"
        THIS_LVM_VG="${detected_vg}"
        export THIS_LVM_VG
      fi
    fi
  fi
  THIS_LVM_VG="${THIS_LVM_VG:-AirVG}"

  # --------------------------------------------------------------------------
  # 1. Hostpath Engine (dynamic-localpv-provisioner)
  # --------------------------------------------------------------------------
  if [[ "${THIS_OPENEBS_ENGINE_HOSTPATH:-true}" == "true" ]]; then
    echo "--> Ensuring OpenEBS LocalPV Hostpath engine is active..."
    if kubectl get sc openebs-hostpath >/dev/null 2>&1 && kubectl get deployment -n "${ns}" openebs-localpv-provisioner >/dev/null 2>&1; then
      echo "  * openebs-hostpath StorageClass & provisioner deployment already active."
    else
      echo "  * Installing openebs-hostpath chart..."
      if [[ -d "/root/charts/openebs" ]]; then
        helm upgrade --install openebs /root/charts/openebs \
          --namespace "${ns}" \
          --create-namespace \
          --set "storageClass.basePath=${THIS_STORAGE_PATH:-/var/openebs/local}" \
          --timeout 5m0s || true
      fi
    fi
  fi

  # --------------------------------------------------------------------------
  # 2. LVM Engine (lvm-localpv)
  # --------------------------------------------------------------------------
  if [[ "${THIS_OPENEBS_ENGINE_LVM:-true}" == "true" ]]; then
    echo "--> Configuring OpenEBS LocalPV LVM engine (Target VG: '${THIS_LVM_VG}')..."
    if command -v modprobe >/dev/null 2>&1; then
      sudo -n modprobe dm_mod 2>/dev/null || true
      sudo -n modprobe dm_snapshot 2>/dev/null || true
    fi

    # Topology Node Labeling
    if [[ "${THIS_OPENEBS_LVM_LABEL_NODES:-true}" == "true" ]] && command -v kubectl >/dev/null 2>&1; then
      local topo_key="${THIS_OPENEBS_LVM_TOPOLOGY_KEY:-openebs.io/lvm}"
      local topo_val="${THIS_OPENEBS_LVM_TOPOLOGY_VALUE:-true}"
      echo "--> Applying topology selector label '${topo_key}=${topo_val}' to cluster node(s)..."
      local nodes
      nodes=$(kubectl get nodes -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)
      for n in ${nodes}; do
        kubectl label node "${n}" "${topo_key}=${topo_val}" --overwrite >/dev/null 2>&1 || true
        echo "  * Node '${n}' labeled with ${topo_key}=${topo_val}"
      done
    fi

    # Deploy lvm-localpv chart
    local lvm_chart="/root/charts/openebs-lvm"
    if [[ ! -d "${lvm_chart}" && -d "/tmp/openebs-chart/openebs/charts/lvm-localpv" ]]; then
      lvm_chart="/tmp/openebs-chart/openebs/charts/lvm-localpv"
    fi

    if [[ -d "${lvm_chart}" ]]; then
      echo "--> Deploying/Upgrading OpenEBS LVM CSI Driver from ${lvm_chart}..."
      helm upgrade --install openebs-lvm "${lvm_chart}" \
        --namespace "${ns}" \
        --create-namespace \
        --timeout 5m0s
    fi

    # Create/update StorageClass for openebs-lvmpv
    echo "--> Configuring StorageClass '${THIS_LVM_STORAGECLASS:-openebs-lvmpv}' for VG '${THIS_LVM_VG}'..."
    cat <<EOF | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${THIS_LVM_STORAGECLASS:-openebs-lvmpv}
  annotations:
    storageclass.kubernetes.io/is-default-class: "${THIS_LVM_IS_DEFAULT_SC:-false}"
    openebs.io/cas-type: local
provisioner: ${THIS_OPENEBS_LVM_PROVISIONER:-local.csi.openebs.io}
parameters:
  storage: "lvm"
  volgroup: "${THIS_LVM_VG}"
  thinProvision: "${THIS_LVM_THIN_PROVISION:-no}"
  shared: "${THIS_LVM_SHARED:-yes}"
  fsType: "${THIS_LVM_FSTYPE:-ext4}"
allowVolumeExpansion: ${THIS_LVM_ALLOW_VOLUME_EXPANSION:-true}
reclaimPolicy: ${THIS_LVM_RECLAIM_POLICY:-Delete}
volumeBindingMode: WaitForFirstConsumer
EOF
    echo "  * StorageClass '${THIS_LVM_STORAGECLASS:-openebs-lvmpv}' configured successfully."
  elif [[ "${THIS_OPENEBS_ENGINE_LVM:-true}" == "false" ]]; then
    if helm list -n "${ns}" | grep -q "openebs-lvm"; then
      echo "--> Disabling/Removing OpenEBS LVM engine as requested..."
      helm uninstall openebs-lvm -n "${ns}" || true
    fi
  fi

  # --------------------------------------------------------------------------
  # 3. ZFS Engine (zfs-localpv)
  # --------------------------------------------------------------------------
  if [[ "${THIS_OPENEBS_ENGINE_ZFS:-false}" == "true" ]]; then
    local zfs_chart="/root/charts/openebs-zfs"
    if [[ ! -d "${zfs_chart}" && -d "/tmp/openebs-chart/openebs/charts/zfs-localpv" ]]; then
      zfs_chart="/tmp/openebs-chart/openebs/charts/zfs-localpv"
    fi
    if [[ -d "${zfs_chart}" ]]; then
      echo "--> Deploying OpenEBS ZFS CSI Driver from ${zfs_chart}..."
      helm upgrade --install openebs-zfs "${zfs_chart}" \
        --namespace "${ns}" \
        --create-namespace \
        --skip-crds \
        --timeout 5m0s || true

      cat <<EOF | kubectl apply -f -
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${THIS_ZFS_STORAGECLASS:-openebs-zfspv}
  annotations:
    openebs.io/cas-type: local
provisioner: zfs.csi.openebs.io
parameters:
  poolname: "${THIS_ZFS_POOL:-zfspool}"
  fstype: "zfs"
allowVolumeExpansion: true
reclaimPolicy: Delete
volumeBindingMode: WaitForFirstConsumer
EOF
      echo "  * StorageClass '${THIS_ZFS_STORAGECLASS:-openebs-zfspv}' configured."
    fi
  elif [[ "${THIS_OPENEBS_ENGINE_ZFS:-false}" == "false" ]]; then
    if helm list -n "${ns}" | grep -q "openebs-zfs"; then
      echo "--> Disabling OpenEBS ZFS engine..."
      helm uninstall openebs-zfs -n "${ns}" || true
    fi
  fi

  # --------------------------------------------------------------------------
  # 4. NATS Message Bus
  # --------------------------------------------------------------------------
  if [[ "${THIS_OPENEBS_ENABLE_NATS:-false}" == "true" ]]; then
    local nats_chart="/root/charts/nats"
    if [[ -d "${nats_chart}" ]]; then
      echo "--> Deploying NATS Message Bus..."
      helm upgrade --install openebs-nats "${nats_chart}" \
        --namespace "${ns}" \
        --create-namespace \
        --timeout 5m0s
    fi
  elif [[ "${THIS_OPENEBS_ENABLE_NATS:-false}" == "false" ]]; then
    if helm list -n "${ns}" | grep -q "openebs-nats"; then
      echo "--> Disabling NATS Message Bus..."
      helm uninstall openebs-nats -n "${ns}" || true
    fi
  fi

  # --------------------------------------------------------------------------
  # 5. MinIO Object Store
  # --------------------------------------------------------------------------
  if [[ "${THIS_OPENEBS_ENABLE_MINIO:-false}" == "true" ]]; then
    local minio_chart="/root/charts/minio"
    if [[ -d "${minio_chart}" ]]; then
      echo "--> Deploying MinIO Object Storage..."
      helm upgrade --install openebs-minio "${minio_chart}" \
        --namespace "${ns}" \
        --create-namespace \
        --set "mode=standalone" \
        --set "replicas=1" \
        --set "persistence.storageClass=${THIS_LVM_STORAGECLASS:-openebs-lvmpv}" \
        --set "persistence.size=10Gi" \
        --timeout 5m0s
    fi
  elif [[ "${THIS_OPENEBS_ENABLE_MINIO:-false}" == "false" ]]; then
    if helm list -n "${ns}" | grep -q "openebs-minio"; then
      echo "--> Disabling MinIO Object Storage..."
      helm uninstall openebs-minio -n "${ns}" || true
    fi
  fi

  # --------------------------------------------------------------------------
  # 6. NFS RWX Storage Fabric
  # --------------------------------------------------------------------------
  if [[ "${THIS_OPENEBS_INSTALL_NFS:-false}" == "true" ]]; then
    echo "--> Deploying NFS Server fabric..."
    src/namespacer.sh nfs-server
    initializer "$this_cwd/init/openebs-nfs"
  fi

  echo "============================================================"
  echo "OpenEBS storage fabric deployed successfully."
  echo "Active StorageClasses: $(kubectl get sc -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo 'none')"
  echo "============================================================"
}

time main
