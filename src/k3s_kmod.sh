#!/usr/bin/env bash
# ==============================================================================
# src/k3s_kmod.sh - Kernel Module Provisioning for K3s & Storage (NVMe-oF / Ceph)
# ==============================================================================
set -euo pipefail

DEFAULT_MODULES=(
  "nvme_core"
  "nvme_fabrics"
  "nvme_tcp"
  "nvme_auth"
  "nvme_keyring"
)

SSH_TARGET=""
SSH_PORT="22"
SSH_KEY=""
TARGETS_FILE=""

usage() {
  cat << 'EOF'
Usage: ./src/k3s_kmod.sh [options] [module1 module2 ...]

Loads and persists required kernel modules for K3s, container storage, and NVMe-oF.

Options:
  --remote <user@host>         Load modules on a remote host via SSH
  --targets <file>             Load modules on multiple hosts listed in a targets file
  --ssh-port <port>            SSH port for remote connections (default: 22)
  --ssh-key <path>             Path to SSH private key
  -h, --help                   Show this help message

Default modules if none specified:
  nvme_core nvme_fabrics nvme_tcp nvme_auth nvme_keyring

Examples:
  # Load locally:
  ./src/k3s_kmod.sh

  # Load custom modules locally:
  ./src/k3s_kmod.sh br_netfilter overlay nvme_tcp

  # Load remotely on worker node:
  ./src/k3s_kmod.sh --remote root@192.168.1.50

  # Load across all cluster targets:
  ./src/k3s_kmod.sh --targets targets.txt
EOF
}

MODULES_TO_LOAD=()

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
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      MODULES_TO_LOAD+=("$1")
      shift
      ;;
  esac
done

if [[ ${#MODULES_TO_LOAD[@]} -eq 0 ]]; then
  MODULES_TO_LOAD=("${DEFAULT_MODULES[@]}")
fi

load_module_local() {
  local mod="$1"
  echo "==> Checking kernel module: ${mod}"

  if lsmod 2>/dev/null | grep -qw "^${mod}"; then
    echo "  [OK] Module ${mod} is already loaded."
  else
    if command -v modprobe >/dev/null 2>&1; then
      if [[ $(id -u) -eq 0 ]]; then
        modprobe "${mod}" 2>/dev/null || echo "  [WARN] Failed to load ${mod} (may be built-in or unavailable in this kernel)."
      else
        sudo modprobe "${mod}" 2>/dev/null || echo "  [WARN] Failed to load ${mod} via sudo."
      fi
    else
      echo "  [WARN] modprobe command not found."
    fi
  fi

  # Persist for auto-load on boot
  local conf_file="/etc/modules-load.d/k3s-storage.conf"
  if [[ $(id -u) -eq 0 ]]; then
    mkdir -p /etc/modules-load.d
    if [[ ! -f "${conf_file}" ]] || ! grep -qw "^${mod}" "${conf_file}" 2>/dev/null; then
      echo "${mod}" >> "${conf_file}"
      echo "  [PERSISTED] Added ${mod} to ${conf_file}"
    fi
  else
    if sudo test -d /etc/modules-load.d 2>/dev/null || sudo mkdir -p /etc/modules-load.d 2>/dev/null; then
      if ! sudo grep -qw "^${mod}" "${conf_file}" 2>/dev/null; then
        echo "${mod}" | sudo tee -a "${conf_file}" >/dev/null
        echo "  [PERSISTED] Added ${mod} to ${conf_file} via sudo"
      fi
    fi
  fi
}

load_local_all() {
  for mod in "${MODULES_TO_LOAD[@]}"; do
    load_module_local "${mod}"
  done
  echo "==> Kernel module configuration complete."
}

load_remote_host() {
  local host="$1"
  echo "============================================================"
  echo "Configuring kernel modules on remote host: ${host}"
  echo "============================================================"

  local ssh_opts=(-p "${SSH_PORT}" -o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=10")
  if [[ -n "${SSH_KEY}" ]]; then
    ssh_opts+=(-i "${SSH_KEY}")
  fi

  local mods_arg="${MODULES_TO_LOAD[*]}"
  local remote_cmd="
    set -eu
    MODULES=(${mods_arg})
    for mod in \"\${MODULES[@]}\"; do
      if lsmod 2>/dev/null | grep -qw \"^\${mod}\"; then
        echo \"  [OK] \${mod} already loaded\"
      else
        modprobe \"\${mod}\" 2>/dev/null || echo \"  [WARN] Could not modprobe \${mod}\"
      fi
      mkdir -p /etc/modules-load.d
      if ! grep -qw \"^\${mod}\" /etc/modules-load.d/k3s-storage.conf 2>/dev/null; then
        echo \"\${mod}\" >> /etc/modules-load.d/k3s-storage.conf
        echo \"  [PERSISTED] \${mod} persisted\"
      fi
    done
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
    load_remote_host "${target}"
  done < "${TARGETS_FILE}"
elif [[ -n "${SSH_TARGET}" ]]; then
  load_remote_host "${SSH_TARGET}"
else
  load_local_all
fi
