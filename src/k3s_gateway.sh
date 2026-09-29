#!/usr/bin/env bash
# ==============================================================================
# src/k3s_gateway.sh - Kubernetes Gateway API v1.1+ & L7 Canary Router
# ==============================================================================
# Manages official Kubernetes Gateway API CRDs, Gateway instances, and HTTPRoute
# weighted canary traffic shifting (e.g. 90% stable / 10% canary).
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

GATEWAY_API_VERSION="${GATEWAY_API_VERSION:-v1.1.0}"
DOMAIN="${THIS_DOMAIN:-127.0.0.1.sslip.io}"
JSON_OUTPUT=false
DRY_RUN=false
ROUTE_NAME=""
STABLE_SVC=""
CANARY_SVC=""
CANARY_WEIGHT=10
PORT=80
ACTION="${1:-status}"
shift || true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json)
      JSON_OUTPUT=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --route)
      ROUTE_NAME="$2"
      shift 2
      ;;
    --stable-svc)
      STABLE_SVC="$2"
      shift 2
      ;;
    --canary-svc)
      CANARY_SVC="$2"
      shift 2
      ;;
    --canary-weight)
      CANARY_WEIGHT="$2"
      shift 2
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    -h|--help)
      cat << 'EOF'
Usage: ./src/k3s_gateway.sh <action> [options]

Kubernetes Gateway API v1.1+ orchestrator and weighted canary traffic splitter.

Actions:
  status                        Check Gateway API CRDs, Gateways, and HTTPRoutes
  install-crds                  Deploy official Kubernetes Gateway API standard CRDs
  deploy-gateway                Deploy primary cluster Gateway instance (vigilant-gateway)
  canary                        Deploy/update HTTPRoute with weighted canary splitting
  list-routes                   List active HTTPRoutes in cluster

Options:
      --route <name>            Name of HTTPRoute resource
      --stable-svc <svc>        Stable backend Kubernetes Service name
      --canary-svc <svc>        Canary backend Kubernetes Service name
      --canary-weight <pct>     Canary traffic percentage (0-100, default: 10)
      --port <port>             Target Service port (default: 80)
      --dry-run                 Output generated manifests without applying
      --json                    Output status and route details in structured JSON
  -h, --help                    Show this help message

Examples:
  ./src/k3s_gateway.sh status --json
  ./src/k3s_gateway.sh install-crds
  ./src/k3s_gateway.sh canary --route my-app --stable-svc my-app-v1 --canary-svc my-app-v2 --canary-weight 15
EOF
      exit 0
      ;;
    *)
      shift
      ;;
  esac
done

cmd_status() {
  local crds_installed=false
  local gateways_count=0
  local routes_count=0
  local default_gateway_present=false

  if command -v kubectl >/dev/null 2>&1; then
    if kubectl get crd gateways.gateway.networking.k8s.io >/dev/null 2>&1; then
      crds_installed=true
      gateways_count=$(kubectl get gateway -A --no-headers 2>/dev/null | wc -l | tr -d '[:space:]' || true)
      gateways_count="${gateways_count:-0}"
      routes_count=$(kubectl get httproute -A --no-headers 2>/dev/null | wc -l | tr -d '[:space:]' || true)
      routes_count="${routes_count:-0}"
      if kubectl get gateway -n default vigilant-gateway >/dev/null 2>&1; then
        default_gateway_present=true
      fi
    fi
  fi

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "gatewayApiInstalled": ${crds_installed},
  "version": "${GATEWAY_API_VERSION}",
  "totalGateways": ${gateways_count},
  "totalHttpRoutes": ${routes_count},
  "defaultGatewayActive": ${default_gateway_present},
  "domain": "${DOMAIN}"
}
EOF
    return 0
  fi

  echo "============================================================"
  echo "Kubernetes Gateway API Status"
  echo "============================================================"
  echo "Standard CRDs Installed: $( [[ "${crds_installed}" == "true" ]] && echo "YES (${GATEWAY_API_VERSION})" || echo "NOT INSTALLED" )"
  echo "Active Gateway Instances: ${gateways_count}"
  echo "Active HTTPRoute Rules : ${routes_count}"
  echo "Default Gateway        : $( [[ "${default_gateway_present}" == "true" ]] && echo "ACTIVE (vigilant-gateway)" || echo "NOT DEPLOYED" )"
  echo "Cluster Gateway Domain : ${DOMAIN}"
  echo "============================================================"
}

cmd_install_crds() {
  echo "--> Installing Kubernetes Gateway API Standard CRDs (${GATEWAY_API_VERSION})..."
  local crd_url="https://github.com/kubernetes-sigs/gateway-api/releases/download/${GATEWAY_API_VERSION}/standard-install.yaml"
  
  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "[DRY-RUN] Would apply: ${crd_url}"
    return 0
  fi

  kubectl apply -f "${crd_url}"
  echo "Gateway API Standard CRDs successfully installed."
}

cmd_deploy_gateway() {
  echo "--> Deploying primary cluster Gateway (vigilant-gateway)..."
  local manifest
  manifest=$(cat << EOF
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: vigilant-gateway
  namespace: default
spec:
  gatewayClassName: cilium
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      hostname: "*.${DOMAIN}"
      allowedRoutes:
        namespaces:
          from: All
EOF
)

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "${manifest}"
    return 0
  fi

  echo "${manifest}" | kubectl apply -f -
  echo "Primary Gateway 'vigilant-gateway' applied successfully."
}

cmd_canary() {
  if [[ -z "${ROUTE_NAME}" || -z "${STABLE_SVC}" || -z "${CANARY_SVC}" ]]; then
    echo "Error: --route, --stable-svc, and --canary-svc are required for canary routing."
    exit 1
  fi

  local stable_weight=$((100 - CANARY_WEIGHT))
  if [[ ${stable_weight} -lt 0 ]]; then
    stable_weight=0
    CANARY_WEIGHT=100
  fi

  echo "--> Generating HTTPRoute '${ROUTE_NAME}' (Stable: ${stable_weight}%, Canary: ${CANARY_WEIGHT}%)..."

  local manifest
  manifest=$(cat << EOF
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: ${ROUTE_NAME}
  namespace: default
  labels:
    app.kubernetes.io/managed-by: vigilant-octo-waffle
    traffic.routing/type: canary
spec:
  parentRefs:
    - name: vigilant-gateway
  hostnames:
    - "${ROUTE_NAME}.${DOMAIN}"
  rules:
    - matches:
        - headers:
            - name: x-canary
              value: "true"
      backendRefs:
        - name: ${CANARY_SVC}
          port: ${PORT}
          weight: 100
    - backendRefs:
        - name: ${STABLE_SVC}
          port: ${PORT}
          weight: ${stable_weight}
        - name: ${CANARY_SVC}
          port: ${PORT}
          weight: ${CANARY_WEIGHT}
EOF
)

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo "${manifest}"
    return 0
  fi

  echo "${manifest}" | kubectl apply -f -

  if [[ "${JSON_OUTPUT}" == "true" ]]; then
    cat << EOF
{
  "success": true,
  "route": "${ROUTE_NAME}",
  "stableService": "${STABLE_SVC}",
  "stableWeight": ${stable_weight},
  "canaryService": "${CANARY_SVC}",
  "canaryWeight": ${CANARY_WEIGHT},
  "hostname": "${ROUTE_NAME}.${DOMAIN}"
}
EOF
    return 0
  fi

  echo "HTTPRoute '${ROUTE_NAME}' successfully deployed with ${stable_weight}% stable / ${CANARY_WEIGHT}% canary."
}

case "${ACTION}" in
  status)
    cmd_status
    ;;
  install-crds)
    cmd_install_crds
    ;;
  deploy-gateway)
    cmd_deploy_gateway
    ;;
  canary)
    cmd_canary
    ;;
  list-routes)
    kubectl get httproute -A 2>/dev/null || echo "No HTTPRoutes found."
    ;;
  *)
    cmd_status
    ;;
esac
