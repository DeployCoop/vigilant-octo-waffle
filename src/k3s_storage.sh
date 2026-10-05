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
  set +eu +o pipefail
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/default.env"
  set -euo pipefail
fi

if [[ -f "${SCRIPT_DIR}/../.env" ]]; then
  set +eu +o pipefail
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/../.env"
  set -euo pipefail
elif [[ -f "${SCRIPT_DIR}/.env" ]]; then
  set +eu +o pipefail
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/.env"
  set -euo pipefail
fi

persist_env_var() {
  local key="$1"
  local val="$2"
  local env_file="${SCRIPT_DIR}/../.env"
  if [[ ! -f "${env_file}" && -f "${SCRIPT_DIR}/.env" ]]; then
    env_file="${SCRIPT_DIR}/.env"
  fi
  if [[ -f "${env_file}" ]]; then
    if grep -q "^${key}=" "${env_file}"; then
      sed -i "s|^${key}=.*|${key}=\"${val}\"|" "${env_file}"
    else
      echo "${key}=\"${val}\"" >> "${env_file}"
    fi
  fi
}

persist_storage_env() {
  persist_env_var "THIS_LVM_VG" "${LVM_VG}"
  if [[ -n "${THIS_LVM_FSTYPE:-}" ]]; then persist_env_var "THIS_LVM_FSTYPE" "${THIS_LVM_FSTYPE}"; fi
  persist_env_var "THIS_LVM_THIN_PROVISION" "${THIN_PROVISION}"
  persist_env_var "THIS_LVM_SHARED" "${SHARED_VOL}"
  if [[ -n "${THIS_OPENEBS_ENGINE_LVM:-}" ]]; then persist_env_var "THIS_OPENEBS_ENGINE_LVM" "${THIS_OPENEBS_ENGINE_LVM}"; fi
  if [[ -n "${THIS_OPENEBS_ENGINE_HOSTPATH:-}" ]]; then persist_env_var "THIS_OPENEBS_ENGINE_HOSTPATH" "${THIS_OPENEBS_ENGINE_HOSTPATH}"; fi
  if [[ -n "${THIS_OPENEBS_ENGINE_ZFS:-}" ]]; then persist_env_var "THIS_OPENEBS_ENGINE_ZFS" "${THIS_OPENEBS_ENGINE_ZFS}"; fi
  if [[ -n "${THIS_OPENEBS_ENGINE_RAWFILE:-}" ]]; then persist_env_var "THIS_OPENEBS_ENGINE_RAWFILE" "${THIS_OPENEBS_ENGINE_RAWFILE}"; fi
  if [[ -n "${THIS_OPENEBS_ENGINE_MAYASTOR:-}" ]]; then persist_env_var "THIS_OPENEBS_ENGINE_MAYASTOR" "${THIS_OPENEBS_ENGINE_MAYASTOR}"; fi
  if [[ -n "${THIS_OPENEBS_ENABLE_NATS:-}" ]]; then persist_env_var "THIS_OPENEBS_ENABLE_NATS" "${THIS_OPENEBS_ENABLE_NATS}"; fi
  if [[ -n "${THIS_OPENEBS_ENABLE_MINIO:-}" ]]; then persist_env_var "THIS_OPENEBS_ENABLE_MINIO" "${THIS_OPENEBS_ENABLE_MINIO}"; fi
  if [[ -n "${THIS_OPENEBS_ENABLE_LOKI:-}" ]]; then persist_env_var "THIS_OPENEBS_ENABLE_LOKI" "${THIS_OPENEBS_ENABLE_LOKI}"; fi
  if [[ -n "${THIS_OPENEBS_ENABLE_ALLOY:-}" ]]; then persist_env_var "THIS_OPENEBS_ENABLE_ALLOY" "${THIS_OPENEBS_ENABLE_ALLOY}"; fi
  if [[ -n "${THIS_OPENEBS_INSTALL_NFS:-}" ]]; then persist_env_var "THIS_OPENEBS_INSTALL_NFS" "${THIS_OPENEBS_INSTALL_NFS}"; fi
  if [[ -n "${THIS_LVM_IS_DEFAULT_SC:-}" ]]; then persist_env_var "THIS_LVM_IS_DEFAULT_SC" "${THIS_LVM_IS_DEFAULT_SC}"; fi
}

LONGHORN_VERSION="${LONGHORN_VERSION:-v1.7.1}"
DEFAULT_REPLICAS="${STORAGE_REPLICAS:-2}"
JSON_OUTPUT=false
ENGINE="${STORAGE_ENGINE:-longhorn}"
PVC_NAME=""
SNAPSHOT_NAME=""
LABEL_NODES="${THIS_OPENEBS_LVM_LABEL_NODES:-true}"
LVM_VG="${THIS_LVM_VG:-${THIS_NAME:-example}VG}"
if [[ "${LVM_VG}" == "exampleVG" || -z "${LVM_VG}" ]]; then
  if command -v vgs >/dev/null 2>&1; then
    detected_vg=$(sudo -n vgs --noheadings -o vg_name 2>/dev/null | awk '{print $1}' | head -n 1 || true)
    if [[ -n "${detected_vg}" ]]; then
      LVM_VG="${detected_vg}"
      export THIS_LVM_VG="${detected_vg}"
    fi
  fi
fi
LVM_VG_PATTERN="${THIS_LVM_VG_PATTERN:-.*}"
TOPOLOGY_KEY="${THIS_OPENEBS_LVM_TOPOLOGY_KEY:-openebs.io/lvm}"
TOPOLOGY_VALUE="${THIS_OPENEBS_LVM_TOPOLOGY_VALUE:-true}"
THIN_PROVISION="${THIS_LVM_THIN_PROVISION:-no}"
SHARED_VOL="${THIS_LVM_SHARED:-yes}"
ACTION="${1:-status}"
shift || true

STORAGE_CLASS=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sc|--storageclass|--storage-class)
      STORAGE_CLASS="$2"
      shift 2
      ;;
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
    --fstype)
      export THIS_LVM_FSTYPE="$2"
      shift 2
      ;;
    --enable-lvm)
      export THIS_OPENEBS_ENGINE_LVM="$2"
      shift 2
      ;;
    --enable-hostpath)
      export THIS_OPENEBS_ENGINE_HOSTPATH="$2"
      shift 2
      ;;
    --enable-zfs)
      export THIS_OPENEBS_ENGINE_ZFS="$2"
      shift 2
      ;;
    --enable-rawfile)
      export THIS_OPENEBS_ENGINE_RAWFILE="$2"
      shift 2
      ;;
    --enable-mayastor)
      export THIS_OPENEBS_ENGINE_MAYASTOR="$2"
      shift 2
      ;;
    --enable-nats)
      export THIS_OPENEBS_ENABLE_NATS="$2"
      shift 2
      ;;
    --enable-minio)
      export THIS_OPENEBS_ENABLE_MINIO="$2"
      shift 2
      ;;
    --enable-loki)
      export THIS_OPENEBS_ENABLE_LOKI="$2"
      shift 2
      ;;
    --enable-alloy)
      export THIS_OPENEBS_ENABLE_ALLOY="$2"
      shift 2
      ;;
    --enable-nfs)
      export THIS_OPENEBS_INSTALL_NFS="$2"
      shift 2
      ;;
    --set-default-sc)
      export THIS_LVM_IS_DEFAULT_SC="true"
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
    local hostpath_active=false
    local lvm_active=false
    local zfs_active=false
    local rawfile_active=false
    local mayastor_active=false
    local minio_active=false
    local nats_active=false
    local loki_active=false
    local alloy_active=false
    local nfs_active=false

    local hostpath_state="stopped"
    local lvm_state="stopped"
    local zfs_state="stopped"
    local rawfile_state="stopped"
    local mayastor_state="stopped"
    local minio_state="stopped"
    local nats_state="stopped"
    local loki_state="stopped"
    local alloy_state="stopped"
    local nfs_state="stopped"

    if kubectl get deployment -n openebs openebs-localpv-provisioner --no-headers 2>/dev/null | grep -q "1/1"; then
      hostpath_active=true
      hostpath_state="running"
    elif kubectl get deployment -n openebs openebs-localpv-provisioner >/dev/null 2>&1; then
      hostpath_state="error"
    fi

    if kubectl get pods -n openebs -l app=openebs-lvm-node --no-headers 2>/dev/null | grep -q "Running" || kubectl get csidriver local.csi.openebs.io >/dev/null 2>&1; then
      lvm_active=true
      lvm_state="running"
    elif kubectl get pods -n openebs -l app=openebs-lvm-node --no-headers 2>/dev/null | grep -q .; then
      lvm_state="error"
    fi

    if kubectl get pods -n openebs -l app=openebs-zfs-node --no-headers 2>/dev/null | grep -q "Running" || kubectl get csidriver zfs.csi.openebs.io >/dev/null 2>&1; then
      zfs_active=true
      zfs_state="running"
    elif kubectl get pods -n openebs -l app=openebs-zfs-node --no-headers 2>/dev/null | grep -q .; then
      zfs_state="error"
    fi

    if kubectl get csidriver rawfile.csi.openebs.io >/dev/null 2>&1; then
      rawfile_active=true
      rawfile_state="running"
    fi

    if kubectl get csidriver io.openebs.csi-mayastor >/dev/null 2>&1; then
      mayastor_active=true
      mayastor_state="running"
    elif kubectl get pods -n openebs -l openebs.io/engine=mayastor --no-headers 2>/dev/null | grep -q .; then
      mayastor_state="error"
    fi

    if kubectl get pods -n openebs -l app.kubernetes.io/name=minio --no-headers 2>/dev/null | grep -q "Running" || kubectl get pods -n minio --no-headers 2>/dev/null | grep -q "Running"; then
      minio_active=true
      minio_state="running"
    elif kubectl get pods -n openebs -l app.kubernetes.io/name=minio --no-headers 2>/dev/null | grep -q . || kubectl get statefulset -n openebs openebs-minio >/dev/null 2>&1 || kubectl get statefulset -n minio minio >/dev/null 2>&1; then
      minio_state="error"
    fi

    if kubectl get pods -n openebs -l app.kubernetes.io/name=nats --no-headers 2>/dev/null | grep -q "Running"; then
      nats_active=true
      nats_state="running"
    elif kubectl get pods -n openebs -l app.kubernetes.io/name=nats --no-headers 2>/dev/null | grep -q . || kubectl get statefulset -n openebs openebs-nats >/dev/null 2>&1; then
      nats_state="error"
    fi

    if kubectl get pods -n openebs -l app=loki --no-headers 2>/dev/null | grep -q "Running"; then
      loki_active=true
      loki_state="running"
    elif kubectl get pods -n openebs -l app=loki --no-headers 2>/dev/null | grep -q . || kubectl get statefulset -n openebs openebs-loki >/dev/null 2>&1; then
      loki_state="error"
    fi

    if kubectl get pods -n openebs -l app.kubernetes.io/name=alloy --no-headers 2>/dev/null | grep -q "Running"; then
      alloy_active=true
      alloy_state="running"
    elif kubectl get pods -n openebs -l app.kubernetes.io/name=alloy --no-headers 2>/dev/null | grep -q . || kubectl get daemonset -n openebs openebs-alloy >/dev/null 2>&1; then
      alloy_state="error"
    fi

    if kubectl get pods -n nfs-server --no-headers 2>/dev/null | grep -q "Running"; then
      nfs_active=true
      nfs_state="running"
    elif kubectl get pods -n nfs-server --no-headers 2>/dev/null | grep -q .; then
      nfs_state="error"
    fi
  fi

  local cfg_hostpath="true"
  [[ "${THIS_OPENEBS_ENGINE_HOSTPATH:-true}" == "false" ]] && cfg_hostpath="false"
  local cfg_lvm="true"
  [[ "${THIS_OPENEBS_ENGINE_LVM:-true}" == "false" ]] && cfg_lvm="false"
  local cfg_zfs="false"
  [[ "${THIS_OPENEBS_ENGINE_ZFS:-false}" == "true" ]] && cfg_zfs="true"
  local cfg_rawfile="false"
  [[ "${THIS_OPENEBS_ENGINE_RAWFILE:-false}" == "true" ]] && cfg_rawfile="true"
  local cfg_mayastor="false"
  [[ "${THIS_OPENEBS_ENGINE_MAYASTOR:-false}" == "true" ]] && cfg_mayastor="true"
  local cfg_nats="false"
  [[ "${THIS_OPENEBS_ENABLE_NATS:-false}" == "true" ]] && cfg_nats="true"
  local cfg_minio="false"
  [[ "${THIS_OPENEBS_ENABLE_MINIO:-false}" == "true" ]] && cfg_minio="true"
  local cfg_loki="false"
  [[ "${THIS_OPENEBS_ENABLE_LOKI:-false}" == "true" ]] && cfg_loki="true"
  local cfg_alloy="false"
  [[ "${THIS_OPENEBS_ENABLE_ALLOY:-false}" == "true" ]] && cfg_alloy="true"
  local cfg_nfs="false"
  [[ "${THIS_OPENEBS_INSTALL_NFS:-false}" == "true" ]] && cfg_nfs="true"

  local vgs_json="[]"
  if command -v vgs >/dev/null 2>&1; then
    local raw_vgs
    raw_vgs=$(vgs --reportformat json 2>/dev/null || true)
    if [[ -n "${raw_vgs}" ]] && echo "${raw_vgs}" | grep -q '"report"'; then
      vgs_json=$(echo "${raw_vgs}" | jq -c '.report[0].vg // []' 2>/dev/null || echo "[]")
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
  "openebsActive": ${openebs_running},
  "lvmNodesRegistered": ${lvm_nodes_count},
  "topologyKey": "${THIS_OPENEBS_LVM_TOPOLOGY_KEY:-openebs.io/lvm}",
  "topologyNodes": [$(printf '"%s",' "${labeled_nodes[@]}" | sed 's/,$//')],
  "engines": {
    "hostpath": ${hostpath_active},
    "lvm": ${lvm_active},
    "zfs": ${zfs_active},
    "rawfile": ${rawfile_active},
    "mayastor": ${mayastor_active},
    "nats": ${nats_active},
    "minio": ${minio_active},
    "loki": ${loki_active},
    "alloy": ${alloy_active},
    "nfs": ${nfs_active}
  },
  "engineStates": {
    "hostpath": "${hostpath_state}",
    "lvm": "${lvm_state}",
    "zfs": "${zfs_state}",
    "rawfile": "${rawfile_state}",
    "mayastor": "${mayastor_state}",
    "nats": "${nats_state}",
    "minio": "${minio_state}",
    "loki": "${loki_state}",
    "alloy": "${alloy_state}",
    "nfs": "${nfs_state}"
  },
  "configuredEngines": {
    "hostpath": ${cfg_hostpath},
    "lvm": ${cfg_lvm},
    "zfs": ${cfg_zfs},
    "rawfile": ${cfg_rawfile},
    "mayastor": ${cfg_mayastor},
    "nats": ${cfg_nats},
    "minio": ${cfg_minio},
    "loki": ${cfg_loki},
    "alloy": ${cfg_alloy},
    "nfs": ${cfg_nfs}
  },
  "hostVolumeGroups": ${vgs_json},
  "config": {
    "vg": "${THIS_LVM_VG:-AirVG}",
    "fsType": "${THIS_LVM_FSTYPE:-ext4}",
    "thinProvision": "${THIS_LVM_THIN_PROVISION:-no}",
    "shared": "${THIS_LVM_SHARED:-yes}",
    "storageClass": "${THIS_LVM_STORAGECLASS:-openebs-lvmpv}",
    "isDefaultSc": "${THIS_LVM_IS_DEFAULT_SC:-false}"
  }
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

cmd_benchmark() {
  local sc="${STORAGE_CLASS}"
  if [[ -z "${sc}" ]]; then
    sc=$(kubectl get sc -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}' 2>/dev/null || true)
    if [[ -z "${sc}" ]]; then
      sc=$(kubectl get sc -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "local-path")
    fi
  fi

  local target_ns="default"
  if [[ -n "${THIS_NAMESPACE:-}" ]] && kubectl get namespace "${THIS_NAMESPACE}" >/dev/null 2>&1; then
    target_ns="${THIS_NAMESPACE}"
  fi

  local run_id="bench-$(date +%s)"
  local pvc_bench="storage-bench-pvc-${run_id}"
  local pod_bench="storage-bench-pod-${run_id}"

  echo "==> Running storage benchmark on StorageClass '${sc}' (namespace: ${target_ns})..."

  cleanup() {
    if [[ -n "${pod_bench:-}" ]]; then
      kubectl delete pod "${pod_bench}" -n "${target_ns:-default}" --ignore-not-found --grace-period=0 --force >/dev/null 2>&1 || true
    fi
    if [[ -n "${pvc_bench:-}" ]]; then
      kubectl delete pvc "${pvc_bench}" -n "${target_ns:-default}" --ignore-not-found --grace-period=0 --force >/dev/null 2>&1 || true
    fi
  }
  trap cleanup EXIT

  cat <<EOF | kubectl apply -f - >/dev/null
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${pvc_bench}
  namespace: ${target_ns}
spec:
  accessModes:
    - ReadWriteOnce
  storageClassName: ${sc}
  resources:
    requests:
      storage: 1Gi
---
apiVersion: v1
kind: Pod
metadata:
  name: ${pod_bench}
  namespace: ${target_ns}
spec:
  restartPolicy: Never
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: ${pvc_bench}
  containers:
    - name: bench
      image: alpine:latest
      command: ["/bin/sh", "-c"]
      args:
        - |
          echo "Starting disk benchmark..."
          # Sequential Write 100MB
          START=\$(date +%s%N)
          dd if=/dev/zero of=/data/testfile bs=1M count=100 conv=fdatasync 2>/dev/null
          END=\$(date +%s%N)
          ELAPSED_MS=\$(( (END - START) / 1000000 ))
          if [ "\$ELAPSED_MS" -gt 0 ]; then
            THROUGHPUT_MB=\$(( 100 * 1000 / ELAPSED_MS ))
          else
            THROUGHPUT_MB=100
          fi

          # Random 4k write latency test
          START_4K=\$(date +%s%N)
          dd if=/dev/zero of=/data/testfile4k bs=4k count=1000 conv=fdatasync 2>/dev/null
          END_4K=\$(date +%s%N)
          LATENCY_MS=\$(( (END_4K - START_4K) / 1000000 ))

          rm -f /data/testfile /data/testfile4k
          echo "RESULT:sc=${sc}:throughput_mb_s=\${THROUGHPUT_MB}:seq_write_ms=\${ELAPSED_MS}:lat_4k_ms=\${LATENCY_MS}"
      volumeMounts:
        - name: data
          mountPath: /data
EOF

  echo "--> Waiting for benchmark pod '${pod_bench}' to complete..."
  kubectl wait --for=condition=Ready pod/"${pod_bench}" -n "${target_ns}" --timeout=60s >/dev/null 2>&1 || true
  kubectl wait --for=jsonpath='{.status.phase}'=Succeeded pod/"${pod_bench}" -n "${target_ns}" --timeout=90s >/dev/null 2>&1 || true

  local raw_output
  raw_output=$(kubectl logs "${pod_bench}" -n "${target_ns}" 2>/dev/null || echo "")

  local throughput_mb_s="N/A"
  local seq_write_ms="N/A"
  local lat_4k_ms="N/A"

  if [[ "${raw_output}" =~ RESULT:sc=([^:]+):throughput_mb_s=([0-9]+):seq_write_ms=([0-9]+):lat_4k_ms=([0-9]+) ]]; then
    throughput_mb_s="${BASH_REMATCH[2]}"
    seq_write_ms="${BASH_REMATCH[3]}"
    lat_4k_ms="${BASH_REMATCH[4]}"
  fi

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat <<EOF
{
  "storageClass": "${sc}",
  "namespace": "${target_ns}",
  "status": "completed",
  "metrics": {
    "sequentialWriteSpeedMBs": ${throughput_mb_s:-0},
    "sequentialWriteTimeMs": ${seq_write_ms:-0},
    "random4kWriteTimeMs": ${lat_4k_ms:-0}
  }
}
EOF
    return 0
  fi

  echo ""
  echo "=================================================================="
  echo "               Storage Benchmark Performance Report               "
  echo "=================================================================="
  echo "  StorageClass Tested     : ${sc}"
  echo "  Namespace               : ${target_ns}"
  echo "  Sequential Write Speed  : ${throughput_mb_s} MB/s"
  echo "  Sequential Write 100MB  : ${seq_write_ms} ms"
  echo "  Random 4K (1000 ops)    : ${lat_4k_ms} ms"
  echo "=================================================================="
}

case "${ACTION}" in
  status)
    cmd_status
    ;;
  check-prereqs)
    cmd_check_prereqs
    ;;
  install)
    persist_storage_env
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
  benchmark|bench)
    cmd_benchmark
    ;;
  *)
    cmd_status
    ;;
esac
