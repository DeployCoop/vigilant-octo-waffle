#!/usr/bin/env bash
# ==============================================================================
# src/k3s_kill.sh - Cluster Teardown and Node Uninstallation Utility
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TARGETS_FILE=""
SSH_TARGET=""
SSH_PORT="22"
SSH_KEY=""
PARALLEL_JOBS=10
LOCAL_KILL=false
CONFIRM=true
DRY_RUN=false

usage() {
  cat << 'EOF'
Usage: ./src/k3s_kill.sh [options]

Tears down and uninstalls K3s from nodes (local, remote, or across targets file).
Executes /usr/local/bin/k3s-uninstall.sh or /usr/local/bin/k3s-agent-uninstall.sh.

Options:
  --local                      Uninstall K3s on the local machine
  --remote, --ssh <user@host>  Uninstall K3s on a remote host via SSH
  --targets <file>             Uninstall K3s on hosts listed in targets file
  --all                        Uninstall on local machine AND all targets file hosts
  --ssh-port <port>            SSH port for remote connections (default: 22)
  --ssh-key <path>             Path to SSH private key
  -j, --parallel <N>           Run up to N parallel uninstall tasks (default: 10)
  -y, --yes, --force           Skip confirmation prompt
  -h, --help                   Show this help message

Examples:
  # Uninstall locally:
  ./src/k3s_kill.sh --local -y

  # Uninstall single worker:
  ./src/k3s_kill.sh --remote root@192.168.1.50 -y

  # Uninstall all nodes in targets file:
  ./src/k3s_kill.sh --targets targets.txt -y

  # Complete cluster wipeout (local server + all worker targets):
  ./src/k3s_kill.sh --all --targets targets.txt -y
EOF
}

TARGETS_LIST=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --local)
      LOCAL_KILL=true
      shift
      ;;
    --remote|--ssh)
      SSH_TARGET="$2"
      shift 2
      ;;
    --targets)
      TARGETS_FILE="$2"
      shift 2
      ;;
    --all)
      LOCAL_KILL=true
      if [[ -z "${TARGETS_FILE}" && -f "targets" ]]; then
        TARGETS_FILE="targets"
      elif [[ -z "${TARGETS_FILE}" && -f "${PROJECT_ROOT}/targets" ]]; then
        TARGETS_FILE="${PROJECT_ROOT}/targets"
      fi
      shift
      ;;
    --ssh-port)
      SSH_PORT="$2"
      shift 2
      ;;
    --ssh-key)
      SSH_KEY="$2"
      shift 2
      ;;
    -j|--parallel)
      PARALLEL_JOBS="$2"
      shift 2
      ;;
    -y|--yes|--force)
      CONFIRM=false
      shift
      ;;
    --dry-run)
      DRY_RUN=true
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
      TARGETS_LIST+=("$1")
      shift
      ;;
  esac
done

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "[DRY-RUN] Would tear down and uninstall K3s on target nodes (local: ${LOCAL_KILL}, targets: ${TARGETS_FILE:-none})."
  exit 0
fi

if [[ -n "${SSH_TARGET}" ]]; then
  TARGETS_LIST+=("${SSH_TARGET}")
fi

if [[ -n "${TARGETS_FILE}" ]]; then
  if [[ ! -f "${TARGETS_FILE}" ]]; then
    echo "Error: Targets file '${TARGETS_FILE}' not found." >&2
    exit 1
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    t=$(echo "${line}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    [[ -z "${t}" || "${t}" =~ ^# ]] && continue
    TARGETS_LIST+=("${t}")
  done < "${TARGETS_FILE}"
fi

# If no target specified and 'targets' file exists, default targets to it
if [[ "${LOCAL_KILL}" == "false" && ${#TARGETS_LIST[@]} -eq 0 && -f "targets" ]]; then
  echo "==> Found local 'targets' file; including targets..."
  while IFS= read -r line || [[ -n "$line" ]]; do
    t=$(echo "${line}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    [[ -z "${t}" || "${t}" =~ ^# ]] && continue
    TARGETS_LIST+=("${t}")
  done < "targets"
fi

if [[ "${LOCAL_KILL}" == "false" && ${#TARGETS_LIST[@]} -eq 0 ]]; then
  echo "Error: No target nodes specified. Use --local, --remote <host>, or --targets <file>." >&2
  exit 1
fi

echo "============================================================"
echo "K3s Cluster / Node Teardown Utility"
echo "============================================================"
if [[ "${LOCAL_KILL}" == "true" ]]; then
  echo "Local Machine : WILL UNINSTALL K3S"
fi
if [[ ${#TARGETS_LIST[@]} -gt 0 ]]; then
  echo "Remote Nodes  : ${#TARGETS_LIST[@]} host(s)"
  for t in "${TARGETS_LIST[@]}"; do
    echo "  - ${t}"
  done
fi
echo "============================================================"

if [[ "${CONFIRM}" == "true" ]]; then
  read -r -p "WARNING: This will permanently stop and uninstall K3s on these nodes. Proceed? [y/N]: " response
  if [[ ! "${response}" =~ ^[yY]([eE][sS])?$ ]]; then
    echo "Aborted by user."
    exit 0
  fi
fi

kill_local() {
  echo "==> Uninstalling K3s on local machine..."
  local uninstalled=false
  if [[ -f /usr/local/bin/k3s-uninstall.sh ]]; then
    echo "Running /usr/local/bin/k3s-uninstall.sh..."
    if [[ $(id -u) -ne 0 ]]; then
      sudo /usr/local/bin/k3s-uninstall.sh || true
    else
      /usr/local/bin/k3s-uninstall.sh || true
    fi
    uninstalled=true
  fi

  if [[ -f /usr/local/bin/k3s-agent-uninstall.sh ]]; then
    echo "Running /usr/local/bin/k3s-agent-uninstall.sh..."
    if [[ $(id -u) -ne 0 ]]; then
      sudo /usr/local/bin/k3s-agent-uninstall.sh || true
    else
      /usr/local/bin/k3s-agent-uninstall.sh || true
    fi
    uninstalled=true
  fi

  if [[ "${uninstalled}" == "false" ]]; then
    echo "No K3s uninstall script found on local machine."
  else
    echo "==> Local K3s uninstallation completed."
  fi
}

kill_remote() {
  local host="$1"
  local ssh_opts=(-p "${SSH_PORT}" -o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=10")
  if [[ -n "${SSH_KEY}" ]]; then
    ssh_opts+=(-i "${SSH_KEY}")
  fi

  echo "==> [${host}] Triggering K3s uninstall..."
  local uninstall_cmd='
    if [ -f /usr/local/bin/k3s-agent-uninstall.sh ]; then
      echo "Executing k3s-agent-uninstall.sh on $(hostname)..."
      /usr/local/bin/k3s-agent-uninstall.sh || true
    elif [ -f /usr/local/bin/k3s-uninstall.sh ]; then
      echo "Executing k3s-uninstall.sh on $(hostname)..."
      /usr/local/bin/k3s-uninstall.sh || true
    else
      echo "No K3s uninstall script found on $(hostname)."
    fi
  '

  if ssh "${ssh_opts[@]}" "${host}" "sudo bash -c '$uninstall_cmd'" 2>&1; then
    echo "==> [${host}] K3s uninstall finished."
  else
    echo "==> [${host}] Warning: Failed to connect or execute uninstall." >&2
  fi
}

export -f kill_remote
export SSH_PORT SSH_KEY

if [[ ${#TARGETS_LIST[@]} -gt 0 ]]; then
  echo "==> Tearing down remote nodes (parallelism: ${PARALLEL_JOBS})..."
  if [[ ${PARALLEL_JOBS} -gt 1 ]] && command -v parallel >/dev/null 2>&1; then
    printf "%s\n" "${TARGETS_LIST[@]}" | parallel -j "${PARALLEL_JOBS}" kill_remote {}
  else
    for host in "${TARGETS_LIST[@]}"; do
      kill_remote "${host}"
    done
  fi
fi

if [[ "${LOCAL_KILL}" == "true" ]]; then
  kill_local
fi

echo "============================================================"
echo "Teardown operation finished."
echo "============================================================"
