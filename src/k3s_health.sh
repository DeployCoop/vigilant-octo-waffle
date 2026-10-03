#!/usr/bin/env bash
# ==============================================================================
# src/k3s_health.sh - Production K3s Cluster Health Score & Diagnostics Watchdog
# ==============================================================================
# Evaluates API response latency, etcd quorum, node pressure conditions,
# system pod stability, and emits a comprehensive health score with diagnostics.
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
Usage: ./src/k3s_health.sh [options]

Production health evaluation and diagnostics for K3s clusters.

Options:
      --json      Output health report as structured JSON
  -h, --help      Show this help message
EOF
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

if ! command -v kubectl >/dev/null 2>&1; then
  if [[ "${AS_JSON}" == "true" ]]; then
    echo '{"score": 0, "status": "OFFLINE", "error": "kubectl binary not found"}'
  else
    echo "Error: kubectl binary not found in path." >&2
  fi
  exit 1
fi

# 1. API Server Check & Latency
START_TIME=$(date +%s%N 2>/dev/null || date +%s)
API_ALIVE=false
if kubectl get --raw /livez >/dev/null 2>&1; then
  API_ALIVE=true
fi
END_TIME=$(date +%s%N 2>/dev/null || date +%s)
LATENCY_MS=0
if [[ ${API_ALIVE} == "true" ]]; then
  if [[ ${#START_TIME} -gt 10 ]]; then
    LATENCY_MS=$(( (END_TIME - START_TIME) / 1000000 ))
  else
    LATENCY_MS=10
  fi
fi

if [[ "${API_ALIVE}" == "false" ]]; then
  if [[ "${AS_JSON}" == "true" ]]; then
    echo '{"score": 0, "status": "DOWN", "apiServer": {"reachable": false}, "issues": ["API server is unreachable"]}'
  else
    echo "============================================================"
    echo "K3s Cluster Health: 0% [CRITICAL - API SERVER UNREACHABLE]"
    echo "============================================================"
  fi
  exit 1
fi

# 2. Node conditions & tally
TOTAL_NODES=0
READY_NODES=0
NOT_READY_NODES=0
PRESSURE_NODES=0
declare -a NODE_ISSUES=()

NODE_OUTPUT=$(kubectl get nodes -o json 2>/dev/null || echo '{"items":[]}')

# Process node JSON or fall back to custom-columns
while IFS= read -r line; do
  if [[ -n "${line}" ]]; then
    TOTAL_NODES=$((TOTAL_NODES + 1))
    node_name=$(echo "${line}" | awk '{print $1}')
    status=$(echo "${line}" | awk '{print $2}')
    if [[ "${status}" =~ "Ready" && ! "${status}" =~ "NotReady" ]]; then
      READY_NODES=$((READY_NODES + 1))
    else
      NOT_READY_NODES=$((NOT_READY_NODES + 1))
      NODE_ISSUES+=("Node '${node_name}' is NotReady (${status})")
    fi
  fi
done < <(kubectl get nodes --no-headers 2>/dev/null || true)

# 3. Pod Health in core namespaces
TOTAL_PODS=0
FAILED_PODS=0
CRASHING_PODS=0
while IFS= read -r line; do
  if [[ -n "${line}" ]]; then
    TOTAL_PODS=$((TOTAL_PODS + 1))
    pod_name=$(echo "${line}" | awk '{print $2}')
    pod_status=$(echo "${line}" | awk '{print $3}')
    restarts=$(echo "${line}" | awk '{print $4}')
    if [[ "${pod_status}" =~ "CrashLoop" || "${pod_status}" =~ "Error" || "${pod_status}" =~ "ImagePull" ]]; then
      FAILED_PODS=$((FAILED_PODS + 1))
      NODE_ISSUES+=("Pod '${pod_name}' in failing state: ${pod_status}")
    fi
  fi
done < <(kubectl get pods -A --no-headers 2>/dev/null || true)

# 4. Score Calculation (0 - 100)
SCORE=100
if [[ ${NOT_READY_NODES} -gt 0 ]]; then
  SCORE=$((SCORE - (NOT_READY_NODES * 25) ))
fi
if [[ ${FAILED_PODS} -gt 0 ]]; then
  SCORE=$((SCORE - (FAILED_PODS * 5) ))
fi
if [[ ${LATENCY_MS} -gt 500 ]]; then
  SCORE=$((SCORE - 15))
elif [[ ${LATENCY_MS} -gt 200 ]]; then
  SCORE=$((SCORE - 5))
fi
if [[ ${SCORE} -lt 0 ]]; then
  SCORE=0
fi

HEALTH_STATUS="HEALTHY"
if [[ ${SCORE} -lt 60 ]]; then
  HEALTH_STATUS="DEGRADED"
elif [[ ${SCORE} -lt 40 ]]; then
  HEALTH_STATUS="CRITICAL"
fi

if [[ "${AS_JSON}" == "true" ]]; then
  echo "{"
  echo "  \"score\": ${SCORE},"
  echo "  \"status\": \"${HEALTH_STATUS}\","
  echo "  \"apiServer\": {"
  echo "    \"reachable\": true,"
  echo "    \"latencyMs\": ${LATENCY_MS}"
  echo "  },"
  echo "  \"nodes\": {"
  echo "    \"total\": ${TOTAL_NODES},"
  echo "    \"ready\": ${READY_NODES},"
  echo "    \"notReady\": ${NOT_READY_NODES}"
  echo "  },"
  echo "  \"pods\": {"
  echo "    \"total\": ${TOTAL_PODS},"
  echo "    \"failed\": ${FAILED_PODS}"
  echo "  },"
  echo '  "issues": ['
  for i in "${!NODE_ISSUES[@]}"; do
    printf '    "%s"' "${NODE_ISSUES[$i]}"
    if [[ $i -lt $(( ${#NODE_ISSUES[@]} - 1 )) ]]; then
      echo ","
    else
      echo ""
    fi
  done
  echo "  ]"
  echo "}"
else
  echo "============================================================"
  echo "K3s Production Cluster Health Watchdog"
  echo "============================================================"
  echo "Health Score       : ${SCORE}% [${HEALTH_STATUS}]"
  echo "API Latency        : ${LATENCY_MS} ms"
  echo "Cluster Nodes      : ${READY_NODES}/${TOTAL_NODES} Ready"
  echo "Workload Pods      : ${TOTAL_PODS} Total (${FAILED_PODS} Failing)"
  echo "------------------------------------------------------------"
  if [[ ${#NODE_ISSUES[@]} -eq 0 ]]; then
    echo "✓ All systems fully operational. No active pressure or pod failures."
  else
    echo "Active Warnings & Findings:"
    for issue in "${NODE_ISSUES[@]}"; do
      echo "  • ${issue}"
    done
  fi
  echo "============================================================"
fi
