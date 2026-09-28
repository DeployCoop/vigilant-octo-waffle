#!/usr/bin/env bash
# ==============================================================================
# src/k3s_ping.sh - Node Connectivity, Uptime, and IP Health Check
# ==============================================================================
set -euo pipefail

TARGETS_FILE=""
SSH_TARGET=""
SSH_PORT="22"
SSH_KEY=""
PARALLEL_JOBS=1

usage() {
  cat << 'EOF'
Usage: ./src/k3s_ping.sh [options] [host1 host2 ...]

Pings cluster nodes over SSH to check hostname, uptime, load, and IP addresses.

Options:
  --targets <file>             Read hosts from a targets file
  --ssh <user@host>            Check a single target host
  --ssh-port <port>            SSH port (default: 22)
  --ssh-key <path>             Path to SSH private key
  -j, --parallel <N>           Run up to N parallel SSH checks (default: 1)
  -h, --help                   Show this help message

Examples:
  # Check targets in targets.txt:
  ./src/k3s_ping.sh --targets targets.txt

  # Check specific node:
  ./src/k3s_ping.sh --ssh root@192.168.1.50

  # Check nodes in parallel:
  ./src/k3s_ping.sh --targets targets.txt -j 10
EOF
}

TARGETS_LIST=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --targets)
      TARGETS_FILE="$2"
      shift 2
      ;;
    --ssh)
      SSH_TARGET="$2"
      shift 2
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

# Fallback to local 'targets' file if present and no targets specified
if [[ ${#TARGETS_LIST[@]} -eq 0 && -f "targets" ]]; then
  echo "==> Using local 'targets' file..."
  while IFS= read -r line || [[ -n "$line" ]]; do
    t=$(echo "${line}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    [[ -z "${t}" || "${t}" =~ ^# ]] && continue
    TARGETS_LIST+=("${t}")
  done < "targets"
fi

if [[ ${#TARGETS_LIST[@]} -eq 0 ]]; then
  echo "==> No remote targets specified; checking local machine:"
  echo "Hostname : $(hostname)"
  echo "Uptime   : $(uptime)"
  echo "IPs      : $(hostname -I 2>/dev/null || echo '127.0.0.1')"
  exit 0
fi

echo "============================================================"
echo "Pinging ${#TARGETS_LIST[@]} node(s)..."
echo "============================================================"

check_host() {
  local host="$1"
  local ssh_opts=(-p "${SSH_PORT}" -o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=5")
  if [[ -n "${SSH_KEY}" ]]; then
    ssh_opts+=(-i "${SSH_KEY}")
  fi

  echo "--- Node: ${host} ---"
  if ssh "${ssh_opts[@]}" "${host}" "echo \"Hostname: \$(hostname) | Uptime: \$(uptime -p 2>/dev/null || uptime) | IP: \$(hostname -I 2>/dev/null || ip -br a)\"" 2>/dev/null; then
    echo "Status   : REACHABLE"
  else
    echo "Status   : UNREACHABLE"
  fi
  echo ""
}

export -f check_host
export SSH_PORT SSH_KEY

if [[ ${PARALLEL_JOBS} -gt 1 ]] && command -v parallel >/dev/null 2>&1; then
  printf "%s\n" "${TARGETS_LIST[@]}" | parallel -j "${PARALLEL_JOBS}" check_host {}
else
  for host in "${TARGETS_LIST[@]}"; do
    check_host "${host}"
  done
fi
