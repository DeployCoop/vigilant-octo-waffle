#!/usr/bin/env bash
# ==============================================================================
# Vigilant Octo Waffle - Configuration Doctor & Dependency Reconciler
# ==============================================================================
set -euo pipefail

# ANSI formatting
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

THIS_CWD="$(pwd)"
MODE="check" # check, fix, json
STRICT="false"
CHECK_CLUSTER="false"

usage() {
  cat << EOF
${BOLD}Usage:${NC} ./up config:doctor [OPTIONS]

Inspect, validate, and automatically fix configuration drift, stale variable cascades,
quote corruptions, and namespace discrepancies in .env.

${BOLD}Options:${NC}
  --check        Run diagnostic check and print human-readable report (default)
  --fix          Automatically reconcile stale variables and update .env
  --json         Output raw JSON report
  --cluster      Also check live Kubernetes cluster for namespace presence
  --strict       Exit with code 1 if any warnings or errors are present
  --help, -h     Show this help message

${BOLD}Examples:${NC}
  ./up config:doctor
  ./up config:doctor --fix
  ./up config:doctor --check --cluster
EOF
  exit 0
}

# Parse flags
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      MODE="check"
      shift
      ;;
    --fix)
      MODE="fix"
      shift
      ;;
    --json)
      MODE="json"
      shift
      ;;
    --cluster)
      CHECK_CLUSTER="true"
      shift
      ;;
    --strict)
      STRICT="true"
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

# Execute Node engine doctor if available
run_node_doctor() {
  local script_code="
    import { checkConfig, reconcileConfig } from './packages/orchestrator/dist/index.js';
    const root = process.cwd();
    let report;
    if ('${MODE}' === 'fix') {
      report = reconcileConfig(root, { applyFixes: true });
    } else {
      report = checkConfig(root);
    }
    console.log(JSON.stringify(report));
  "

  if command -v node >/dev/null 2>&1 && [[ -f "./packages/orchestrator/dist/index.js" ]]; then
    node --input-type=module -e "${script_code}" 2>/dev/null || return 1
  else
    return 1
  fi
}

REPORT_JSON=""
if REPORT_JSON=$(run_node_doctor); then
  USE_NODE_REPORT="true"
else
  USE_NODE_REPORT="false"
fi

if [[ "${MODE}" == "json" ]]; then
  if [[ "${USE_NODE_REPORT}" == "true" ]]; then
    echo "${REPORT_JSON}"
  else
    echo "{\"error\": \"Node.js orchestrator engine not compiled. Run pnpm build first.\"}" >&2
    exit 1
  fi
  exit 0
fi

echo -e "\n${BOLD}${CYAN}================================================================${NC}"
echo -e "${BOLD}${CYAN}   🥞 Vigilant Octo Waffle - Configuration Doctor (Phase 1)   ${NC}"
echo -e "${BOLD}${CYAN}================================================================${NC}\n"

set +u
if [[ -f .env ]]; then
  set -a && source .env && set +a
else
  echo -e "${YELLOW}⚠️  Warning:${NC} .env file does not exist. Using defaults from src/default.env."
fi
set -a && source ./src/default.env && set +a
set -u

TOTAL_ERRORS=0
TOTAL_WARNINGS=0
TOTAL_FIXES=0

if [[ "${USE_NODE_REPORT}" == "true" ]]; then
  # Parse JSON summary using node
  TOTAL_ISSUES=$(node -e "console.log((${REPORT_JSON}).summary.totalIssues)")
  TOTAL_ERRORS=$(node -e "console.log((${REPORT_JSON}).summary.errors)")
  TOTAL_WARNINGS=$(node -e "console.log((${REPORT_JSON}).summary.warnings)")
  FIXABLE=$(node -e "console.log((${REPORT_JSON}).summary.fixable)")

  if [[ "${MODE}" == "fix" ]]; then
    FIXES_COUNT=$(node -e "console.log(Object.keys((${REPORT_JSON}).fixesApplied || {}).length)")
    TOTAL_FIXES=${FIXES_COUNT}
    if [[ ${TOTAL_FIXES} -gt 0 ]]; then
      echo -e "${GREEN}${BOLD}✓ Applied ${TOTAL_FIXES} automated configuration cascade fixes to .env:${NC}"
      node -e "
        const fixes = (${REPORT_JSON}).fixesApplied || {};
        for (const [k, v] of Object.entries(fixes)) {
          console.log('  • \x1b[1m' + k + '\x1b[0m: ' + '\x1b[31m\"' + v.from + '\"\x1b[0m ➔ \x1b[32m\"' + v.to + '\"\x1b[0m');
        }
      "
      echo ""
    fi
  fi

  echo -e "${BOLD}Current Configuration Snapshot:${NC}"
  echo -e "  • ${BOLD}THIS_NAME:${NC}       ${CYAN}${THIS_NAME:-unset}${NC}"
  echo -e "  • ${BOLD}THIS_NAMESPACE:${NC}  ${CYAN}${THIS_NAMESPACE:-unset}${NC}"
  echo -e "  • ${BOLD}THIS_DOMAIN:${NC}     ${CYAN}${THIS_DOMAIN:-unset}${NC}"
  echo -e "  • ${BOLD}THIS_SECRETS:${NC}    ${CYAN}${THIS_SECRETS:-unset}${NC}"
  echo -e "  • ${BOLD}K8s Platform:${NC}    ${CYAN}${THIS_K8S_TYPE:-unset}${NC}"
  echo -e "  • ${BOLD}Ingress:${NC}         ${CYAN}${THIS_CLUSTER_INGRESS:-unset}${NC}"
  echo -e "  • ${BOLD}CD Runner:${NC}       ${CYAN}${THIS_CD_RUNNER:-unset}${NC}"
  echo ""

  if [[ ${TOTAL_ISSUES} -eq 0 ]]; then
    echo -e "${GREEN}${BOLD}✓ All configuration checks passed! No issues detected.${NC}\n"
  else
    echo -e "${BOLD}Diagnostic Issues Found (${TOTAL_ISSUES}):${NC}"
    node -e "
      const issues = (${REPORT_JSON}).issues || [];
      for (const i of issues) {
        const badge = i.severity === 'error' ? '\x1b[31m[ERROR]\x1b[0m' : '\x1b[33m[WARN]\x1b[0m';
        console.log('  ' + badge + ' \x1b[1m' + i.key + '\x1b[0m: ' + i.message);
        if (i.currentValue !== undefined) console.log('    Current:   \"' + i.currentValue + '\"');
        if (i.suggestedValue !== undefined) console.log('    Suggested: \"' + i.suggestedValue + '\" (Auto-fixable: ' + i.autoFixable + ')');
      }
    "
    echo ""
    if [[ "${MODE}" != "fix" && ${FIXABLE} -gt 0 ]]; then
      echo -e "${YELLOW}👉 Run ${BOLD}./up config:doctor --fix${NC}${YELLOW} to automatically resolve ${FIXABLE} fixable issue(s).${NC}\n"
    fi
  fi
else
  # Pure bash inspection fallback
  echo -e "${BOLD}Configuration Snapshot (Bash Fallback):${NC}"
  echo -e "  • THIS_NAME:      ${THIS_NAME}"
  echo -e "  • THIS_NAMESPACE: ${THIS_NAMESPACE}"
  echo -e "  • THIS_DOMAIN:    ${THIS_DOMAIN}"
  echo -e "  • THIS_SECRETS:   ${THIS_SECRETS}"
  echo ""

  if [[ "${THIS_NAMESPACE}" != "${THIS_NAME}" ]]; then
    echo -e "${YELLOW}[WARN] THIS_NAMESPACE (${THIS_NAMESPACE}) differs from THIS_NAME (${THIS_NAME}).${NC}"
    ((TOTAL_WARNINGS++))
  fi
fi

# Optional cluster verification
if [[ "${CHECK_CLUSTER}" == "true" ]]; then
  echo -e "${BOLD}Live Cluster Namespace Verification:${NC}"
  if kubectl get nodes >/dev/null 2>&1; then
    echo -e "  ${GREEN}✓ Cluster is reachable via kubectl.${NC}"
    for ns in "${THIS_NAME}" "${THIS_NAMESPACE}" monitoring nfs-server cert-manager; do
      if kubectl get namespace "$ns" >/dev/null 2>&1; then
        echo -e "  • Namespace ${BOLD}$ns${NC}: ${GREEN}Active${NC}"
      else
        echo -e "  • Namespace ${BOLD}$ns${NC}: ${RED}Missing${NC}"
        ((TOTAL_WARNINGS++))
      fi
    done
  else
    echo -e "  ${YELLOW}⚠️  Kubernetes cluster is not running or unreachable.${NC}"
  fi
  echo ""
fi

if [[ "${STRICT}" == "true" && (${TOTAL_ERRORS} -gt 0 || ${TOTAL_WARNINGS} -gt 0) ]]; then
  exit 1
fi

exit 0
