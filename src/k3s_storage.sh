#!/usr/bin/env bash
# ==============================================================================
# src/k3s_storage.sh - High-Availability Distributed Storage Orchestrator
# ==============================================================================
# Automates pre-flight validation, deployment, and management of distributed
# replicated block storage (Longhorn / OpenEBS) and VolumeSnapshotClasses.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH}"

if [[ -f "${SCRIPT_DIR}/default.env" ]]; then
  set +u
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/default.env"
  set -u
fi

LONGHORN_VERSION="${LONGHORN_VERSION:-v1.7.1}"
DEFAULT_REPLICAS="${STORAGE_REPLICAS:-2}"
JSON_OUTPUT=false
ENGINE="${STORAGE_ENGINE:-longhorn}"
PVC_NAME=""
SNAPSHOT_NAME=""
LABEL_NODES="${THIS_OPENEBS_LVM_LABEL_NODES:-true}"
LVM_VG="${THIS_LVM_VG:-${THIS_NAME:-example}VG}"
LVM_VG_PATTERN="${THIS_LVM_VG_PATTERN:-.*}"
TOPOLOGY_KEY="${THIS_OPENEBS_LVM_TOPOLOGY_KEY:-openebs.io/lvm}"
TOPOLOGY_VALUE="${THIS_OPENEBS_LVM_TOPOLOGY_VALUE:-true}"
THIN_PROVISION="${THIS_LVM_THIN_PROVISION:-no}"
SHARED_VOL="${THIS_LVM_SHARED:-yes}"
ACTION="${1:-status}"
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --engine)
      ENGINE="$2"
      shift 2
      ;;
    --replicas)
      DEFAULT_REPLICAS="$2"
      shift 2
      ;;
    --vg)
      LVM_VG="$2"
      export THIS_LVM_VG="$2"
      shift 2
      ;;
    --vg-pattern)
      LVM_VG_PATTERN="$2"
      export THIS_LVM_VG_PATTERN="$2"
      shift 2
      ;;
    --selector-key)
      TOPOLOGY_KEY="$2"
      export THIS_OPENEBS_LVM_TOPOLOGY_KEY="$2"
      shift 2
      ;;
    --selector-value)
      TOPOLOGY_VALUE="$2"
      export THIS_OPENEBS_LVM_TOPOLOGY_VALUE="$2"
      shift 2
      ;;
    --label-nodes)
      LABEL_NODES=true
      export THIS_OPENEBS_LVM_LABEL_NODES=true
      shift
      ;;
    --thin-provision)
      THIN_PROVISION="yes"
      export THIS_LVM_THIN_PROVISION="yes"
      shift
      ;;
    --shared)
      SHARED_VOL="yes"
      export THIS_LVM_SHARED="yes"
      shift
      ;;
    --pvc)
      PVC_NAME="$2"
      shift 2
      ;;
    --name)
      SNAPSHOT_NAME="$2"
      shift 2
      ;;
    -h|--help)
      cat << 'EOF'
Usage: ./src/k3s_storage.sh <action> [options]

High-availability distributed storage and snapshot engine for K3s.

Actions:
  status                        Inspect active storage classes, CSI drivers, and PVC usage
  check-prereqs                 Validate iscsid, open-iscsi, nfs, lvm, and kernel modules
  install                       Deploy distributed storage engine (Longhorn / OpenEBS)
  snapshot                      Create VolumeSnapshot for a given PVC
  list-snapshots                List cluster volume snapshots
  uninstall                     Safely remove distributed storage engine

Options:
      --engine <longhorn|openebs> Distributed storage backend (default: longhorn)
      --replicas <num>          Number of data volume replicas (default: 2)
      --vg <name>               LVM Volume Group name (OpenEBS LVM)
      --vg-pattern <regex>      LVM Volume Group regex pattern
      --selector-key <key>      Topology label key for node selector (default: openebs.io/lvm)
      --selector-value <val>    Topology label value for node selector (default: true)
      --label-nodes             Apply topology selector label to cluster nodes
      --thin-provision          Enable LVM thin provisioning (thinProvision=yes)
      --shared                  Enable multi-pod shared access on node (shared=yes)
      --pvc <name>              Target PVC name for snapshotting
      --name <snapshot-name>    VolumeSnapshot name
      --json                    Output details in structured JSON format
  -h, --help                    Show this help message

Examples:
  ./src/k3s_storage.sh status --json
  ./src/k3s_storage.sh check-prereqs
  ./src/k3s_storage.sh install --engine openebs --vg AirVG --label-nodes
  ./src/k3s_storage.sh install --engine longhorn --replicas 2
  ./src/k3s_storage.sh snapshot --pvc db-data --name db-snap-01
EOF
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

check_root() {
  if [[ $(id -u) -ne 0 ]]; then
    SUDO="sudo"
  else
    SUDO=""
  fi
}

cmd_check_prereqs() {
  local iscsi_ok=false
  local nfs_ok=false
  local dm_crypt_ok=false
  local lvm_ok=false
  local curl_ok=false
  local vgs_found=""

  if command -v iscsiadm >/dev/null 2>&1 || (command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet iscsid 2>/dev/null); then
    iscsi_ok=true
  fi

  if command -v mount.nfs >/dev/null 2>&1 || command -v showmount >/dev/null 2>&1 || [[ -f /sbin/mount.nfs ]]; then
    nfs_ok=true
  fi

  if command -v cryptsetup >/dev/null 2>&1 || [[ -f /proc/modules ]] && grep -q "dm_crypt" /proc/modules 2>/dev/null; then
    dm_crypt_ok=true
  fi

  if command -v vgs >/dev/null 2>&1 || command -v lvm >/dev/null 2>&1; then
    lvm_ok=true
    vgs_found=$(sudo -n vgs --noheadings -o vg_name 2>/dev/null | tr '\n' ' ' | xargs || true)
  fi

  if command -v curl >/dev/null 2>&1; then
    curl_ok=true
  fi

  local all_passed=true
  if [[ "${iscsi_ok}" != "true" || "${nfs_ok}" != "true" ]]; then
    all_passed=false
  fi

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "allPrereqsMet": ${all_passed},
  "iscsiInstalled": ${iscsi_ok},
  "nfsToolsInstalled": ${nfs_ok},
  "dmCryptAvailable": ${dm_crypt_ok},
  "lvmAvailable": ${lvm_ok},
  "detectedVolumeGroups": "${vgs_found}",
  "curlInstalled": ${curl_ok}
}
EOF
    return 0
  fi

  echo "============================================================"
  echo "Distributed Storage Pre-requisite Audit"
  echo "============================================================"
  echo "open-iscsi / iscsid : $( [[ "${iscsi_ok}" == "true" ]] && echo "OK (Active)" || echo "MISSING (apt install open-iscsi)" )"
  echo "NFS client tools    : $( [[ "${nfs_ok}" == "true" ]] && echo "OK (Active)" || echo "MISSING (apt install nfs-common)" )"
  echo "Device Mapper Crypt : $( [[ "${dm_crypt_ok}" == "true" ]] && echo "OK" || echo "OPTIONAL" )"
  echo "LVM2 Tools & VGs    : $( [[ "${lvm_ok}" == "true" ]] && echo "OK (VGs: ${vgs_found:-none detected})" || echo "MISSING (apt install lvm2)" )"
  echo "Curl Client         : $( [[ "${curl_ok}" == "true" ]] && echo "OK" || echo "MISSING" )"
  echo "------------------------------------------------------------"
  if [[ "${all_passed}" == "true" ]]; then
    echo "Status: ALL PREREQUISITES MET for distributed storage."
  else
    echo "Warning: Missing packages may prevent block/RWX mounting."
  fi
  echo "============================================================"
}

cmd_status() {
  local default_sc="none"
  local sc_list=()
  local csi_drivers=()
  local total_pv=0
  local total_pvc=0
  local longhorn_running=false
  local openebs_running=false
  local lvm_nodes_count=0
  local labeled_nodes=()

  if command -v kubectl >/dev/null 2>&1; then
    local sc_output
    sc_output=$(kubectl get storageclass --no-headers 2>/dev/null || true)
    while IFS= read -r line; do
      if [[ -n "${line}" ]]; then
        local name
        name=$(echo "${line}" | awk '{print $1}')
        if echo "${line}" | grep -q "(default)"; then
          default_sc="${name}"
        fi
        sc_list+=("${name}")
      fi
    done <<< "${sc_output}"

    local csi_output
    csi_output=$(kubectl get csidrivers --no-headers 2>/dev/null || true)
    while IFS= read -r line; do
      if [[ -n "${line}" ]]; then
        csi_drivers+=("$(echo "${line}" | awk '{print $1}')")
      fi
    done <<< "${csi_output}"

    total_pv=$(kubectl get pv --no-headers 2>/dev/null | wc -l || echo 0)
    total_pvc=$(kubectl get pvc -A --no-headers 2>/dev/null | wc -l || echo 0)

    if kubectl get pods -n longhorn-system --no-headers 2>/dev/null | grep -q "Running"; then
      longhorn_running=true
    fi
    if kubectl get pods -n openebs --no-headers 2>/dev/null | grep -q "Running"; then
      openebs_running=true
    fi
    lvm_nodes_count=$(kubectl get lvmnodes -A --no-headers 2>/dev/null | wc -l | tr -d '[:space:]' || true)
    lvm_nodes_count="${lvm_nodes_count:-0}"
    
    local topo_key="${THIS_OPENEBS_LVM_TOPOLOGY_KEY:-openebs.io/lvm}"
    local topo_nodes
    topo_nodes=$(kubectl get nodes -l "${topo_key}" --no-headers 2>/dev/null | awk '{print $1}' || true)
    for n in ${topo_nodes}; do
      if [[ -n "${n}" ]]; then
        labeled_nodes+=("${n}")
      fi
    done
  fi

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    local sc_json=""
    for sc in "${sc_list[@]}"; do
      if [[ -z "${sc_json}" ]]; then
        sc_json="\"${sc}\""
      else
        sc_json="${sc_json}, \"${sc}\""
      fi
    done

    local csi_json=""
    for csi in "${csi_drivers[@]}"; do
      if [[ -z "${csi_json}" ]]; then
        csi_json="\"${csi}\""
      else
        csi_json="${csi_json}, \"${csi}\""
      fi
    done

    cat << EOF
{
  "defaultStorageClass": "${default_sc}",
  "storageClasses": [${sc_json}],
  "csiDrivers": [${csi_json}],
  "totalPVs": ${total_pv},
  "totalPVCs": ${total_pvc},
  "longhornActive": ${longhorn_running},
  "openebsActive": ${openebs_running},
  "lvmNodesRegistered": ${lvm_nodes_count},
  "topologyKey": "${THIS_OPENEBS_LVM_TOPOLOGY_KEY:-openebs.io/lvm}",
  "topologyNodes": [$(printf '"%s",' "${labeled_nodes[@]}" | sed 's/,$//')]
}
EOF
    return 0
  fi

  echo "============================================================"
  echo "K3s Cluster Storage Infrastructure Status"
  echo "============================================================"
  echo "Default StorageClass  : ${default_sc}"
  echo "Installed Classes     : ${sc_list[*]:-none}"
  echo "Active CSI Drivers    : ${csi_drivers[*]:-none}"
  echo "Total PersistentVolumes: ${total_pv}"
  echo "Total PVCs Bound      : ${total_pvc}"
  echo "Longhorn Engine       : $( [[ "${longhorn_running}" == "true" ]] && echo "RUNNING" || echo "NOT DEPLOYED" )"
  echo "OpenEBS Engine        : $( [[ "${openebs_running}" == "true" ]] && echo "RUNNING" || echo "NOT DEPLOYED" )"
  echo "LVM Nodes Registered : ${lvm_nodes_count}"
  echo "Topology Node Selector: ${THIS_OPENEBS_LVM_TOPOLOGY_KEY:-openebs.io/lvm}=${THIS_OPENEBS_LVM_TOPOLOGY_VALUE:-true}"
  echo "Matching Nodes        : ${labeled_nodes[*]:-none}"
  echo "============================================================"
}

cmd_install_longhorn() {
  echo "--> Preparing Longhorn distributed block storage deployment..."
  cmd_check_prereqs

  if ! command -v helm >/dev/null 2>&1; then
    echo "Helm is required to install Longhorn. Installing Helm chart manifests via kubectl..."
    kubectl apply -f "https://raw.githubusercontent.com/longhorn/longhorn/${LONGHORN_VERSION}/deploy/longhorn.yaml"
  else
    echo "--> Adding Longhorn repository to Helm..."
    helm repo add longhorn https://charts.longhorn.io >/dev/null 2>&1 || true
    helm repo update longhorn >/dev/null 2>&1 || true

    echo "--> Installing Longhorn chart into longhorn-system..."
    helm upgrade --install longhorn longhorn/longhorn \
      --namespace longhorn-system \
      --create-namespace \
      --set defaultSettings.defaultReplicaCount="${DEFAULT_REPLICAS}" \
      --set persistence.defaultClass=true \
      --set defaultSettings.backupTarget=""
  fi

  echo "--> Deploying VolumeSnapshotClass..."
  cat << 'EOF' | kubectl apply -f -
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshotClass
metadata:
  name: longhorn-snapshot-vsc
  annotations:
    snapshot.storage.kubernetes.io/is-default-class: "true"
driver: driver.longhorn.io
deletionPolicy: Delete
EOF

  echo "Longhorn distributed storage and VolumeSnapshotClass deployed successfully."
}

cmd_snapshot() {
  if [[ -z "${PVC_NAME}" ]]; then
    echo "Error: --pvc <pvc-name> is required to create a snapshot."
    exit 1
  fi

  local snap_name="${SNAPSHOT_NAME:-${PVC_NAME}-snap-$(date +%s)}"
  echo "--> Creating VolumeSnapshot '${snap_name}' for PVC '${PVC_NAME}'..."

  cat << EOF | kubectl apply -f -
apiVersion: snapshot.storage.k8s.io/v1
kind: VolumeSnapshot
metadata:
  name: ${snap_name}
spec:
  volumeSnapshotClassName: longhorn-snapshot-vsc
  source:
    persistentVolumeClaimName: ${PVC_NAME}
EOF

  echo "VolumeSnapshot '${snap_name}' initiated."
}

cmd_list_snapshots() {
  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    kubectl get volumesnapshot -A -o json 2>/dev/null || echo '{"items":[]}'
    return 0
  fi
  kubectl get volumesnapshot -A 2>/dev/null || echo "No VolumeSnapshots found."
}

case "${ACTION}" in
  status)
    cmd_status
    ;;
  check-prereqs)
    cmd_check_prereqs
    ;;
  install)
    if [[ "${ENGINE}" == "longhorn" ]]; then
      cmd_install_longhorn
    else
      echo "--> Deploying OpenEBS engine..."
      "${SCRIPT_DIR}/openebs.sh"
    fi
    ;;
  snapshot)
    cmd_snapshot
    ;;
  list-snapshots)
    cmd_list_snapshots
    ;;
  *)
    cmd_status
    ;;
esac
