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
  check-prereqs                 Validate iscsid, open-iscsi, nfs, and kernel modules
  install                       Deploy distributed storage engine (Longhorn / OpenEBS)
  snapshot                      Create VolumeSnapshot for a given PVC
  list-snapshots                List cluster volume snapshots
  uninstall                     Safely remove distributed storage engine

Options:
      --engine <longhorn|openebs> Distributed storage backend (default: longhorn)
      --replicas <num>          Number of data volume replicas (default: 2)
      --pvc <name>              Target PVC name for snapshotting
      --name <snapshot-name>    VolumeSnapshot name
      --json                    Output details in structured JSON format
  -h, --help                    Show this help message

Examples:
  ./src/k3s_storage.sh status --json
  ./src/k3s_storage.sh check-prereqs
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
  local curl_ok=false

  if command -v iscsiadm >/dev/null 2>&1 || (command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet iscsid 2>/dev/null); then
    iscsi_ok=true
  fi

  if command -v mount.nfs >/dev/null 2>&1 || command -v showmount >/dev/null 2>&1 || [[ -f /sbin/mount.nfs ]]; then
    nfs_ok=true
  fi

  if command -v cryptsetup >/dev/null 2>&1 || [[ -f /proc/modules ]] && grep -q "dm_crypt" /proc/modules 2>/dev/null; then
    dm_crypt_ok=true
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
  "openebsActive": ${openebs_running}
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
