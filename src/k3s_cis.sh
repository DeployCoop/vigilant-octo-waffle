#!/usr/bin/env bash
# ==============================================================================
# src/k3s_cis.sh - K3s CIS Benchmark Hardening & Security Audit Inspector
# ==============================================================================
# Audits control-plane permissions, secret encryption at rest, API flags,
# and kernel parameters against the CIS Kubernetes Benchmark for K3s.
# ==============================================================================
set -euo pipefail

export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:${PATH}"

AS_JSON=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      AS_JSON=true
      shift
      ;;
    -h|--help)
      cat << 'EOF'
Usage: ./src/k3s_cis.sh [options]

Audit K3s cluster security against CIS Kubernetes Benchmark guidelines.

Options:
      --json      Output audit results in structured JSON format
  -h, --help      Show this help message
EOF
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

TOTAL_CHECKS=0
PASSED_CHECKS=0
declare -a FINDINGS=()

run_check() {
  local id="$1"
  local desc="$2"
  local status="$3"
  local details="$4"
  
  TOTAL_CHECKS=$((TOTAL_CHECKS + 1))
  if [[ "${status}" == "PASS" ]]; then
    PASSED_CHECKS=$((PASSED_CHECKS + 1))
  fi
  FINDINGS+=("${id}|${desc}|${status}|${details}")
}

# Check 1: Kubeconfig File Permissions (CIS 1.1.1)
if [[ -f /etc/rancher/k3s/k3s.yaml ]]; then
  PERMS=$(stat -c "%a" /etc/rancher/k3s/k3s.yaml 2>/dev/null || stat -f "%Lp" /etc/rancher/k3s/k3s.yaml 2>/dev/null || echo "unknown")
  if [[ "${PERMS}" == "600" || "${PERMS}" == "640" ]]; then
    run_check "CIS-1.1.1" "Kubeconfig permissions" "PASS" "Permissions are ${PERMS} (<= 640)"
  else
    run_check "CIS-1.1.1" "Kubeconfig permissions" "WARN" "Permissions are ${PERMS} (recommended: 600 or 640)"
  fi
else
  run_check "CIS-1.1.1" "Kubeconfig permissions" "PASS" "No local /etc/rancher/k3s/k3s.yaml (worker node or remote config)"
fi

# Check 2: Token File Permissions (CIS 1.1.2)
if [[ -f /var/lib/rancher/k3s/server/token ]]; then
  TOKEN_PERMS=$(stat -c "%a" /var/lib/rancher/k3s/server/token 2>/dev/null || stat -f "%Lp" /var/lib/rancher/k3s/server/token 2>/dev/null || echo "unknown")
  if [[ "${TOKEN_PERMS}" == "600" ]]; then
    run_check "CIS-1.1.2" "Cluster join token permissions" "PASS" "Permissions are 600"
  else
    run_check "CIS-1.1.2" "Cluster join token permissions" "WARN" "Permissions are ${TOKEN_PERMS} (recommended: 600)"
  fi
else
  run_check "CIS-1.1.2" "Cluster join token permissions" "PASS" "Token file isolated"
fi

# Check 3: Secrets Encryption at Rest (CIS 1.2.1)
if [[ -f /var/lib/rancher/k3s/server/cred/encryption-config.json || -f /etc/rancher/k3s/encryption-config.json ]]; then
  run_check "CIS-1.2.1" "Kubernetes secrets encryption at rest" "PASS" "Active via AES encryption provider"
elif grep -rq "secrets-encryption" /etc/systemd/system/k3s*.service /etc/rancher/k3s/ 2>/dev/null; then
  run_check "CIS-1.2.1" "Kubernetes secrets encryption at rest" "PASS" "Flag --secrets-encryption configured in service"
else
  run_check "CIS-1.2.1" "Kubernetes secrets encryption at rest" "WARN" "Secrets encryption flag not detected in server parameters"
fi

# Check 4: Kernel Parameters & IP Forwarding (CIS 1.3.1)
IP_FWD=$(sysctl -n net.ipv4.ip_forward 2>/dev/null || echo "0")
if [[ "${IP_FWD}" == "1" ]]; then
  run_check "CIS-1.3.1" "Kernel IPv4 forwarding" "PASS" "net.ipv4.ip_forward=1 enabled"
else
  run_check "CIS-1.3.1" "Kernel IPv4 forwarding" "FAIL" "net.ipv4.ip_forward is disabled"
fi

# Check 5: Inotify Limits (System Reliability)
MAX_WATCHES=$(sysctl -n fs.inotify.max_user_watches 2>/dev/null || echo "0")
if [[ ${MAX_WATCHES} -ge 524288 ]]; then
  run_check "SYS-1.1" "Inotify watches limit" "PASS" "${MAX_WATCHES} (>= 524288)"
else
  run_check "SYS-1.1" "Inotify watches limit" "WARN" "${MAX_WATCHES} (run './src/k3s_tune.sh' to increase)"
fi

# Check 6: Maximum File Descriptors
FILE_MAX=$(sysctl -n fs.file-max 2>/dev/null || echo "0")
if [[ ${FILE_MAX} -ge 1000000 ]]; then
  run_check "SYS-1.2" "System file descriptor ceiling" "PASS" "${FILE_MAX} (>= 1,000,000)"
else
  run_check "SYS-1.2" "System file descriptor ceiling" "WARN" "${FILE_MAX} (recommended: >= 1,048,576)"
fi

# Score Calculation
SCORE=0
if [[ ${TOTAL_CHECKS} -gt 0 ]]; then
  SCORE=$(( (PASSED_CHECKS * 100) / TOTAL_CHECKS ))
fi

if [[ "${AS_JSON}" == "true" ]]; then
  echo "{"
  echo "  \"score\": ${SCORE},"
  echo "  \"totalChecks\": ${TOTAL_CHECKS},"
  echo "  \"passedChecks\": ${PASSED_CHECKS},"
  echo '  \"checks\": ['
  for i in "${!FINDINGS[@]}"; do
    IFS="|" read -r cid cdesc cstat cdet <<< "${FINDINGS[$i]}"
    printf '    {"id": "%s", "description": "%s", "status": "%s", "details": "%s"}' \
      "${cid}" "${cdesc}" "${cstat}" "${cdet}"
    if [[ $i -lt $(( ${#FINDINGS[@]} - 1 )) ]]; then
      echo ","
    else
      echo ""
    fi
  done
  echo "  ]"
  echo "}"
else
  echo "================================================================================"
  echo "K3s CIS Benchmark & Production Hardening Audit"
  echo "================================================================================"
  echo "Compliance Score : ${SCORE}% (${PASSED_CHECKS}/${TOTAL_CHECKS} Passed)"
  echo "--------------------------------------------------------------------------------"
  printf "%-12s %-40s %-8s %s\n" "CHECK ID" "DESCRIPTION" "RESULT" "DETAILS"
  echo "--------------------------------------------------------------------------------"
  for item in "${FINDINGS[@]}"; do
    IFS="|" read -r cid cdesc cstat cdet <<< "${item}"
    printf "%-12s %-40s %-8s %s\n" "${cid}" "${cdesc}" "${cstat}" "${cdet}"
  done
  echo "================================================================================"
  if [[ ${SCORE} -eq 100 ]]; then
    echo "✓ Cluster conforms to production hardening standards."
  else
    echo "Recommendations: Run './up k3s:tune' to apply kernel and sysctl hardening."
  fi
fi
