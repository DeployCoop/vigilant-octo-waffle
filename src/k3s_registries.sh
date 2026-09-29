#!/usr/bin/env bash
# ==============================================================================
# src/k3s_registries.sh - Container Registry Mirrors & Auth Provisioning for K3s
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_REGISTRIES=""
SSH_TARGET=""
SSH_PORT="22"
SSH_KEY=""
TARGETS_FILE=""
COPY_KUBECONFIG=false

usage() {
  cat << 'EOF'
Usage: ./src/k3s_registries.sh [options]

Installs registries.yaml mirror & credential configuration into /etc/rancher/k3s/
locally or across remote nodes, and optionally distributes kubeconfig.

Options:
  --file <path>                Path to custom registries.yaml source file
  --remote <user@host>         Deploy registries.yaml to remote host via SSH/SCP
  --targets <file>             Deploy to multiple hosts listed in targets file
  --ssh-port <port>            SSH port for remote connections (default: 22)
  --ssh-key <path>             Path to SSH private key
  --copy-kubeconfig            Also copy /etc/rancher/k3s/k3s.yaml to ~/.kube/config
  -h, --help                   Show this help message

Examples:
  # Configure locally:
  ./src/k3s_registries.sh

  # Configure on remote node:
  ./src/k3s_registries.sh --remote root@192.168.1.50

  # Deploy across all targets and sync kubeconfig:
  ./src/k3s_registries.sh --targets targets.txt --copy-kubeconfig
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      SOURCE_REGISTRIES="$2"
      shift 2
      ;;
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
    --copy-kubeconfig)
      COPY_KUBECONFIG=true
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

# Resolve registries.yaml content
resolve_registries_file() {
  if [[ -n "${SOURCE_REGISTRIES}" && -f "${SOURCE_REGISTRIES}" ]]; then
    echo "${SOURCE_REGISTRIES}"
    return 0
  fi

  local gen="${PROJECT_ROOT}/.secrets/registries.yaml"
  mkdir -p "${PROJECT_ROOT}/.secrets"

  # Only reuse existing if it does not contain empty or unexpanded auth credentials
  if [[ -f "${gen}" ]] && ! grep -qE 'username: (""|\${)' "${gen}" && ! grep -q 'auth:.*""' "${gen}"; then
    echo "${gen}"
    return 0
  fi

  if [[ -f "${PROJECT_ROOT}/src/registries.yaml" ]]; then
    echo "${PROJECT_ROOT}/src/registries.yaml"
    return 0
  fi

  # Generate clean registries.yaml
  cat << 'EOF_REG' > "${gen}"
mirrors:
  docker.io:
    endpoint:
      - "https://registry-1.docker.io"
EOF_REG

  # Only append auth config if non-empty credentials are provided
  if [[ -n "${DOCKER_USERNAME:-}" && -n "${DOCKER_PASSWORD:-}" ]]; then
    cat << EOF_AUTH >> "${gen}"
configs:
  "docker.io":
    auth:
      username: "${DOCKER_USERNAME}"
      password: "${DOCKER_PASSWORD}"
EOF_AUTH
  fi

  echo "${gen}"
}

REG_FILE=$(resolve_registries_file)

deploy_local() {
  echo "==> Configuring /etc/rancher/k3s/registries.yaml locally..."

  if [[ $(id -u) -eq 0 ]]; then
    mkdir -p /etc/rancher/k3s
    cp -v "${REG_FILE}" /etc/rancher/k3s/registries.yaml
    chmod 644 /etc/rancher/k3s/registries.yaml
  else
    sudo mkdir -p /etc/rancher/k3s
    sudo cp -v "${REG_FILE}" /etc/rancher/k3s/registries.yaml
    sudo chmod 644 /etc/rancher/k3s/registries.yaml
  fi

  if [[ "${COPY_KUBECONFIG}" == "true" ]]; then
    if [[ -f /etc/rancher/k3s/k3s.yaml ]]; then
      mkdir -p ~/.kube
      if [[ $(id -u) -eq 0 ]]; then
        cp -v /etc/rancher/k3s/k3s.yaml ~/.kube/config
      else
        sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
        sudo chown "$(id -u):$(id -g)" ~/.kube/config
      fi
      chmod 600 ~/.kube/config
      echo "  [OK] Copied k3s.yaml to ~/.kube/config"
    fi
  fi

  echo "==> Local registries.yaml setup complete."
}

deploy_remote() {
  local host="$1"
  echo "============================================================"
  echo "Deploying registries.yaml to remote host: ${host}"
  echo "============================================================"

  local ssh_opts=(-p "${SSH_PORT}" -o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=10")
  if [[ -n "${SSH_KEY}" ]]; then
    ssh_opts+=(-i "${SSH_KEY}")
  fi

  ssh "${ssh_opts[@]}" "${host}" "sudo mkdir -p /etc/rancher/k3s"
  scp -P "${SSH_PORT}" $(if [[ -n "${SSH_KEY}" ]]; then echo "-i ${SSH_KEY}"; fi) -o "StrictHostKeyChecking=accept-new" "${REG_FILE}" "${host}:/tmp/registries.yaml"
  ssh "${ssh_opts[@]}" "${host}" "sudo mv /tmp/registries.yaml /etc/rancher/k3s/registries.yaml && sudo chmod 644 /etc/rancher/k3s/registries.yaml"
  echo "  [OK] Deployed /etc/rancher/k3s/registries.yaml to ${host}"

  if [[ "${COPY_KUBECONFIG}" == "true" && -f /etc/rancher/k3s/k3s.yaml ]]; then
    scp -P "${SSH_PORT}" $(if [[ -n "${SSH_KEY}" ]]; then echo "-i ${SSH_KEY}"; fi) -o "StrictHostKeyChecking=accept-new" /etc/rancher/k3s/k3s.yaml "${host}:/tmp/k3s.yaml"
    ssh "${ssh_opts[@]}" "${host}" "mkdir -p ~/.kube && sudo mv /tmp/k3s.yaml ~/.kube/config && sudo chown \$(id -u):\$(id -g) ~/.kube/config && chmod 600 ~/.kube/config"
    echo "  [OK] Copied k3s.yaml to ~/.kube/config on ${host}"
  fi
}

if [[ -n "${TARGETS_FILE}" ]]; then
  if [[ ! -f "${TARGETS_FILE}" ]]; then
    echo "Error: Targets file '${TARGETS_FILE}' not found." >&2
    exit 1
  fi

  # Deploy locally first
  deploy_local

  while IFS= read -r line || [[ -n "$line" ]]; do
    target=$(echo "${line}" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
    [[ -z "${target}" || "${target}" =~ ^# ]] && continue
    deploy_remote "${target}"
  done < "${TARGETS_FILE}"
elif [[ -n "${SSH_TARGET}" ]]; then
  deploy_remote "${SSH_TARGET}"
else
  deploy_local
fi
