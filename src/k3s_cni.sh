#!/usr/bin/env bash
# ==============================================================================
# src/k3s_cni.sh - Enterprise eBPF CNI Orchestrator (Cilium, Hubble, Tetragon)
# ==============================================================================
# Manages kernel eBPF packet routing, L3-L7 network policies, Hubble observability,
# and Tetragon runtime security enforcement for K3s clusters.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH}"

if [[ -f "${SCRIPT_DIR}/default.env" ]]; then
  set +u
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/default.env"
  set -u
fi

CILIUM_VERSION="${CILIUM_VERSION:-1.16.2}"
TETRAGON_VERSION="${TETRAGON_VERSION:-1.1.2}"

usage() {
  cat << 'EOF'
Usage: ./src/k3s_cni.sh <action> [options]

Enterprise eBPF CNI orchestrator (Cilium, Hubble & Tetragon) for K3s.

Actions:
  install [cni]                 Deploy CNI (cilium or flannel, default: cilium)
  status                        Audit active CNI, eBPF host routing, and sensors
  hubble [status|ui]            Manage Hubble network flow observability
  tetragon [status|logs]        Manage Tetragon real-time kernel security sensor
  uninstall                     Revert to standard flannel CNI

Options:
      --hubble                  Enable Hubble Relay and Hubble UI visualizer
      --tetragon                Deploy Tetragon eBPF kernel security sensor
      --kube-proxy-replacement  Replace kube-proxy with pure eBPF routing (default: true)
      --version <tag>           Cilium version tag (default: 1.16.2)
      --dry-run                 Simulate deployment without applying manifests
      --json                    Output status in structured JSON format
  -h, --help                    Show this help message

Examples:
  # Check active CNI and eBPF status:
  ./src/k3s_cni.sh status --json

  # Install Cilium with Hubble visualizer and Tetragon security:
  ./src/k3s_cni.sh install cilium --hubble --tetragon

  # Launch Hubble UI port-forward:
  ./src/k3s_cni.sh hubble ui
EOF
}

check_root() {
  if [[ $(id -u) -ne 0 ]]; then
    SUDO="sudo"
  else
    SUDO=""
  fi
}

detect_active_cni() {
  if ! command -v kubectl >/dev/null 2>&1; then
    echo "unknown"
    return 0
  fi

  if kubectl get daemonset -n kube-system cilium >/dev/null 2>&1; then
    echo "cilium-ebpf"
  elif kubectl get daemonset -n kube-system | grep -qi "flannel"; then
    echo "flannel-vxlan"
  elif kubectl get daemonset -n calico-system calico-node >/dev/null 2>&1; then
    echo "calico"
  else
    echo "flannel-default"
  fi
}

cmd_status() {
  local active_cni
  active_cni=$(detect_active_cni)

  local cilium_running=false
  local hubble_active=false
  local tetragon_active=false
  local ebpf_mode=false
  local nodes_count=0

  if command -v kubectl >/dev/null 2>&1; then
    nodes_count=$(kubectl get nodes --no-headers 2>/dev/null | wc -l || echo 0)
    if kubectl get pods -n kube-system -l k8s-app=cilium --no-headers 2>/dev/null | grep -q "Running"; then
      cilium_running=true
      ebpf_mode=true
    fi
    if kubectl get pods -n kube-system -l k8s-app=hubble-relay --no-headers 2>/dev/null | grep -q "Running"; then
      hubble_active=true
    fi
    if kubectl get pods -n kube-system -l app.kubernetes.io/name=tetragon --no-headers 2>/dev/null | grep -q "Running"; then
      tetragon_active=true
    fi
  fi

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "activeCni": "${active_cni}",
  "ebpfMode": ${ebpf_mode},
  "ciliumInstalled": ${cilium_running},
  "hubbleObservability": ${hubble_active},
  "tetragonSecurity": ${tetragon_active},
  "clusterNodes": ${nodes_count}
}
EOF
    return 0
  fi

  echo "============================================================"
  echo "Cluster Network & eBPF Security Status"
  echo "============================================================"
  echo "Active CNI Plugin : ${active_cni}"
  echo "eBPF Routing Mode : $( [[ "${ebpf_mode}" == "true" ]] && echo "ACTIVE (Kernel eBPF)" || echo "Standard iptables (Flannel)" )"
  echo "Cilium Engine     : $( [[ "${cilium_running}" == "true" ]] && echo "RUNNING" || echo "NOT DEPLOYED" )"
  echo "Hubble Visualizer : $( [[ "${hubble_active}" == "true" ]] && echo "ACTIVE" || echo "DISABLED" )"
  echo "Tetragon Sensor   : $( [[ "${tetragon_active}" == "true" ]] && echo "ACTIVE (Real-time security)" || echo "DISABLED" )"
  echo "Total Nodes       : ${nodes_count}"
  echo "============================================================"
}

cmd_install_cilium() {
  local version="${VERSION:-$CILIUM_VERSION}"
  local enable_hubble="${WITH_HUBBLE:-false}"
  local enable_tetragon="${WITH_TETRAGON:-false}"
  local dry_run="${DRY_RUN:-false}"

  echo "============================================================"
  echo "Deploying Cilium eBPF CNI & Security Suite"
  echo "============================================================"
  echo "Cilium Version    : ${version}"
  echo "Hubble UI/Relay   : ${enable_hubble}"
  echo "Tetragon Sensor   : ${enable_tetragon}"
  echo "Dry-Run Mode      : ${dry_run}"
  echo "============================================================"

  if [[ "${dry_run}" == "true" ]]; then
    echo "--- [Dry-Run] Planned Helm Flags ---"
    echo "helm repo add cilium https://helm.cilium.io/"
    echo "helm upgrade --install cilium cilium/cilium --version ${version} \\"
    echo "  --namespace kube-system \\"
    echo "  --set kubeProxyReplacement=true \\"
    echo "  --set k8sServiceHost=127.0.0.1 \\"
    echo "  --set k8sServicePort=6443 \\"
    if [[ "${enable_hubble}" == "true" ]]; then
      echo "  --set hubble.enabled=true --set hubble.relay.enabled=true --set hubble.ui.enabled=true \\"
    fi
    if [[ "${enable_tetragon}" == "true" ]]; then
      echo "--- [Dry-Run] Planned Tetragon Deployment ---"
      echo "helm upgrade --install tetragon cilium/tetragon --namespace kube-system"
    fi
    echo "✓ Dry-run completed."
    return 0
  fi

  if ! command -v helm >/dev/null 2>&1; then
    echo "Error: helm binary is required to deploy Cilium." >&2
    exit 1
  fi

  echo "==> Configuring Cilium Helm repository..."
  helm repo add cilium https://helm.cilium.io/ >/dev/null 2>&1 || true
  helm repo update cilium >/dev/null 2>&1 || true

  local helm_args=(
    upgrade --install cilium cilium/cilium
    --version "${version}"
    --namespace kube-system
    --set kubeProxyReplacement=true
    --set k8sServiceHost=127.0.0.1
    --set k8sServicePort=6443
  )

  if [[ "${enable_hubble}" == "true" ]]; then
    echo "==> Enabling Hubble Relay and UI visualizer..."
    helm_args+=(
      --set hubble.enabled=true
      --set hubble.relay.enabled=true
      --set hubble.ui.enabled=true
    )
  fi

  echo "==> Applying Cilium Helm deployment..."
  helm "${helm_args[@]}"

  if [[ "${enable_tetragon}" == "true" ]]; then
    echo "==> Deploying Tetragon real-time kernel eBPF security sensor..."
    helm upgrade --install tetragon cilium/tetragon \
      --namespace kube-system \
      --set tetragon.exportDirectory=/var/run/cilium/tetragon
  fi

  echo "✓ Cilium eBPF suite deployed successfully."
  echo "  Run './src/k3s_cni.sh status' to monitor pod readiness."
}

cmd_hubble() {
  local sub="${1:-status}"
  case "${sub}" in
    ui)
      if command -v cilium >/dev/null 2>&1; then
        echo "==> Opening Hubble UI via Cilium CLI..."
        cilium hubble ui
      else
        echo "==> Port-forwarding Hubble UI service on http://localhost:12000..."
        kubectl port-forward -n kube-system svc/hubble-ui 12000:80
      fi
      ;;
    status|*)
      cmd_status
      ;;
  esac
}

cmd_tetragon() {
  local sub="${1:-status}"
  case "${sub}" in
    logs|events)
      echo "==> Streaming live kernel eBPF security audit events from Tetragon..."
      kubectl logs -n kube-system -l app.kubernetes.io/name=tetragon -c tetragon --tail=50 -f
      ;;
    status|*)
      cmd_status
      ;;
  esac
}

ACTION="${1:-status}"
shift || true

CNI_TARGET="cilium"
VERSION="${CILIUM_VERSION}"
WITH_HUBBLE="false"
WITH_TETRAGON="false"
DRY_RUN="false"
JSON_OUTPUT="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    cilium|flannel)
      CNI_TARGET="$1"
      shift
      ;;
    --version)
      VERSION="$2"
      shift 2
      ;;
    --hubble)
      WITH_HUBBLE="true"
      shift
      ;;
    --tetragon)
      WITH_TETRAGON="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --json)
      JSON_OUTPUT="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      TARGET_SUB="$1"
      shift
      ;;
  esac
done

case "${ACTION}" in
  install)
    if [[ "${CNI_TARGET}" == "cilium" ]]; then
      cmd_install_cilium
    else
      echo "Notice: Standard Flannel is already built-in with K3s."
    fi
    ;;
  status)
    cmd_status
    ;;
  hubble)
    cmd_hubble "${TARGET_SUB:-status}"
    ;;
  tetragon)
    cmd_tetragon "${TARGET_SUB:-status}"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown action: ${ACTION}" >&2
    usage
    exit 1
    ;;
esac
