#!/usr/bin/env bash
# ==============================================================================
# src/k3s_tune.sh - Node OS Limits & Sysctl Tuning for K3s & Container Workloads
# ==============================================================================
set -euo pipefail

SSH_TARGET=""
SSH_PORT="22"
SSH_KEY=""
TARGETS_FILE=""

usage() {
  cat << 'EOF'
Usage: ./src/k3s_tune.sh [options]

Tunes node system limits (nofile, inotify, fs.file-max, vm.max_map_count)
to prevent container crashes and file descriptor exhaustion on K3s nodes.

Options:
  --remote <user@host>         Tune a remote host via SSH
  --targets <file>             Tune multiple hosts listed in a targets file
  --ssh-port <port>            SSH port for remote connections (default: 22)
  --ssh-key <path>             Path to SSH private key
  -h, --help                   Show this help message

Tunings Applied:
  - File limits: nofile 1065536 (soft and hard in /etc/security/limits.d/)
  - fs.file-max: 1000000
  - fs.inotify.max_user_instances: 1024
  - fs.inotify.max_user_watches: 1048576
  - vm.max_map_count: 262144 (required by OpenSearch/ElasticSearch/databases)
  - net.core.somaxconn: 32768

Examples:
  # Tune local machine:
  ./src/k3s_tune.sh

  # Tune remote worker node:
  ./src/k3s_tune.sh --remote root@192.168.1.50

  # Tune all nodes in targets.txt:
  ./src/k3s_tune.sh --targets targets.txt
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)
      SSH_TARGET="$2"
      shift 2
      ;;
    --targets)
      TARGETS_FILE="$2"
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

tune_local() {
  echo "==> Applying K3s node system & kernel limits locally..."

  # 1. Active shell limits
  ulimit -Hn 1065536 2>/dev/null || true
  ulimit -Sn 1065536 2>/dev/null || true

  # Helper to append if missing
  add_line() {
    local line="$1"
    local file="$2"
    if [[ $(id -u) -eq 0 ]]; then
      mkdir -p "$(dirname "${file}")"
      touch "${file}"
      if ! grep -qF "${line}" "${file}" 2>/dev/null; then
        echo "${line}" >> "${file}"
        echo "  [UPDATED] ${file}: ${line}"
      fi
    else
      sudo mkdir -p "$(dirname "${file}")" 2>/dev/null || true
      sudo touch "${file}" 2>/dev/null || true
      if ! sudo grep -qF "${line}" "${file}" 2>/dev/null; then
        echo "${line}" | sudo tee -a "${file}" >/dev/null
        echo "  [UPDATED] ${file}: ${line} (via sudo)"
      fi
    fi
  }

  # 2. Security Limits (/etc/security/limits.d/99-k3s-nofile.conf)
  local limits_file="/etc/security/limits.d/99-k3s-nofile.conf"
  add_line "*                hard    nofile          1065536" "${limits_file}"
  add_line "*                soft    nofile          1065536" "${limits_file}"
  add_line "root             hard    nofile          1065536" "${limits_file}"
  add_line "root             soft    nofile          1065536" "${limits_file}"

  # 3. Sysctl parameters (/etc/sysctl.d/99-k3s-tune.conf)
  local sysctl_file="/etc/sysctl.d/99-k3s-tune.conf"
  add_line "fs.file-max = 1000000" "${sysctl_file}"
  add_line "fs.inotify.max_user_instances = 1024" "${sysctl_file}"
  add_line "fs.inotify.max_user_watches = 1048576" "${sysctl_file}"
  add_line "vm.max_map_count = 262144" "${sysctl_file}"
  add_line "net.core.somaxconn = 32768" "${sysctl_file}"
  add_line "net.ipv4.ip_forward = 1" "${sysctl_file}"

  # Apply sysctl settings live
  if command -v sysctl >/dev/null 2>&1; then
    if [[ $(id -u) -eq 0 ]]; then
      sysctl -p "${sysctl_file}" 2>/dev/null || sysctl --system 2>/dev/null || true
    else
      sudo sysctl -p "${sysctl_file}" 2>/dev/null || sudo sysctl --system 2>/dev/null || true
    fi
  fi

  echo "==> Node OS & sysctl tuning applied successfully."
}

tune_remote() {
  local host="$1"
  echo "============================================================"
  echo "Applying K3s node system tuning on remote host: ${host}"
  echo "============================================================"

  local ssh_opts=(-p "${SSH_PORT}" -o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=10")
  if [[ -n "${SSH_KEY}" ]]; then
    ssh_opts+=(-i "${SSH_KEY}")
  fi

  local remote_cmd="
    set -eu
    mkdir -p /etc/security/limits.d /etc/sysctl.d

    cat << 'EOF_LIMITS' > /etc/security/limits.d/99-k3s-nofile.conf
*                hard    nofile          1065536
*                soft    nofile          1065536
root             hard    nofile          1065536
root             soft    nofile          1065536
EOF_LIMITS

    cat << 'EOF_SYSCTL' > /etc/sysctl.d/99-k3s-tune.conf
fs.file-max = 1000000
fs.inotify.max_user_instances = 1024
fs.inotify.max_user_watches = 1048576
vm.max_map_count = 262144
net.core.somaxconn = 32768
net.ipv4.ip_forward = 1
EOF_SYSCTL

    sysctl -p /etc/sysctl.d/99-k3s-tune.conf 2>/dev/null || sysctl --system 2>/dev/null || true
    echo '==> Remote limits and sysctl applied successfully'
  "

  ssh "${ssh_opts[@]}" "${host}" "sudo bash -c '${remote_cmd}'"
}

if [[ -n "${TARGETS_FILE}" ]]; then
  if [[ ! -f "${TARGETS_FILE}" ]]; then
    echo "Error: Targets file '${TARGETS_FILE}' not found." >&2
    exit 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    target=$(echo "${line}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    [[ -z "${target}" || "${target}" =~ ^# ]] && continue
    tune_remote "${target}"
  done < "${TARGETS_FILE}"
elif [[ -n "${SSH_TARGET}" ]]; then
  tune_remote "${SSH_TARGET}"
else
  tune_local
fi
