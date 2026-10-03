#!/usr/bin/env bash
# ==============================================================================
# src/k3s_certs.sh - K3s TLS Certificate Health Inspection & Automated Rotation
# ==============================================================================
# Inspects expiration dates for all cluster TLS certificates (apiserver, etcd,
# clients, CAs) and performs safe, non-disruptive certificate rotation.
# ==============================================================================
set -euo pipefail

export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH}"

TLS_DIR="/var/lib/rancher/k3s/server/tls"

usage() {
  cat << 'EOF'
Usage: ./src/k3s_certs.sh <action> [options]

Production TLS certificate lifecycle management for K3s.

Actions:
  check                       Inspect all TLS certificates and print expiration schedule
  rotate                      Rotate all K3s internal certificates and restart service
  rotate-service <service>    Rotate certificate for specific service (e.g. k3s-server, k3s-agent)

Options:
      --json                  Output certificate inspection in structured JSON format
      --warn-days <N>         Warn if any certificate expires within N days (default: 30)
  -h, --help                  Show this help message

Examples:
  # Check certificate expiration dates:
  ./src/k3s_certs.sh check

  # Get JSON report for monitoring/Prometheus:
  ./src/k3s_certs.sh check --json

  # Rotate all certificates:
  ./src/k3s_certs.sh rotate
EOF
}

check_root() {
  if [[ $(id -u) -ne 0 ]]; then
    SUDO="sudo"
  else
    SUDO=""
  fi
}

cmd_check() {
  local as_json=false
  local warn_days=30
  
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --json)
        as_json=true
        shift
        ;;
      --warn-days)
        warn_days="$2"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  check_root

  if [[ ! -d "${TLS_DIR}" ]]; then
    if [[ "${as_json}" == "true" ]]; then
      echo '{"error": "TLS directory not found or node is worker-only", "certificates": []}'
    else
      echo "Notice: TLS directory not found at ${TLS_DIR} (this host may be a worker node or cluster is not yet initialized)."
    fi
    return 0
  fi

  local now_ts
  now_ts=$(date +%s)
  local cert_list=()

  # Find all .crt files
  while IFS= read -r cert_file; do
    if [[ -f "${cert_file}" ]]; then
      cert_list+=("${cert_file}")
    fi
  done < <(${SUDO} find "${TLS_DIR}" -type f -name "*.crt" 2>/dev/null || true)

  if [[ "${as_json}" == "true" ]]; then
    echo "{"
    echo '  "certificates": ['
    local first=true
    for cert in "${cert_list[@]}"; do
      local rel_name="${cert#${TLS_DIR}/}"
      local enddate_str
      enddate_str=$(${SUDO} openssl x509 -enddate -noout -in "${cert}" 2>/dev/null | cut -d= -f2 || echo "Unknown")
      local exp_ts=0
      local days_left=0
      if [[ "${enddate_str}" != "Unknown" ]]; then
        exp_ts=$(date -d "${enddate_str}" +%s 2>/dev/null || echo "0")
        if [[ ${exp_ts} -gt 0 ]]; then
          days_left=$(( (exp_ts - now_ts) / 86400 ))
        fi
      fi
      local is_warning=false
      if [[ ${days_left} -le ${warn_days} ]]; then
        is_warning=true
      fi

      if [[ "${first}" == "true" ]]; then
        first=false
      else
        echo ","
      fi
      printf '    {"name": "%s", "path": "%s", "expiresAt": "%s", "daysRemaining": %d, "warning": %s}' \
        "${rel_name}" "${cert}" "${enddate_str}" "${days_left}" "${is_warning}"
    done
    echo ""
    echo "  ]"
    echo "}"
  else
    echo "================================================================================"
    echo "K3s TLS Certificate Health Inspection (${TLS_DIR})"
    echo "================================================================================"
    printf "%-35s %-25s %-15s %s\n" "CERTIFICATE" "EXPIRATION DATE" "DAYS REMAINING" "STATUS"
    echo "--------------------------------------------------------------------------------"
    local any_warning=false
    for cert in "${cert_list[@]}"; do
      local rel_name="${cert#${TLS_DIR}/}"
      local enddate_str
      enddate_str=$(${SUDO} openssl x509 -enddate -noout -in "${cert}" 2>/dev/null | cut -d= -f2 || echo "Unknown")
      local exp_ts=0
      local days_left=0
      local status_label="✓ OK"
      if [[ "${enddate_str}" != "Unknown" ]]; then
        exp_ts=$(date -d "${enddate_str}" +%s 2>/dev/null || echo "0")
        if [[ ${exp_ts} -gt 0 ]]; then
          days_left=$(( (exp_ts - now_ts) / 86400 ))
        fi
      fi
      if [[ ${days_left} -le ${warn_days} ]]; then
        status_label="⚠️ EXPIRES SOON"
        any_warning=true
      fi
      if [[ ${days_left} -le 0 ]]; then
        status_label="❌ EXPIRED"
        any_warning=true
      fi

      printf "%-35s %-25s %-15s %s\n" "${rel_name}" "${enddate_str:0:24}" "${days_left} days" "${status_label}"
    done
    echo "================================================================================"
    if [[ "${any_warning}" == "true" ]]; then
      echo "⚠️ Some certificates require rotation! Run './src/k3s_certs.sh rotate' to renew."
    else
      echo "✓ All cluster certificates are healthy and within valid lifetime."
    fi
  fi
}

cmd_rotate() {
  check_root
  echo "============================================================"
  echo "Rotating K3s Cluster TLS Certificates..."
  echo "============================================================"
  if command -v k3s >/dev/null 2>&1; then
    echo "1. Executing certificate rotation..."
    ${SUDO} k3s certificate rotate
    echo "2. Restarting k3s service to load renewed certificates..."
    ${SUDO} systemctl restart k3s
    echo "✓ Certificates rotated and services reloaded successfully."
    echo ""
    cmd_check
  else
    echo "Error: k3s binary not found in path." >&2
    exit 1
  fi
}

ACTION="${1:-check}"
shift || true

case "${ACTION}" in
  check)
    cmd_check "$@"
    ;;
  rotate)
    cmd_rotate
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage
    exit 1
    ;;
esac
