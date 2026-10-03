#!/usr/bin/env bash
# ==============================================================================
# src/k3s_vip.sh - Automated Control-Plane Floating Virtual IP (kube-vip)
# ==============================================================================
# Orchestrates zero-cloud-dependency floating VIP failover across all K3s
# control-plane servers using kube-vip in ARP or BGP mode with leader election.
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH}"

# Source environment for defaults if present
if [[ -f "${SCRIPT_DIR}/default.env" ]]; then
  set +u
  # shellcheck source=/dev/null
  source "${SCRIPT_DIR}/default.env"
  set -u
fi

K3S_MANIFEST_DIR="/var/lib/rancher/k3s/server/manifests"
DEFAULT_VIP="${THIS_K3S_HA_VIP:-192.168.1.100}"
KUBE_VIP_VERSION="v0.8.9"

usage() {
  cat << 'EOF'
Usage: ./src/k3s_vip.sh <action> [options]

Automated Floating Virtual IP (kube-vip) orchestrator for K3s HA control planes.

Actions:
  setup                         Deploy kube-vip daemonset and RBAC manifests
  status                        Check VIP assignment, leader election, and pods
  teardown                      Remove kube-vip manifests and release VIP
  generate                      Generate manifests to stdout or target file

Options:
      --vip <ip>                Floating Virtual IP address (default: $THIS_K3S_HA_VIP or 192.168.1.100)
      --interface <iface>       Network interface to bind VIP (default: default route interface)
      --mode <arp|bgp>          Routing mode: 'arp' for L2 local network, 'bgp' for routers (default: arp)
      --version <tag>           kube-vip container image version (default: v0.8.9)
      --dry-run                 Output generated manifests without applying to filesystem
      --json                    Output status in structured JSON format
  -h, --help                    Show this help message

Examples:
  # Setup VIP on default interface:
  ./src/k3s_vip.sh setup --vip 192.168.1.100

  # Check VIP election status:
  ./src/k3s_vip.sh status --json

  # Teardown:
  ./src/k3s_vip.sh teardown
EOF
}

check_root() {
  if [[ $(id -u) -ne 0 ]]; then
    SUDO="sudo"
  else
    SUDO=""
  fi
}

detect_interface() {
  local iface
  iface=$(ip route show default 2>/dev/null | awk '{print $5}' | head -n1 || true)
  if [[ -z "${iface}" ]]; then
    iface=$(ip link show 2>/dev/null | awk -F: '$0 !~ "lo|vir|docker|cni|flannel" {print $2; exit}' | tr -d ' ' || true)
  fi
  echo "${iface:-eth0}"
}

generate_rbac() {
  cat << 'EOF'
apiVersion: v1
kind: ServiceAccount
metadata:
  name: kube-vip
  namespace: kube-system
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  annotations:
    rbac.authorization.kubernetes.io/autoupdate: "true"
  name: kube-vip-role
rules:
  - apiGroups: [""]
    resources: ["services", "services/status", "nodes", "endpoints"]
    verbs: ["list", "get", "watch", "update"]
  - apiGroups: ["coordination.k8s.io"]
    resources: ["leases"]
    verbs: ["list", "get", "watch", "update", "create"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: kube-vip-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: kube-vip-role
subjects:
  - kind: ServiceAccount
    name: kube-vip
    namespace: kube-system
EOF
}

generate_daemonset() {
  local vip="$1"
  local iface="$2"
  local mode="$3"
  local version="$4"

  local is_arp="true"
  if [[ "${mode}" == "bgp" ]]; then
    is_arp="false"
  fi

  cat << EOF
apiVersion: apps/v1
kind: DaemonSet
metadata:
  name: kube-vip-ds
  namespace: kube-system
spec:
  selector:
    matchLabels:
      name: kube-vip-ds
  template:
    metadata:
      labels:
        name: kube-vip-ds
    spec:
      affinity:
        nodeAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
            nodeSelectorTerms:
              - matchExpressions:
                  - key: node-role.kubernetes.io/master
                    operator: Exists
              - matchExpressions:
                  - key: node-role.kubernetes.io/control-plane
                    operator: Exists
      containers:
        - name: kube-vip
          image: ghcr.io/kube-vip/kube-vip:${version}
          imagePullPolicy: IfNotPresent
          args:
            - manager
          env:
            - name: vip_arp
              value: "${is_arp}"
            - name: port
              value: "6443"
            - name: vip_interface
              value: "${iface}"
            - name: vip_cidr
              value: "32"
            - name: cp_enable
              value: "true"
            - name: cp_namespace
              value: "kube-system"
            - name: vip_ddns
              value: "false"
            - name: vip_leaderelection
              value: "true"
            - name: vip_leaseduration
              value: "5"
            - name: vip_renewdeadline
              value: "3"
            - name: vip_retryperiod
              value: "1"
            - name: address
              value: "${vip}"
            - name: prometheus_server
              value: ":2112"
          securityContext:
            capabilities:
              add:
                - NET_ADMIN
                - NET_RAW
      hostNetwork: true
      serviceAccountName: kube-vip
      tolerations:
        - effect: NoSchedule
          operator: Exists
        - effect: NoExecute
          operator: Exists
EOF
}

cmd_setup() {
  local vip="${VIP:-$DEFAULT_VIP}"
  local iface="${INTERFACE:-$(detect_interface)}"
  local mode="${MODE:-arp}"
  local version="${VERSION:-$KUBE_VIP_VERSION}"

  echo "============================================================"
  echo "Deploying kube-vip Floating Virtual IP Controller"
  echo "============================================================"
  echo "Virtual IP (VIP)   : ${vip}"
  echo "Network Interface  : ${iface}"
  echo "Routing Mode       : ${mode}"
  echo "kube-vip Version   : ${version}"
  echo "Manifest Directory : ${K3S_MANIFEST_DIR}"
  echo "============================================================"

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "--- [Dry-Run] RBAC Manifest ---"
    generate_rbac
    echo "--- [Dry-Run] DaemonSet Manifest ---"
    generate_daemonset "${vip}" "${iface}" "${mode}" "${version}"
    echo "✓ Dry-run completed."
    return 0
  fi

  check_root

  if [[ ! -d "${K3S_MANIFEST_DIR}" ]]; then
    echo "Creating manifest directory: ${K3S_MANIFEST_DIR}..."
    ${SUDO} mkdir -p "${K3S_MANIFEST_DIR}"
  fi

  local rbac_file="${K3S_MANIFEST_DIR}/kube-vip-rbac.yaml"
  local ds_file="${K3S_MANIFEST_DIR}/kube-vip.yaml"

  echo "Writing RBAC to ${rbac_file}..."
  generate_rbac | ${SUDO} tee "${rbac_file}" >/dev/null

  echo "Writing DaemonSet to ${ds_file}..."
  generate_daemonset "${vip}" "${iface}" "${mode}" "${version}" | ${SUDO} tee "${ds_file}" >/dev/null

  echo "✓ Manifests successfully deployed into K3s auto-deploy directory."
  echo "  K3s will automatically apply and reconcile kube-vip within 10-15 seconds."
  echo "  To verify: ./src/k3s_vip.sh status"
}

cmd_status() {
  local vip="${VIP:-$DEFAULT_VIP}"
  local iface="${INTERFACE:-$(detect_interface)}"

  local local_bound=false
  if ip addr show 2>/dev/null | grep -qw "${vip}"; then
    local_bound=true
  fi

  local manifest_present=false
  if [[ -f "${K3S_MANIFEST_DIR}/kube-vip.yaml" ]]; then
    manifest_present=true
  fi

  local pods_running=0
  local leader="unknown"
  local reachable=false

  if command -v kubectl >/dev/null 2>&1; then
    pods_running=$(kubectl get pods -n kube-system -l name=kube-vip-ds --no-headers 2>/dev/null | grep -c "Running" || true)
    leader=$(kubectl get lease -n kube-system plndr-cp-lock -o jsonpath='{.spec.holderIdentity}' 2>/dev/null || echo "not-elected")
  fi

  if ping -c 1 -W 1 "${vip}" >/dev/null 2>&1; then
    reachable=true
  fi

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "vip": "${vip}",
  "interface": "${iface}",
  "localBound": ${local_bound},
  "reachable": ${reachable},
  "manifestDeployed": ${manifest_present},
  "runningPods": ${pods_running},
  "currentLeader": "${leader}"
}
EOF
    return 0
  fi

  echo "============================================================"
  echo "K3s Floating Virtual IP (kube-vip) Status"
  echo "============================================================"
  echo "Target VIP         : ${vip}"
  echo "Primary Interface  : ${iface}"
  echo "Locally Bound      : $( [[ "${local_bound}" == "true" ]] && echo "YES (This node hosts the VIP)" || echo "NO (Passive or peer node)" )"
  echo "Network Reachable  : $( [[ "${reachable}" == "true" ]] && echo "YES" || echo "NO" )"
  echo "Manifest Active    : $( [[ "${manifest_present}" == "true" ]] && echo "YES (/var/lib/rancher/k3s/server/manifests/kube-vip.yaml)" || echo "NO" )"
  echo "Running kube-vip Pods: ${pods_running}"
  echo "Current VIP Leader : ${leader}"
  echo "============================================================"
}

cmd_teardown() {
  echo "==> Tearing down kube-vip Floating VIP..."
  check_root

  if [[ -f "${K3S_MANIFEST_DIR}/kube-vip.yaml" ]]; then
    echo "Removing ${K3S_MANIFEST_DIR}/kube-vip.yaml..."
    ${SUDO} rm -f "${K3S_MANIFEST_DIR}/kube-vip.yaml"
  fi

  if [[ -f "${K3S_MANIFEST_DIR}/kube-vip-rbac.yaml" ]]; then
    echo "Removing ${K3S_MANIFEST_DIR}/kube-vip-rbac.yaml..."
    ${SUDO} rm -f "${K3S_MANIFEST_DIR}/kube-vip-rbac.yaml"
  fi

  if command -v kubectl >/dev/null 2>&1; then
    echo "Cleaning up kube-system DaemonSet and leases..."
    kubectl delete daemonset kube-vip-ds -n kube-system --ignore-not-found=true >/dev/null 2>&1 || true
    kubectl delete lease plndr-cp-lock -n kube-system --ignore-not-found=true >/dev/null 2>&1 || true
  fi

  echo "✓ kube-vip successfully decommissioned."
}

# Command line parsing
ACTION="${1:-status}"
shift || true

VIP=""
INTERFACE=""
MODE="arp"
VERSION="${KUBE_VIP_VERSION}"
DRY_RUN="false"
JSON_OUTPUT="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vip)
      VIP="$2"
      shift 2
      ;;
    --interface)
      INTERFACE="$2"
      shift 2
      ;;
    --mode)
      MODE="$2"
      shift 2
      ;;
    --version)
      VERSION="$2"
      shift 2
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
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

case "${ACTION}" in
  setup)
    cmd_setup
    ;;
  status)
    cmd_status
    ;;
  teardown)
    cmd_teardown
    ;;
  generate)
    DRY_RUN="true"
    cmd_setup
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
