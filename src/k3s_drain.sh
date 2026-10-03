#!/usr/bin/env bash
# ==============================================================================
# src/k3s_drain.sh - Production Node Cordon, Drain, and Uncordon Orchestrator
# ==============================================================================
# Safely evicts workloads with PodDisruptionBudget respect, handles daemonsets,
# and restores node scheduling upon completion of maintenance.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH}"

usage() {
  cat << 'EOF'
Usage: ./src/k3s_drain.sh <action> <node-name> [options]

Production node maintenance operations for K3s.

Actions:
  cordon <node>               Mark node as unschedulable (stops new pods from landing)
  uncordon <node>             Mark node as schedulable (resumes normal workload placement)
  drain <node>                Evict all pods safely from node for hardware/OS maintenance

Options for drain:
      --grace-period <sec>    Period of time in seconds given to each pod to terminate (default: 60)
      --timeout <duration>    The length of time to wait before giving up (default: 5m)
      --ignore-daemonsets     Ignore DaemonSet-managed pods (default: true)
      --delete-emptydir-data  Continue even if there are pods using emptyDir (default: true)
      --force                 Continue even if there are pods not managed by a controller
  -h, --help                  Show this help message

Examples:
  # Cordon a node before maintenance:
  ./src/k3s_drain.sh cordon worker-node-01

  # Safely drain a node for kernel upgrade:
  ./src/k3s_drain.sh drain worker-node-01 --grace-period 30

  # Return node to service after maintenance:
  ./src/k3s_drain.sh uncordon worker-node-01
EOF
}

if ! command -v kubectl >/dev/null 2>&1; then
  echo "Error: kubectl binary not found in path." >&2
  exit 1
fi

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || "${2:-}" == "-h" || "${2:-}" == "--help" ]]; then
  usage
  exit 0
fi

ACTION="${1:-}"
NODE_NAME="${2:-}"

if [[ -z "${ACTION}" || -z "${NODE_NAME}" ]]; then
  usage
  exit 1
fi

shift 2 || true

GRACE_PERIOD=60
TIMEOUT="5m"
IGNORE_DAEMONSETS=true
DELETE_EMPTYDIR=true
FORCE=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --grace-period)
      GRACE_PERIOD="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --ignore-daemonsets)
      IGNORE_DAEMONSETS=true
      shift
      ;;
    --delete-emptydir-data)
      DELETE_EMPTYDIR=true
      shift
      ;;
    --force)
      FORCE=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

# Verify node exists
if ! kubectl get node "${NODE_NAME}" >/dev/null 2>&1; then
  echo "Error: Node '${NODE_NAME}' does not exist in cluster." >&2
  echo "Available nodes:"
  kubectl get nodes -o custom-columns=NAME:.metadata.name,STATUS:.status.conditions[-1].type
  exit 1
fi

case "${ACTION}" in
  cordon)
    echo "==> Cordoning node: ${NODE_NAME}..."
    kubectl cordon "${NODE_NAME}"
    echo "✓ Node ${NODE_NAME} marked as SchedulingDisabled."
    ;;
  uncordon)
    echo "==> Uncordoning node: ${NODE_NAME}..."
    kubectl uncordon "${NODE_NAME}"
    echo "✓ Node ${NODE_NAME} marked as Schedulable."
    ;;
  drain)
    echo "============================================================"
    echo "Draining Node: ${NODE_NAME}"
    echo "============================================================"
    echo "Grace Period      : ${GRACE_PERIOD}s"
    echo "Timeout           : ${TIMEOUT}"
    echo "Ignore DaemonSets : ${IGNORE_DAEMONSETS}"
    echo "Delete EmptyDir   : ${DELETE_EMPTYDIR}"
    echo "Force             : ${FORCE}"
    echo "============================================================"

    DRAIN_ARGS=(
      "${NODE_NAME}"
      --grace-period="${GRACE_PERIOD}"
      --timeout="${TIMEOUT}"
    )

    if [[ "${IGNORE_DAEMONSETS}" == "true" ]]; then
      DRAIN_ARGS+=(--ignore-daemonsets)
    fi
    if [[ "${DELETE_EMPTYDIR}" == "true" ]]; then
      DRAIN_ARGS+=(--delete-emptydir-data)
    fi
    if [[ "${FORCE}" == "true" ]]; then
      DRAIN_ARGS+=(--force)
    fi

    kubectl drain "${DRAIN_ARGS[@]}"
    echo "✓ Node ${NODE_NAME} successfully drained."
    ;;
  *)
    echo "Error: Unknown action '${ACTION}'." >&2
    usage
    exit 1
    ;;
esac
