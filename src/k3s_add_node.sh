#!/usr/bin/env bash
# ==============================================================================
# src/k3s_add_node.sh - Dynamic K3s Multi-Node Join and Provisioning Utility
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Source environment variables if available
set +u
if [[ -f "${PROJECT_ROOT}/.env" ]]; then
  set -a && source "${PROJECT_ROOT}/.env" && set +a
fi
if [[ -f "${PROJECT_ROOT}/src/default.env" ]]; then
  set -a && source "${PROJECT_ROOT}/src/default.env" && set +a
fi
set -u

ROLE="agent"
SERVER_URL=""
TOKEN=""
NODE_NAME=""
NODE_IP=""
LABELS=""
TAINTS=""
OUTPUT_FILE=""
SSH_TARGET=""
SSH_PORT="22"
SSH_KEY=""
TARGETS_FILE=""
PARALLEL_JOBS=1
DO_TUNE=false
COPY_REGISTRIES=false
REGISTRIES_FILE=""
COPY_KUBECONFIG=false
DRY_RUN=false
PRINT_COMMAND=false

usage() {
  cat << 'EOF'
Usage: ./src/k3s_add_node.sh [options] [target1 target2 ...]

Add and provision worker (agent) or control-plane (server) nodes into K3s.
Supports single nodes, batch targets files, kernel/sysctl tuning, and registry setup.

Options:
  -r, --role <agent|server>        Node role to join (default: agent)
  -s, --server <url|ip>            K3s server URL or IP (default: auto-detected)
  -t, --token <token>              K3s join token (default: auto-detected from .secrets)
  -n, --node-name <name>           Custom Kubernetes node name for the joining machine
  -i, --node-ip <ip>               Node IP address to advertise for the joining machine
  -l, --labels <k=v,k2=v2>         Node labels to assign (e.g. env=prod,role=worker)
      --taints <k=v:effect,...>    Node taints to assign (e.g. dedicated=gpu:NoSchedule)
  -o, --output <file>              Save standalone join script to file path
      --ssh <user@host>            Remotely provision target machine over SSH
      --targets <file>             Batch provision multiple nodes listed in targets file
  -j, --parallel <N>               Run up to N parallel remote join tasks (default: 1)
      --tune                       Provision kernel modules & system limits before joining
      --registries, --copy-registries
                                   Copy registries.yaml to /etc/rancher/k3s/ on target
      --registries-file <path>     Custom registries.yaml source file
      --copy-kubeconfig            Copy /etc/rancher/k3s/k3s.yaml to ~/.kube/config
      --ssh-port <port>            SSH port for remote provisioning (default: 22)
      --ssh-key <path>             Path to SSH private key identity file
      --get-token                  Print active cluster join token and exit
      --get-url                    Print active cluster server URL and exit
      --print-command              Print only the single-line curl join command
      --dry-run                    Simulate actions without writing files or running SSH
  -h, --help                       Show this help message and exit

Examples:
  # 1. Print worker join command:
  ./src/k3s_add_node.sh --role agent

  # 2. Save worker join script to .secrets/k3s_join_agent.sh:
  ./src/k3s_add_node.sh --role agent -o ./.secrets/k3s_join_agent.sh

  # 3. Add remote worker node with full tuning and registry mirrors:
  ./src/k3s_add_node.sh --role agent --ssh root@192.168.1.50 --tune --copy-registries

  # 4. Batch join all worker nodes listed in targets file in parallel:
  ./src/k3s_add_node.sh --role agent --targets targets.txt --tune --copy-registries -j 10
EOF
}

# Auto-detect K3s server URL
resolve_server_url() {
  if [[ -n "${SERVER_URL}" ]]; then
    if [[ ! "${SERVER_URL}" =~ ^https?:// ]]; then
      echo "https://${SERVER_URL}:6443"
    else
      echo "${SERVER_URL}"
    fi
    return 0
  fi

  if [[ -f "${PROJECT_ROOT}/server_url" ]]; then
    echo "https://$(cat "${PROJECT_ROOT}/server_url"):6443"
    return 0
  fi

  if [[ -n "${THIS_K3S_SERVER_IP:-}" ]]; then
    echo "https://${THIS_K3S_SERVER_IP}:6443"
    return 0
  fi

  if [[ -f "${PROJECT_ROOT}/.secrets/k3s_env" ]]; then
    local env_url
    env_url=$(grep "^export K3S_URL=" "${PROJECT_ROOT}/.secrets/k3s_env" 2>/dev/null | cut -d"'" -f2 || true)
    if [[ -n "${env_url}" ]]; then
      echo "${env_url}"
      return 0
    fi
  fi

  local detected_ip
  detected_ip=$(curl -s --connect-timeout 2 icanhazip.com 2>/dev/null || ip route get 1.1.1.1 2>/dev/null | awk '{print $7}' || hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
  echo "https://${detected_ip}:6443"
}

# Auto-detect K3s cluster join token
resolve_token() {
  if [[ -n "${TOKEN}" ]]; then
    echo "${TOKEN}"
    return 0
  fi

  if [[ -n "${THIS_K3S_NODE_TOKEN:-}" ]]; then
    echo "${THIS_K3S_NODE_TOKEN}"
    return 0
  fi

  if [[ -f "${PROJECT_ROOT}/.secrets/k3s_token" ]]; then
    local tok
    tok=$(cat "${PROJECT_ROOT}/.secrets/k3s_token" | tr -d '\r\n')
    if [[ -n "${tok}" ]]; then
      echo "${tok}"
      return 0
    fi
  fi

  if [[ -f "${PROJECT_ROOT}/.secrets/k3s_env" ]]; then
    local env_tok
    env_tok=$(grep "^export K3S_TOKEN=" "${PROJECT_ROOT}/.secrets/k3s_env" 2>/dev/null | cut -d"'" -f2 || true)
    if [[ -n "${env_tok}" ]]; then
      echo "${env_tok}"
      return 0
    fi
  fi

  if [[ -f /var/lib/rancher/k3s/server/node-token ]]; then
    cat /var/lib/rancher/k3s/server/node-token | tr -d '\r\n'
    return 0
  fi

  echo ""
}

TARGETS_LIST=()

# Parse command line flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    -r|--role)
      ROLE="$2"
      shift 2
      ;;
    -s|--server)
      SERVER_URL="$2"
      shift 2
      ;;
    -t|--token)
      TOKEN="$2"
      shift 2
      ;;
    -n|--node-name)
      NODE_NAME="$2"
      shift 2
      ;;
    -i|--node-ip)
      NODE_IP="$2"
      shift 2
      ;;
    -l|--labels)
      LABELS="$2"
      shift 2
      ;;
    --taints)
      TAINTS="$2"
      shift 2
      ;;
    -o|--output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    --ssh)
      SSH_TARGET="$2"
      shift 2
      ;;
    --targets)
      TARGETS_FILE="$2"
      shift 2
      ;;
    -j|--parallel)
      PARALLEL_JOBS="$2"
      shift 2
      ;;
    --tune)
      DO_TUNE=true
      shift
      ;;
    --registries|--copy-registries)
      COPY_REGISTRIES=true
      shift
      ;;
    --registries-file)
      COPY_REGISTRIES=true
      REGISTRIES_FILE="$2"
      shift 2
      ;;
    --copy-kubeconfig)
      COPY_KUBECONFIG=true
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
    --get-token)
      RESOLVED_TOKEN=$(resolve_token)
      if [[ -z "${RESOLVED_TOKEN}" ]]; then
        echo "Error: K3s node token not found in .secrets or system" >&2
        exit 1
      fi
      echo "${RESOLVED_TOKEN}"
      exit 0
      ;;
    --get-url)
      resolve_server_url
      exit 0
      ;;
    --print-command)
      PRINT_COMMAND=true
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

if [[ "${ROLE}" != "agent" && "${ROLE}" != "server" ]]; then
  echo "Error: --role must be either 'agent' (worker) or 'server' (control-plane)" >&2
  exit 1
fi

RESOLVED_SERVER_URL=$(resolve_server_url)
RESOLVED_TOKEN=$(resolve_token)

if [[ -z "${RESOLVED_TOKEN}" ]]; then
  echo "Error: Could not locate K3s node join token." >&2
  echo "Please specify --token <token>, create .secrets/k3s_token, or run src/install_k3s.sh first." >&2
  exit 1
fi

# Build arguments for k3s agent/server
EXTRA_ARGS=()
if [[ -n "${NODE_NAME}" ]]; then
  EXTRA_ARGS+=("--node-name" "${NODE_NAME}")
fi
if [[ -n "${NODE_IP}" ]]; then
  EXTRA_ARGS+=("--node-ip" "${NODE_IP}")
fi
if [[ -n "${LABELS}" ]]; then
  IFS=',' read -ra LABEL_ARRAY <<< "${LABELS}"
  for lbl in "${LABEL_ARRAY[@]}"; do
    if [[ -n "${lbl}" ]]; then
      EXTRA_ARGS+=("--node-label" "${lbl}")
    fi
  done
fi
if [[ -n "${TAINTS}" ]]; then
  IFS=',' read -ra TAINT_ARRAY <<< "${TAINTS}"
  for tnt in "${TAINT_ARRAY[@]}"; do
    if [[ -n "${tnt}" ]]; then
      EXTRA_ARGS+=("--node-taint" "${tnt}")
    fi
  done
fi

ARGS_STRING="${EXTRA_ARGS[*]}"

# Generate one-line curl command
if [[ "${ROLE}" == "agent" ]]; then
  ONE_LINER="curl -sfL https://get.k3s.io | K3S_URL=\"${RESOLVED_SERVER_URL}\" K3S_TOKEN=\"${RESOLVED_TOKEN}\" sh -s - agent ${ARGS_STRING}"
else
  ONE_LINER="curl -sfL https://get.k3s.io | K3S_URL=\"${RESOLVED_SERVER_URL}\" K3S_TOKEN=\"${RESOLVED_TOKEN}\" sh -s - server ${ARGS_STRING}"
fi

# Mode: Print command only
if [[ "${PRINT_COMMAND}" == "true" ]]; then
  echo "${ONE_LINER}"
  exit 0
fi

# Build full shell script
generate_script() {
  cat << SCRIPT_EOF
#!/usr/bin/env bash
# ==============================================================================
# K3s Node Join Script (${ROLE^^})
# Generated on: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
# Cluster Server: ${RESOLVED_SERVER_URL}
# ==============================================================================
set -euo pipefail

export K3S_URL="${RESOLVED_SERVER_URL}"
export K3S_TOKEN="${RESOLVED_TOKEN}"

# Verify root privileges
if [[ \$(id -u) -ne 0 ]]; then
  echo "Error: K3s node installation must be run as root (or via sudo)." >&2
  exit 1
fi

echo "==> Joining K3s cluster at \${K3S_URL} as ${ROLE} node..."

# Check connectivity to K3s control plane
SERVER_HOST=\$(echo "\${K3S_URL}" | sed -e 's|^[^/]*//||' -e 's|:.*||')
SERVER_PORT=\$(echo "\${K3S_URL}" | sed -e 's|^[^/]*//||' -e 's|.*:||' -e 's|/.*||')
if [[ -z "\${SERVER_PORT}" || "\${SERVER_PORT}" == "\${SERVER_HOST}" ]]; then
  SERVER_PORT="6443"
fi

if command -v nc >/dev/null 2>&1; then
  if ! nc -z -w 3 "\${SERVER_HOST}" "\${SERVER_PORT}" 2>/dev/null; then
    echo "Warning: Unable to reach \${SERVER_HOST}:\${SERVER_PORT}. Ensure firewall allows port \${SERVER_PORT}." >&2
  fi
fi

# Download and execute K3s installer
curl -sfL https://get.k3s.io | sh -s - ${ROLE} ${ARGS_STRING}

echo "==> K3s node join completed successfully!"
SCRIPT_EOF
}

# Mode: Output script to file
if [[ -n "${OUTPUT_FILE}" ]]; then
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[DRY RUN] Would write ${ROLE} join script to: ${OUTPUT_FILE}"
    generate_script
  else
    mkdir -p "$(dirname "${OUTPUT_FILE}")"
    generate_script > "${OUTPUT_FILE}"
    chmod 700 "${OUTPUT_FILE}"
    echo "==> Generated K3s ${ROLE} join script saved to: ${OUTPUT_FILE}"
  fi
  exit 0
fi

# Ingest targets from file if provided
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

# Provision a single target over SSH
provision_single_node() {
  local target_host="$1"
  local ssh_opts=(-p "${SSH_PORT}" -o "StrictHostKeyChecking=accept-new" -o "ConnectTimeout=10")
  if [[ -n "${SSH_KEY}" ]]; then
    ssh_opts+=(-i "${SSH_KEY}")
  fi

  echo "============================================================"
  echo "Provisioning K3s ${ROLE} node on: ${target_host}"
  echo "Server URL  : ${RESOLVED_SERVER_URL}"
  echo "SSH Port    : ${SSH_PORT}"
  if [[ -n "${NODE_NAME}" ]]; then echo "Node Name   : ${NODE_NAME}"; fi
  echo "============================================================"

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[DRY RUN] Would tune, copy registries, and join ${target_host} via SSH:"
    generate_script
    return 0
  fi

  echo "==> Testing SSH connection to ${target_host}..."
  if ! ssh "${ssh_opts[@]}" "${target_host}" "echo 'SSH connection verified'" >/dev/null 2>&1; then
    echo "Error: Failed to connect to ${target_host} over SSH. Please check credentials and host." >&2
    return 1
  fi

  # Step 1: Kernel module and limits tuning
  if [[ "${DO_TUNE}" == "true" ]]; then
    echo "==> [${target_host}] Tuning kernel modules (nvme_*) and system limits (nofile/inotify)..."
    local kmod_cmd=("${SCRIPT_DIR}/k3s_kmod.sh" "--remote" "${target_host}" "--ssh-port" "${SSH_PORT}")
    if [[ -n "${SSH_KEY}" ]]; then kmod_cmd+=("--ssh-key" "${SSH_KEY}"); fi
    "${kmod_cmd[@]}" || echo "Warning: [${target_host}] Kernel module provisioning reported non-fatal warning." >&2

    local tune_cmd=("${SCRIPT_DIR}/k3s_tune.sh" "--remote" "${target_host}" "--ssh-port" "${SSH_PORT}")
    if [[ -n "${SSH_KEY}" ]]; then tune_cmd+=("--ssh-key" "${SSH_KEY}"); fi
    "${tune_cmd[@]}" || echo "Warning: [${target_host}] System tuning reported non-fatal warning." >&2
  fi

  # Step 2: Registries mirrors & credentials distribution
  if [[ "${COPY_REGISTRIES}" == "true" ]]; then
    echo "==> [${target_host}] Deploying registries.yaml configuration..."
    local reg_cmd=("${SCRIPT_DIR}/k3s_registries.sh" "--remote" "${target_host}" "--ssh-port" "${SSH_PORT}")
    if [[ -n "${SSH_KEY}" ]]; then reg_cmd+=("--ssh-key" "${SSH_KEY}"); fi
    if [[ -n "${REGISTRIES_FILE}" ]]; then reg_cmd+=("--file" "${REGISTRIES_FILE}"); fi
    if [[ "${COPY_KUBECONFIG}" == "true" ]]; then reg_cmd+=("--copy-kubeconfig"); fi
    "${reg_cmd[@]}" || echo "Warning: [${target_host}] Registries deployment reported non-fatal warning." >&2
  fi

  # Step 3: Execute K3s Join
  echo "==> [${target_host}] Executing K3s ${ROLE} join installation..."
  generate_script | ssh "${ssh_opts[@]}" "${target_host}" "sudo bash -s"

  echo "==> [${target_host}] Node successfully provisioned and joined to K3s cluster!"
}

# Mode: Multi-node Batch Provisioning (if targets specified)
if [[ ${#TARGETS_LIST[@]} -gt 0 ]]; then
  echo "============================================================"
  echo "Batch Provisioning ${#TARGETS_LIST[@]} K3s ${ROLE} node(s)"
  echo "Parallelism : ${PARALLEL_JOBS}"
  echo "Tuning      : ${DO_TUNE}"
  echo "Registries  : ${COPY_REGISTRIES}"
  echo "============================================================"

  # Helper command array builder for parallel / sequential execution
  run_single_target() {
    local t="$1"
    local run_args=("--role" "${ROLE}" "--server" "${RESOLVED_SERVER_URL}" "--token" "${RESOLVED_TOKEN}" "--ssh" "${t}" "--ssh-port" "${SSH_PORT}")
    if [[ -n "${SSH_KEY}" ]]; then run_args+=("--ssh-key" "${SSH_KEY}"); fi
    if [[ "${DO_TUNE}" == "true" ]]; then run_args+=("--tune"); fi
    if [[ "${COPY_REGISTRIES}" == "true" ]]; then run_args+=("--copy-registries"); fi
    if [[ -n "${REGISTRIES_FILE}" ]]; then run_args+=("--registries-file" "${REGISTRIES_FILE}"); fi
    if [[ "${COPY_KUBECONFIG}" == "true" ]]; then run_args+=("--copy-kubeconfig"); fi
    if [[ "${DRY_RUN}" == "true" ]]; then run_args+=("--dry-run"); fi
    "${SCRIPT_DIR}/k3s_add_node.sh" "${run_args[@]}"
  }
  export -f run_single_target
  export SCRIPT_DIR ROLE RESOLVED_SERVER_URL RESOLVED_TOKEN SSH_PORT SSH_KEY DO_TUNE COPY_REGISTRIES REGISTRIES_FILE COPY_KUBECONFIG DRY_RUN

  if [[ ${PARALLEL_JOBS} -gt 1 ]] && command -v parallel >/dev/null 2>&1; then
    printf "%s\n" "${TARGETS_LIST[@]}" | parallel -j "${PARALLEL_JOBS}" run_single_target {}
  else
    for target in "${TARGETS_LIST[@]}"; do
      run_single_target "${target}"
    done
  fi

  echo "==> Checking cluster nodes..."
  if command -v kubectl >/dev/null 2>&1; then
    kubectl get nodes -o wide || true
  fi
  exit 0
fi

# Mode: Single Remote SSH Provisioning
if [[ -n "${SSH_TARGET}" ]]; then
  provision_single_node "${SSH_TARGET}"

  echo "==> Checking cluster nodes..."
  if command -v kubectl >/dev/null 2>&1; then
    kubectl get nodes -o wide || true
  fi
  exit 0
fi

# Default: Display interactive summary and join instructions
echo "============================================================"
echo "K3s Multi-Node Join Information"
echo "============================================================"
echo "Role        : ${ROLE} ($(if [[ "${ROLE}" == "agent" ]]; then echo "worker workload node"; else echo "HA control-plane server"; fi))"
echo "Server URL  : ${RESOLVED_SERVER_URL}"
echo "Join Token  : ${RESOLVED_TOKEN}"
echo ""
echo "--- Single-Line Curl Join Command ---"
echo "${ONE_LINER}"
echo ""
echo "--- How to Add Nodes ---"
echo "1. Manual Execution on Target Node:"
echo "   Copy and run the curl command above as root on the joining machine."
echo ""
echo "2. Save to Standalone Script:"
echo "   ./src/k3s_add_node.sh --role ${ROLE} -o ./.secrets/k3s_join_${ROLE}.sh"
echo ""
echo "3. Automated Remote SSH Provisioning:"
echo "   ./src/k3s_add_node.sh --role ${ROLE} --ssh user@remote-ip --tune --copy-registries"
echo ""
echo "4. Batch Multi-Node Provisioning:"
echo "   ./src/k3s_add_node.sh --role ${ROLE} --targets targets.txt --tune --copy-registries -j 10"
echo "============================================================"
