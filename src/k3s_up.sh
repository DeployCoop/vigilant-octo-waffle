#!/usr/bin/env bash
# ==============================================================================
# src/k3s_up.sh - Canonical K3s Cluster Bring-Up & Multi-Node Provisioner
# ==============================================================================
# Consolidates all k3sbuilder capabilities (tuning, registries, install, batch join)
# directly into vigilant-octo-waffle.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Ensure system paths are in PATH
export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH}"

# Source environment variables if available
set +u
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
  set -a && source "${PROJECT_ROOT}/.env" && set +a
fi
if [[ -f "${PROJECT_ROOT}/src/default.env" ]]; then
  set -a && source "${PROJECT_ROOT}/src/default.env" && set +a
fi
set -u

TARGETS_FILE=""
PARALLEL_JOBS=10
SKIP_JOIN=false
SKIP_TUNE=false
SKIP_UP=true
REGISTRIES_FILE=""

usage() {
  cat << 'EOF'
Usage: ./src/k3s_up.sh [options]

Brings up a complete, production-tuned K3s cluster:
  1. Applies kernel modules (nvme_*) and system limits (nofile/inotify) locally
  2. Provisions container registry mirrors (/etc/rancher/k3s/registries.yaml)
  3. Installs or starts the K3s control-plane server
  4. Configures ~/.kube/config with safe permissions
  5. Waits for control-plane Ready state
  6. Batch joins worker nodes in parallel from targets file (with tuning & registries)
  7. Verifies cluster node topology

Options:
      --targets <file>         Path to targets file with remote worker node IPs/hosts
  -j, --parallel <N>           Parallel worker join jobs (default: 10)
      --skip-join              Only bring up control-plane, skip joining workers
      --skip-tune              Skip kernel module and sysctl limit tuning
      --run-platform-up        Launch platform services bootstrap (./up) after cluster is up
      --registries-file <file> Custom registries.yaml source file
  -h, --help                   Show this help message

Examples:
  # Bring up local control-plane and join all nodes in targets:
  ./src/k3s_up.sh --targets targets.txt

  # Bring up standalone master without joining workers:
  ./src/k3s_up.sh --skip-join

  # Bring up cluster and immediately bootstrap all platform apps (ArgoCD, Ceph, etc.):
  ./src/k3s_up.sh --run-platform-up
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --targets)
      TARGETS_FILE="$2"
      shift 2
      ;;
    -j|--parallel)
      PARALLEL_JOBS="$2"
      shift 2
      ;;
    --skip-join)
      SKIP_JOIN=true
      shift
      ;;
    --skip-tune)
      SKIP_TUNE=true
      shift
      ;;
    --skip-up)
      SKIP_UP=true
      shift
      ;;
    --run-platform-up)
      SKIP_UP=false
      shift
      ;;
    --registries-file)
      REGISTRIES_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      if [[ -z "${TARGETS_FILE}" && -f "$1" ]]; then
        TARGETS_FILE="$1"
      fi
      shift
      ;;
  esac
done

# Auto-detect targets file if not explicitly specified
if [[ -z "${TARGETS_FILE}" ]]; then
  if [[ -f "${PROJECT_ROOT}/targets" ]]; then
    TARGETS_FILE="${PROJECT_ROOT}/targets"
  elif [[ -f "targets" ]]; then
    TARGETS_FILE="targets"
  elif [[ -f "${PROJECT_ROOT}/targets.txt" ]]; then
    TARGETS_FILE="${PROJECT_ROOT}/targets.txt"
  elif [[ -n "${K3S_TARGETS_FILE:-}" && -f "${K3S_TARGETS_FILE}" ]]; then
    TARGETS_FILE="${K3S_TARGETS_FILE}"
  fi
fi

echo "============================================================"
echo "Vigilant-Octo-Waffle: K3s Cluster Bring-Up Engine"
echo "============================================================"
echo "Targets File : ${TARGETS_FILE:-None (standalone master)}"
echo "Parallelism  : ${PARALLEL_JOBS}"
echo "Host Tuning  : $(if [[ "${SKIP_TUNE}" == "true" ]]; then echo "Disabled"; else echo "Enabled"; fi)"
echo "Worker Join  : $(if [[ "${SKIP_JOIN}" == "true" ]]; then echo "Disabled"; else echo "Enabled"; fi)"
echo "Platform Up  : $(if [[ "${SKIP_UP}" == "true" ]]; then echo "Deferred"; else echo "Automated (./up)"; fi)"
echo "============================================================"

# Step 1: Host OS Tuning & Storage Kernel Modules
if [[ "${SKIP_TUNE}" == "false" ]]; then
  echo ""
  echo ">>> [Step 1/5] Applying kernel modules (nvme_*) & system limits (nofile/inotify)..."
  "${SCRIPT_DIR}/k3s_kmod.sh" || {
    echo "Warning: Local kernel module loading had non-fatal warnings." >&2
  }
  "${SCRIPT_DIR}/k3s_tune.sh" || {
    echo "Warning: Local limits tuning had non-fatal warnings." >&2
  }
fi

# Step 2: Container Registry Mirrors & Config
echo ""
echo ">>> [Step 2/5] Configuring container registry mirrors..."
REG_ARGS=(--copy-kubeconfig)
if [[ -n "${REGISTRIES_FILE}" ]]; then
  REG_ARGS+=(--file "${REGISTRIES_FILE}")
fi
"${SCRIPT_DIR}/k3s_registries.sh" "${REG_ARGS[@]}" || {
  echo "Warning: Registries deployment reported non-fatal warning." >&2
}

# Step 3: Primary Control-Plane Server
echo ""
echo ">>> [Step 3/5] Starting or installing K3s control-plane server..."
IS_RUNNING=false
if command -v kubectl >/dev/null 2>&1 && kubectl get nodes >/dev/null 2>&1; then
  echo "K3s cluster is already running and reachable via kubectl."
  IS_RUNNING=true
fi

if [[ "${IS_RUNNING}" == "false" ]]; then
  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet k3s 2>/dev/null; then
    echo "K3s systemd service is active."
  elif [[ -f /usr/local/bin/k3s || -f /usr/bin/k3s ]]; then
    echo "K3s binary found. Starting service..."
    if command -v systemctl >/dev/null 2>&1; then
      sudo systemctl start k3s 2>/dev/null || true
    fi
  fi

  # If still not reachable, run install_k3s.sh
  if ! (command -v kubectl >/dev/null 2>&1 && kubectl get nodes >/dev/null 2>&1); then
    echo "Executing K3s installer (src/install_k3s.sh)..."
    "${SCRIPT_DIR}/install_k3s.sh"
  fi
fi

# Configure ~/.kube/config permissions
mkdir -p "${HOME}/.kube"
if [[ -f /etc/rancher/k3s/k3s.yaml ]]; then
  if [[ $(id -u) -eq 0 ]]; then
    cp /etc/rancher/k3s/k3s.yaml "${HOME}/.kube/config"
    chmod 600 "${HOME}/.kube/config"
  else
    sudo cp /etc/rancher/k3s/k3s.yaml "${HOME}/.kube/config"
    sudo chown "$(id -u):$(id -g)" "${HOME}/.kube/config"
    chmod 600 "${HOME}/.kube/config"
  fi
fi

# Step 4: Wait for Control-Plane to reach Ready
echo ""
echo ">>> [Step 4/5] Waiting for control-plane node to reach Ready state..."
READY=false
for i in {1..30}; do
  if command -v kubectl >/dev/null 2>&1 && kubectl get nodes >/dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 2
done

if [[ "${READY}" == "false" ]]; then
  echo "Error: K3s control-plane failed to become ready after 60 seconds." >&2
  exit 1
fi
echo "Control-plane is active and responding."

# Step 5: Batch Join Worker Nodes in Parallel
if [[ "${SKIP_JOIN}" == "false" && -n "${TARGETS_FILE}" && -f "${TARGETS_FILE}" ]]; then
  echo ""
  echo ">>> [Step 5/5] Batch provisioning and joining worker nodes from: ${TARGETS_FILE}..."
  JOIN_ARGS=(
    --role agent
    --targets "${TARGETS_FILE}"
    -j "${PARALLEL_JOBS}"
  )
  if [[ "${SKIP_TUNE}" == "false" ]]; then
    JOIN_ARGS+=(--tune)
  fi
  JOIN_ARGS+=(--copy-registries)
  if [[ -n "${REGISTRIES_FILE}" ]]; then
    JOIN_ARGS+=(--registries-file "${REGISTRIES_FILE}")
  fi

  "${SCRIPT_DIR}/k3s_add_node.sh" "${JOIN_ARGS[@]}"
else
  echo ""
  echo ">>> [Step 5/5] Skipping worker join (no targets file or --skip-join enabled)."
fi

echo ""
echo "============================================================"
echo "Cluster Topology Summary"
echo "============================================================"
if command -v kubectl >/dev/null 2>&1; then
  kubectl get nodes -o wide || true
fi
echo "============================================================"
echo "K3s cluster bring-up completed successfully!"
echo "============================================================"

# Optional Platform Bootstrap
if [[ "${SKIP_UP}" == "false" ]]; then
  echo ""
  echo ">>> Launching platform services (./up)..."
  cd "${PROJECT_ROOT}"
  export THIS_K8S_TYPE="k3s"
  ./up
fi
