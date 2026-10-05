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
  # 1. Hostpath Engine & Unified OpenEBS Chart
  # --------------------------------------------------------------------------
  local unified_chart="/root/charts/openebs"
  if [[ -d "${unified_chart}" ]]; then
    echo "--> Configuring OpenEBS Unified Storage Fabric (Target VG: '${THIS_LVM_VG}')..."

    # Kernel modules for LVM
    if [[ "${THIS_OPENEBS_ENGINE_LVM:-true}" == "true" ]] && command -v modprobe >/dev/null 2>&1; then
      sudo -n modprobe dm_mod 2>/dev/null || true
      sudo -n modprobe dm_snapshot 2>/dev/null || true
    fi

    # Topology Node Labeling
    if [[ "${THIS_OPENEBS_ENGINE_LVM:-true}" == "true" && "${THIS_OPENEBS_LVM_LABEL_NODES:-true}" == "true" ]] && command -v kubectl >/dev/null 2>&1; then
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

    # Recreate StorageClasses if immutable parameters (like basePath or volgroup) changed
    if kubectl get sc openebs-hostpath >/dev/null 2>&1; then
      local cur_hp_path
      cur_hp_path=$(kubectl get sc openebs-hostpath -o jsonpath='{.parameters.basePath}' 2>/dev/null || true)
      if [[ -n "${cur_hp_path}" && "${cur_hp_path}" != "${THIS_STORAGE_PATH:-/var/openebs/local}" ]]; then
        echo "  * Recreating openebs-hostpath StorageClass to update basePath from '${cur_hp_path}' to '${THIS_STORAGE_PATH:-/var/openebs/local}'..."
        kubectl delete sc openebs-hostpath --ignore-not-found >/dev/null 2>&1 || true
      fi
    fi
    if kubectl get sc "${THIS_LVM_STORAGECLASS:-openebs-lvmpv}" >/dev/null 2>&1; then
      local cur_vg
      cur_vg=$(kubectl get sc "${THIS_LVM_STORAGECLASS:-openebs-lvmpv}" -o jsonpath='{.parameters.volgroup}' 2>/dev/null || true)
      if [[ -n "${cur_vg}" && "${cur_vg}" != "${THIS_LVM_VG:-AirVG}" ]]; then
        echo "  * Recreating ${THIS_LVM_STORAGECLASS:-openebs-lvmpv} StorageClass to update volgroup from '${cur_vg}' to '${THIS_LVM_VG:-AirVG}'..."
        kubectl delete sc "${THIS_LVM_STORAGECLASS:-openebs-lvmpv}" --ignore-not-found >/dev/null 2>&1 || true
      fi
    fi

    # Adopt pre-existing StorageClasses (e.g. applied via init/openebs) so Helm can take ownership
    for sc in $(kubectl get sc -o name 2>/dev/null | grep -i openebs || true); do
      kubectl label "${sc}" app.kubernetes.io/managed-by=Helm --overwrite >/dev/null 2>&1 || true
      kubectl annotate "${sc}" meta.helm.sh/release-name=openebs meta.helm.sh/release-namespace="${ns}" --overwrite >/dev/null 2>&1 || true
    done

    helm upgrade --install openebs "${unified_chart}" \
      --namespace "${ns}" \
      --create-namespace \
      --set "basePath=${THIS_STORAGE_PATH:-/var/openebs/local}" \
      --set "hostpath.enabled=${THIS_OPENEBS_ENGINE_HOSTPATH:-true}" \
      --set "hostpath.storageClass.create=${THIS_OPENEBS_ENGINE_HOSTPATH:-true}" \
      --set "hostpath.storageClass.basePath=${THIS_STORAGE_PATH:-/var/openebs/local}" \
      --set "lvm.enabled=${THIS_OPENEBS_ENGINE_LVM:-true}" \
      --set "lvm.volgroup=${THIS_LVM_VG:-AirVG}" \
      --set "lvm.fsType=${THIS_LVM_FSTYPE:-ext4}" \
      --set "lvm.thinProvision=${THIS_LVM_THIN_PROVISION:-no}" \
      --set "lvm.shared=${THIS_LVM_SHARED:-yes}" \
      --set "lvm.storageClass.create=${THIS_OPENEBS_ENGINE_LVM:-true}" \
      --set "lvm.storageClass.name=${THIS_LVM_STORAGECLASS:-openebs-lvmpv}" \
      --set "lvm.storageClass.isDefaultClass=${THIS_LVM_IS_DEFAULT_SC:-false}" \
      --timeout 5m0s || true
  elif [[ "${THIS_OPENEBS_ENGINE_HOSTPATH:-true}" == "true" ]]; then
    echo "--> Ensuring OpenEBS LocalPV Hostpath engine is active..."
    if kubectl get sc openebs-hostpath >/dev/null 2>&1 && kubectl get deployment -n "${ns}" openebs-localpv-provisioner >/dev/null 2>&1; then
      echo "  * openebs-hostpath StorageClass & provisioner deployment already active."
    else
      echo "  * Installing openebs-hostpath chart..."
      helm repo add openebs https://openebs.github.io/openebs >/dev/null 2>&1 || true
      helm repo update openebs >/dev/null 2>&1 || true
      helm upgrade --install openebs openebs/openebs \
        --namespace "${ns}" \
        --create-namespace \
        --set "storageClass.basePath=${THIS_STORAGE_PATH:-/var/openebs/local}" \
        --timeout 5m0s || true
    fi
  fi

  if [[ "${THIS_OPENEBS_ENGINE_HOSTPATH:-true}" == "false" ]]; then
    kubectl delete deployment -n "${ns}" openebs-localpv-provisioner --ignore-not-found
    kubectl delete sc openebs-hostpath --ignore-not-found
  fi

  # --------------------------------------------------------------------------
  # 2. LVM Engine (standalone fallback or post-check)
  # --------------------------------------------------------------------------
  if [[ "${THIS_OPENEBS_ENGINE_LVM:-true}" == "true" ]]; then
    echo "--> Configuring OpenEBS LocalPV LVM engine (Target VG: '${THIS_LVM_VG}')..."
    if command -v modprobe >/dev/null 2>&1; then
      sudo -n modprobe dm_mod 2>/dev/null || true
      sudo -n modprobe dm_snapshot 2>/dev/null || true
    fi

    # Check if already installed by unified 'openebs' release
    local lvm_installed=false
    if kubectl get deployment -n "${ns}" openebs-lvm-localpv-controller >/dev/null 2>&1; then
      lvm_installed=true
    fi

    if [[ "${lvm_installed}" == "false" ]]; then
      # Topology Node Labeling
      if [[ "${THIS_OPENEBS_LVM_LABEL_NODES:-true}" == "true" ]] && command -v kubectl >/dev/null 2>&1; then
        local topo_key="${THIS_OPENEBS_LVM_TOPOLOGY_KEY:-openebs.io/lvm}"
        local topo_val="${THIS_OPENEBS_LVM_TOPOLOGY_VALUE:-true}"
        local nodes
        nodes=$(kubectl get nodes -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true)
        for n in ${nodes}; do
          kubectl label node "${n}" "${topo_key}=${topo_val}" --overwrite >/dev/null 2>&1 || true
        done
      fi

      local lvm_chart="/root/charts/openebs/charts/lvm-localpv"
      if [[ ! -d "${lvm_chart}" && -d "/root/charts/openebs-lvm" ]]; then
        lvm_chart="/root/charts/openebs-lvm"
      fi
      if [[ ! -d "${lvm_chart}" && -d "/tmp/openebs-chart/openebs/charts/lvm-localpv" ]]; then
        lvm_chart="/tmp/openebs-chart/openebs/charts/lvm-localpv"
      fi

      if [[ ! -d "${lvm_chart}" ]]; then
        echo "--> No local lvm-localpv chart found; using upstream chart openebs-lvm/lvm-localpv..."
        helm repo add openebs-lvm https://openebs.github.io/lvm-localpv >/dev/null 2>&1 || true
        helm repo update openebs-lvm >/dev/null 2>&1 || true
        lvm_chart="openebs-lvm/lvm-localpv"
      fi

      if [[ -d "${lvm_chart}" || "${lvm_chart}" == "openebs-lvm/lvm-localpv" ]]; then
        echo "--> Deploying/Upgrading OpenEBS LVM CSI Driver from ${lvm_chart}..."
        helm upgrade --install openebs-lvm "${lvm_chart}" \
          --namespace "${ns}" \
          --create-namespace \
          --timeout 5m0s
      fi
    else
      echo "  * OpenEBS LVM CSI Driver is active and managed by release 'openebs'."
    fi

    # Ensure StorageClass for openebs-lvmpv exists with correct VG parameters
    if ! kubectl get sc "${THIS_LVM_STORAGECLASS:-openebs-lvmpv}" >/dev/null 2>&1; then
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
    fi

    if [[ "${THIS_LVM_IS_DEFAULT_SC:-false}" == "true" ]]; then
      kubectl annotate sc local-path storageclass.kubernetes.io/is-default-class="false" --overwrite >/dev/null 2>&1 || true
      kubectl annotate sc "${THIS_LVM_STORAGECLASS:-openebs-lvmpv}" storageclass.kubernetes.io/is-default-class="true" --overwrite >/dev/null 2>&1 || true
    else
      kubectl annotate sc "${THIS_LVM_STORAGECLASS:-openebs-lvmpv}" storageclass.kubernetes.io/is-default-class="false" --overwrite >/dev/null 2>&1 || true
    fi
  elif [[ "${THIS_OPENEBS_ENGINE_LVM:-true}" == "false" ]]; then
    if helm list -n "${ns}" | grep -q "openebs-lvm"; then
      echo "--> Disabling/Removing OpenEBS LVM engine as requested..."
      helm uninstall openebs-lvm -n "${ns}" || true
    fi
    kubectl delete daemonset -n "${ns}" openebs-lvm-localpv-node --ignore-not-found
    kubectl delete deployment -n "${ns}" openebs-lvm-localpv-controller --ignore-not-found
    kubectl delete sc "${THIS_LVM_STORAGECLASS:-openebs-lvmpv}" --ignore-not-found
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
    kubectl delete daemonset -n "${ns}" openebs-zfs-localpv-node --ignore-not-found
    kubectl delete deployment -n "${ns}" openebs-zfs-localpv-controller --ignore-not-found
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
    kubectl delete statefulset -n "${ns}" openebs-nats --ignore-not-found
    kubectl delete svc -n "${ns}" openebs-nats openebs-nats-headless --ignore-not-found
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
    kubectl delete statefulset -n "${ns}" openebs-minio --ignore-not-found
    kubectl delete svc -n "${ns}" openebs-minio openebs-minio-svc openebs-minio-console --ignore-not-found
  fi

  # --------------------------------------------------------------------------
  # 6. Loki Log Aggregator
  # --------------------------------------------------------------------------
  if [[ "${THIS_OPENEBS_ENABLE_LOKI:-false}" == "true" ]]; then
    local loki_chart="/root/charts/loki"
    if [[ -d "${loki_chart}" ]]; then
      echo "--> Deploying Loki Log Aggregator..."
      helm upgrade --install openebs-loki "${loki_chart}" \
        --namespace "${ns}" \
        --create-namespace \
        --timeout 5m0s
    fi
  elif [[ "${THIS_OPENEBS_ENABLE_LOKI:-false}" == "false" ]]; then
    if helm list -n "${ns}" | grep -q "openebs-loki"; then
      echo "--> Disabling/Removing Loki Log Aggregator..."
      helm uninstall openebs-loki -n "${ns}" || true
    fi
    kubectl delete statefulset -n "${ns}" openebs-loki --ignore-not-found
    kubectl delete svc -n "${ns}" openebs-loki loki-headless loki-memberlist --ignore-not-found
  fi

  # --------------------------------------------------------------------------
  # 7. Alloy Telemetry Agent
  # --------------------------------------------------------------------------
  if [[ "${THIS_OPENEBS_ENABLE_ALLOY:-false}" == "true" ]]; then
    local alloy_chart="/root/charts/alloy"
    if [[ -d "${alloy_chart}" ]]; then
      echo "--> Deploying Alloy Telemetry Agent..."
      helm upgrade --install openebs-alloy "${alloy_chart}" \
        --namespace "${ns}" \
        --create-namespace \
        --timeout 5m0s
    fi
  elif [[ "${THIS_OPENEBS_ENABLE_ALLOY:-false}" == "false" ]]; then
    if helm list -n "${ns}" | grep -q "openebs-alloy"; then
      echo "--> Disabling/Removing Alloy Telemetry Agent..."
      helm uninstall openebs-alloy -n "${ns}" || true
    fi
    kubectl delete daemonset -n "${ns}" openebs-alloy --ignore-not-found
    kubectl delete svc -n "${ns}" openebs-alloy --ignore-not-found
  fi

  # --------------------------------------------------------------------------
  # 8. Legacy / Bundled Mayastor & Etcd Cleanup
  # --------------------------------------------------------------------------
  if [[ "${THIS_OPENEBS_ENGINE_MAYASTOR:-false}" == "false" ]]; then
    kubectl delete statefulset -n "${ns}" openebs-etcd --ignore-not-found
    kubectl delete svc -n "${ns}" openebs-etcd openebs-etcd-headless --ignore-not-found
    kubectl delete daemonset -n "${ns}" openebs-agent-ha-node openebs-csi-node openebs-io-engine --ignore-not-found
    kubectl delete deployment -n "${ns}" openebs-agent-core openebs-api-rest openebs-csi-controller openebs-eventing-aggregator openebs-obs-callhome openebs-operator-diskpool --ignore-not-found
  fi

  # --------------------------------------------------------------------------
  # 9. NFS RWX Storage Fabric
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
