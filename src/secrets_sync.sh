#!/usr/bin/env bash
# ==============================================================================
# Vigilant Octo Waffle - Cross-Namespace Secrets Synchronizer (Phase 2)
# ==============================================================================
set -euo pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

THIS_CWD="$(pwd)"
DRY_RUN="false"
GENERATE_MODULAR="false"
CUSTOM_NAMESPACES=""

usage() {
  cat << EOF
${BOLD}Usage:${NC} ./up secrets:sync [OPTIONS]

Synchronizes Kubernetes secrets across application namespaces to eliminate
cross-namespace mounting restrictions and NotFound errors.

${BOLD}Options:${NC}
  --all                   Sync secrets across all active/enabled namespaces (default)
  --namespaces=<ns1,ns2>  Comma-separated list of target namespaces
  --modular               Generate modular secret bundles (.secrets/*-core-secrets.yaml, etc.)
  --dry-run               Print sync plan without applying to cluster
  --help, -h              Show this help message

${BOLD}Examples:${NC}
  ./up secrets:sync
  ./up secrets:sync --modular
  ./up secrets:sync --namespaces=airflow,monitoring,argocd
EOF
  exit 0
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --all)
      shift
      ;;
    --namespaces=*)
      CUSTOM_NAMESPACES="${1#*=}"
      shift
      ;;
    --namespaces)
      CUSTOM_NAMESPACES="$2"
      shift 2
      ;;
    --modular)
      GENERATE_MODULAR="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    --help|-h)
      usage
      ;;
    *)
      echo -e "${RED}Unknown option:${NC} $1" >&2
      usage
      ;;
  esac
done

export PATH="/root/.nvm/versions/node/v24.21.0/bin:${PATH}"

set +u
if [[ -f .env ]]; then
  set -a && source .env && set +a
fi
set -a && source ./src/default.env && set +a
set -u

SECRET_FILE_NAME="${SECRET_FILE:-./.secrets/${THIS_SECRETS:-monitaur-secrets}.yaml}"

echo -e "\n${BOLD}${CYAN}================================================================${NC}"
echo -e "${BOLD}${CYAN}   🥞 Vigilant Octo Waffle - Secrets Distribution Engine       ${NC}"
echo -e "${BOLD}${CYAN}================================================================${NC}\n"

if [[ ! -f "${SECRET_FILE_NAME}" ]]; then
  echo -e "${YELLOW}Master secret file '${SECRET_FILE_NAME}' not found.${NC}"
  echo -e "Generating cluster secrets first via ${BOLD}src/secrets.sh${NC}..."
  ./src/secrets.sh
fi

# Discover target namespaces
TARGET_NAMESPACES=()
if [[ -n "${CUSTOM_NAMESPACES}" ]]; then
  IFS=',' read -ra ADDR <<< "${CUSTOM_NAMESPACES}"
  for ns in "${ADDR[@]}"; do
    TARGET_NAMESPACES+=("$(echo "$ns" | tr -d '[:space:]')")
  done
else
  # Auto-discover based on active configurations
  TARGET_NAMESPACES+=("${THIS_NAME:-monitaur}")
  if [[ "${THIS_NAMESPACE:-monitaur}" != "${THIS_NAME:-monitaur}" ]]; then
    TARGET_NAMESPACES+=("${THIS_NAMESPACE:-monitaur}")
  fi
  TARGET_NAMESPACES+=("monitoring")
  TARGET_NAMESPACES+=("nfs-server")
  TARGET_NAMESPACES+=("cert-manager")
  TARGET_NAMESPACES+=("argocd")
  TARGET_NAMESPACES+=("${THIS_FLUX_NAMESPACE:-flux-system}")

  if [[ "${AIRFLOW_ENABLED:-false}" == "true" ]]; then TARGET_NAMESPACES+=("airflow"); fi
  if [[ "${HARBOR_ENABLED:-false}" == "true" ]]; then TARGET_NAMESPACES+=("harbor"); fi
  if [[ "${OPENSEARCH_ENABLED:-false}" == "true" ]]; then TARGET_NAMESPACES+=("opensearch"); fi
  if [[ "${MINIO_OPERATOR_ENABLED:-false}" == "true" || "${MINIO_TENANT_ENABLED:-false}" == "true" ]]; then TARGET_NAMESPACES+=("minio"); fi
  if [[ "${VELERO_ENABLED:-false}" == "true" ]]; then TARGET_NAMESPACES+=("velero"); fi
  if [[ "${VAULT_ENABLED:-false}" == "true" || "${BAO_ENABLED:-false}" == "true" ]]; then TARGET_NAMESPACES+=("vault"); fi
fi

# De-duplicate namespaces
UNIQUE_NAMESPACES=($(echo "${TARGET_NAMESPACES[@]}" | tr ' ' '\n' | sort -u | tr '\n' ' '))

echo -e "${BOLD}Source Secret:${NC}     ${CYAN}${SECRET_FILE_NAME}${NC}"
echo -e "${BOLD}Target Namespaces:${NC} ${CYAN}${UNIQUE_NAMESPACES[*]}${NC}"
echo -e "${BOLD}Dry Run Mode:${NC}      ${CYAN}${DRY_RUN}${NC}"
echo ""

SYNC_TEMP_DIR=$(mktemp -d --suffix .vow-sync.d)
trap 'rm -rf ${SYNC_TEMP_DIR}' EXIT

# Generate modular bundles if requested
if [[ "${GENERATE_MODULAR}" == "true" ]]; then
  echo -e "${BOLD}Generating modular secret bundles in .secrets/:${NC}"
  node -e "
    import { generateModularSecretBundles } from './packages/orchestrator/dist/index.js';
    import * as fs from 'node:fs';
    import * as path from 'node:path';

    const root = process.cwd();
    const { bundles } = generateModularSecretBundles(root);
    for (const b of bundles) {
      const outPath = path.join(root, '.secrets', b.fileName);
      fs.writeFileSync(outPath, b.manifest, 'utf-8');
      console.log('  \x1b[32m✓\x1b[0m Generated ' + b.fileName + ' (targets: ' + b.targetNamespaces.join(', ') + ')');
    }
  "
  echo ""
fi

# Sync master secret to all unique namespaces
echo -e "${BOLD}Distributing Secrets to Namespaces:${NC}"
CLUSTER_REACHABLE="false"
if kubectl get nodes >/dev/null 2>&1; then
  CLUSTER_REACHABLE="true"
fi

for ns in "${UNIQUE_NAMESPACES[@]}"; do
  # Template a target-specific secret YAML
  sed "s/namespace: .*/namespace: ${ns}/g" "${SECRET_FILE_NAME}" > "${SYNC_TEMP_DIR}/${ns}-secret.yaml"

  if [[ "${DRY_RUN}" == "true" ]]; then
    echo -e "  [DRY-RUN] Would apply ${THIS_SECRETS:-monitaur-secrets} to namespace: ${BOLD}${ns}${NC}"
  elif [[ "${CLUSTER_REACHABLE}" == "true" ]]; then
    # Ensure namespace exists
    if ! kubectl get namespace "${ns}" >/dev/null 2>&1; then
      kubectl create namespace "${ns}" >/dev/null 2>&1 || true
    fi
    # Apply secret
    if kubectl apply -f "${SYNC_TEMP_DIR}/${ns}-secret.yaml" >/dev/null 2>&1; then
      echo -e "  ${GREEN}✓${NC} Synced secret to namespace: ${BOLD}${ns}${NC}"
    else
      echo -e "  ${RED}✗${NC} Failed to sync secret to namespace: ${BOLD}${ns}${NC}"
    fi
  else
    echo -e "  ${YELLOW}•${NC} Prepared secret manifest for namespace: ${BOLD}${ns}${NC} (Cluster currently offline)"
  fi
done

echo -e "\n${GREEN}${BOLD}✓ Secrets distribution complete across ${#UNIQUE_NAMESPACES[@]} namespace(s).${NC}\n"
