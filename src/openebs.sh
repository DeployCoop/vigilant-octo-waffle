#!/usr/bin/env bash
THIS_THING=openebs
source src/common.sh
set -euo pipefail

OPENEBS_ENVSUBST=$(mktemp)
OPENEBS_INSTALL_TMP=$(mktemp)
trap "rm -f ${OPENEBS_ENVSUBST} ${OPENEBS_INSTALL_TMP}" EXIT

main() {
  echo "============================================================"
  echo "OpenEBS Storage Fabric & LocalPV Orchestrator"
  echo "============================================================"
  
  src/namespacer.sh "${THIS_OPENEBS_NAMESPACE:-openebs}"

  # Probe kernel modules
  if [[ "${THIS_OPENEBS_ENGINE_MAYASTOR:-false}" == "true" ]]; then
    src/kmod.sh nvme_tcp || true
  fi

  if [[ "${THIS_OPENEBS_ENGINE_LVM:-true}" == "true" ]]; then
    if command -v modprobe >/dev/null 2>&1; then
      sudo -n modprobe dm_mod 2>/dev/null || true
      sudo -n modprobe dm_snapshot 2>/dev/null || true
    fi

    # Auto-detect local LVM volume groups if default placeholder was used
    if [[ "${THIS_LVM_VG}" == "${THIS_NAME}VG" || -z "${THIS_LVM_VG}" ]]; then
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

    # Node Topology Labeling
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
  fi

  # Prepare envsubst values template
  echo '#!/bin/sh' > "${OPENEBS_ENVSUBST}"
  echo 'set -eu' >> "${OPENEBS_ENVSUBST}"
  echo 'envsubst \' >> "${OPENEBS_ENVSUBST}"
  convert_default_env_to_envsubst >> "${OPENEBS_ENVSUBST}"
  echo -n "< ${THIS_OPENEBS_HELM_TEMPLATE} " >> "${OPENEBS_ENVSUBST}"
  echo '\' >> "${OPENEBS_ENVSUBST}"
  echo "> ${OPENEBS_INSTALL_TMP}" >> "${OPENEBS_ENVSUBST}"

  # Validate deployment method: fallback to helm if argocd is not operational
  local install_method="${THIS_OPENEBS_INSTALL_METHOD:-helm}"
  if [[ "${install_method}" == "argocd" ]]; then
    if ! kubectl get namespace argocd >/dev/null 2>&1; then
      echo "Notice: ArgoCD namespace not found. Falling back to Helm installation."
      install_method="helm"
    fi
  fi

  if [[ "${install_method}" == "argocd" ]]; then
    argoRunner "$THIS_THING"
  elif [[ "${install_method}" == "helm" ]]; then
    bash "${OPENEBS_ENVSUBST}"

    # Ensure Helm repo exists
    if command -v helm >/dev/null 2>&1; then
      helm repo add openebs https://openebs.github.io/openebs >/dev/null 2>&1 || true
      helm repo update openebs >/dev/null 2>&1 || true
    fi

    echo "--> Installing / Upgrading OpenEBS release 'openebs-${THIS_NAME}'..."
    helm upgrade --install "openebs-${THIS_NAME}" \
      --namespace "${THIS_OPENEBS_NAMESPACE:-openebs}" \
      openebs/openebs \
      --timeout 10m0s \
      --create-namespace \
      -f "${OPENEBS_INSTALL_TMP}"
  else
    echo "Error: Unknown installation method '${install_method}'"
    exit 1
  fi

  set +e
  sleep 3
  w8_all_namespace "${THIS_OPENEBS_NAMESPACE:-openebs}"
  set -e

  echo "--> Initializing OpenEBS StorageClasses from init/openebs..."
  initializer "$this_cwd/init/openebs"

  if [[ "${THIS_OPENEBS_INSTALL_NFS:-false}" == "true" ]]; then
    echo "--> Deploying NFS Server fabric..."
    src/namespacer.sh nfs-server
    initializer "$this_cwd/init/openebs-nfs"
  fi

  echo "OpenEBS storage fabric deployed successfully."
}

time main
