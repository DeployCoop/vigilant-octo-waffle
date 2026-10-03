#!/usr/bin/env bash
# ==============================================================================
# Vigilant Octo Waffle: Declarative Namespace Registry & PSS Synchronizer
# Discovers, labels, and provisions all cluster namespaces with Pod Security
# Standards (PSS) baseline/privileged enforcement.
# ==============================================================================
set -euo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${THIS_DIR}/.." && pwd)"

set +u
if [[ -f "${WORKSPACE_ROOT}/.env" ]]; then
  set -a && source "${WORKSPACE_ROOT}/.env" && set +a
fi
set -u

PRIMARY_NAME="${THIS_NAME:-example}"
PRIMARY_NS="${THIS_NAMESPACE:-${PRIMARY_NAME}}"

PSS_ENFORCE_DEFAULT="${THIS_PSS_ENFORCE:-baseline}"
PSS_WARN_DEFAULT="${THIS_PSS_WARN:-restricted}"
PSS_AUDIT_DEFAULT="${THIS_PSS_AUDIT:-restricted}"

DRY_RUN=false
VERBOSE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)
      DRY_RUN=true
      ;;
    --verbose|-v)
      VERBOSE=true
      ;;
    --help|-h)
      echo "Usage: ./src/cluster_namespaces.sh [options]"
      echo ""
      echo "Options:"
      echo "  --dry-run   Print generated namespace manifests without applying"
      echo "  --verbose   Show detailed discovery output"
      echo "  --help      Show this help message"
      exit 0
      ;;
  esac
done

# Set of privileged namespaces requiring hostpath / host networking / root daemonsets
PRIVILEGED_NAMESPACES="kube-system openebs nfs-server longhorn-system seaweedfs cert-manager traefik ingress-nginx"

# Default core infra namespaces to ensure ready
CORE_NAMESPACES=(
  "argocd"
  "flux-system"
  "monitoring"
  "nfs-server"
  "openebs"
  "cert-manager"
  "ingress-nginx"
  "traefik"
  "velero"
  "minio"
  "opensearch"
  "vault"
)

declare -A DETECTED_NAMESPACES

# 1. Primary user namespace
DETECTED_NAMESPACES["${PRIMARY_NAME}"]="user"
if [[ "${PRIMARY_NS}" != "${PRIMARY_NAME}" ]]; then
  DETECTED_NAMESPACES["${PRIMARY_NS}"]="user"
fi

# 2. Core namespaces
for ns in "${CORE_NAMESPACES[@]}"; do
  DETECTED_NAMESPACES["$ns"]="core"
done

# 3. Dynamic scan from argo/ manifests
if [[ -d "${WORKSPACE_ROOT}/argo" ]]; then
  for argo_file in "${WORKSPACE_ROOT}"/argo/*/argocd.yaml; do
    if [[ -f "$argo_file" ]]; then
      # Extract namespace if not variable
      ns=$(grep -E '^\s*namespace:\s*' "$argo_file" | head -n 1 | awk '{print $2}' | tr -d '"' | tr -d "'" || true)
      if [[ -n "$ns" && "$ns" != *'$'* && "$ns" != *'{'* ]]; then
        DETECTED_NAMESPACES["$ns"]="app"
      fi
    fi
  done
fi

# 4. Dynamic scan from flux/ manifests
if [[ -d "${WORKSPACE_ROOT}/flux" ]]; then
  for flux_file in "${WORKSPACE_ROOT}"/flux/*/flux.yaml; do
    if [[ -f "$flux_file" ]]; then
      ns=$(grep -E '^\s*(targetNamespace|namespace):\s*' "$flux_file" | head -n 1 | awk '{print $2}' | tr -d '"' | tr -d "'" || true)
      if [[ -n "$ns" && "$ns" != *'$'* && "$ns" != *'{'* ]]; then
        DETECTED_NAMESPACES["$ns"]="app"
      fi
    fi
  done
fi

TMP_DIR=$(mktemp -d --suffix .vow-ns.d)
trap 'rm -rf "${TMP_DIR}"' EXIT

MANIFEST_FILE="${TMP_DIR}/all-namespaces.yaml"
: > "${MANIFEST_FILE}"

echo "==> Discovering and generating declarative namespaces with PSS compliance..."

for ns in "${!DETECTED_NAMESPACES[@]}"; do
  category="${DETECTED_NAMESPACES[$ns]}"
  pss_enforce="${PSS_ENFORCE_DEFAULT}"
  pss_warn="${PSS_WARN_DEFAULT}"
  pss_audit="${PSS_AUDIT_DEFAULT}"

  if [[ " ${PRIVILEGED_NAMESPACES} " =~ " ${ns} " ]]; then
    pss_enforce="privileged"
    pss_warn="baseline"
    pss_audit="baseline"
  fi

  cat <<EOF >> "${MANIFEST_FILE}"
apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
  labels:
    kubernetes.io/metadata.name: ${ns}
    pod-security.kubernetes.io/enforce: ${pss_enforce}
    pod-security.kubernetes.io/enforce-version: latest
    pod-security.kubernetes.io/warn: ${pss_warn}
    pod-security.kubernetes.io/warn-version: latest
    pod-security.kubernetes.io/audit: ${pss_audit}
    pod-security.kubernetes.io/audit-version: latest
    app.kubernetes.io/managed-by: vow
    vow.dev/category: ${category}
---
EOF
  if [[ "${VERBOSE}" == "true" ]]; then
    echo "  [+] Discovered: ${ns} (category=${category}, enforce=${pss_enforce})"
  fi
done

if [[ "${DRY_RUN}" == "true" ]]; then
  echo "--- Manifest Output (Dry Run) ---"
  cat "${MANIFEST_FILE}"
  exit 0
fi

if command -v kubectl >/dev/null 2>&1; then
  echo "==> Applying declarative cluster namespaces via kubectl..."
  kubectl apply -f "${MANIFEST_FILE}"
  echo "==> All ${#DETECTED_NAMESPACES[@]} namespaces synchronized successfully."
else
  echo "WARNING: kubectl not found or cluster unreachable; skipped apply."
fi
