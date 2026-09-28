#!/usr/bin/env bash
# ==============================================================================
# src/k3s_build.sh - End-to-End K3s Cluster Build and Rebuild Automation
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

REBUILD=false
TARGETS_FILE=""
PARALLEL_JOBS=10
SKIP_JOIN=false
SKIP_TUNE=false
SKIP_UP=false
REGISTRIES_FILE=""
NON_INTERACTIVE=false

usage() {
  cat << 'EOF'
Usage: ./src/k3s_build.sh [options]

Builds or rebuilds an entire K3s cluster:
  1. (Rebuild only) Tears down existing cluster nodes (kill)
  2. Applies kernel modules (nvme_*) and system limits (nofile/inotify)
  3. Deploys container registry mirrors (registries.yaml)
  4. Initializes K3s control-plane server
  5. Configures kubeconfig permissions
  6. Batch joins worker nodes from targets file in parallel
  7. Runs platform bootstrap (./up)

Options:
      --rebuild                Wipe existing cluster nodes before building
      --targets <file>         Path to targets file with remote worker node IPs
  -j, --parallel <N>           Parallel worker join jobs (default: 10)
      --skip-join              Only build master node, skip worker join
      --skip-tune              Skip kernel module and sysctl limit tuning
      --skip-up                Skip running full platform bootstrap (./up)
      --registries-file <file> Custom registries.yaml source file
  -y, --yes                    Non-interactive execution (skip confirmation)
  -h, --help                   Show this help message

Examples:
  # Build master and join workers listed in targets file:
  ./src/k3s_build.sh --targets targets.txt

  # Full tear down and fresh rebuild of cluster:
  ./src/k3s_build.sh --rebuild --targets targets.txt -y

  # Quick master-only build:
  ./src/k3s_build.sh --skip-join
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild)
      REBUILD=true
      shift
      ;;
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
    --registries-file)
      REGISTRIES_FILE="$2"
      shift 2
      ;;
    -y|--yes)
      NON_INTERACTIVE=true
      shift
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
  fi
fi

echo "============================================================"
echo "K3s Cluster Automated $(if [[ "${REBUILD}" == "true" ]]; then echo "REBUILD"; else echo "BUILD"; fi)"
echo "============================================================"
echo "Targets File : ${TARGETS_FILE:-None (control-plane only)}"
echo "Parallelism  : ${PARALLEL_JOBS}"
echo "Tuning       : $(if [[ "${SKIP_TUNE}" == "true" ]]; then echo "Disabled"; else echo "Enabled"; fi)"
echo "Worker Join  : $(if [[ "${SKIP_JOIN}" == "true" ]]; then echo "Disabled"; else echo "Enabled"; fi)"
echo "Platform Up  : $(if [[ "${SKIP_UP}" == "true" ]]; then echo "Disabled"; else echo "Enabled"; fi)"
echo "============================================================"

# Step 1: Teardown (if rebuilding)
if [[ "${REBUILD}" == "true" ]]; then
  echo ""
  echo ">>> [Step 1/6] Tearing down existing cluster..."
  KILL_ARGS=(--all -y)
  if [[ -n "${TARGETS_FILE}" ]]; then
    KILL_ARGS+=(--targets "${TARGETS_FILE}")
  fi
  "${SCRIPT_DIR}/k3s_kill.sh" "${KILL_ARGS[@]}" || {
    echo "Warning: Teardown finished with warnings, continuing..." >&2
  }
fi

# Step 2: Invoke Canonical Bring-Up Engine (src/k3s_up.sh)
UP_ARGS=()
if [[ -n "${TARGETS_FILE}" ]]; then
  UP_ARGS+=(--targets "${TARGETS_FILE}")
fi
UP_ARGS+=(-j "${PARALLEL_JOBS}")
if [[ "${SKIP_JOIN}" == "true" ]]; then
  UP_ARGS+=(--skip-join)
fi
if [[ "${SKIP_TUNE}" == "true" ]]; then
  UP_ARGS+=(--skip-tune)
fi
if [[ "${SKIP_UP}" == "false" ]]; then
  UP_ARGS+=(--run-platform-up)
fi
if [[ -n "${REGISTRIES_FILE}" ]]; then
  UP_ARGS+=(--registries-file "${REGISTRIES_FILE}")
fi

"${SCRIPT_DIR}/k3s_up.sh" "${UP_ARGS[@]}"

