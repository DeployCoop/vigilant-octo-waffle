#!/usr/bin/env bash
# ==============================================================================
# Vigilant Octo Waffle: Unified GitOps Multi-CD Status Aggregator
# Combines ArgoCD and FluxCD application states, health checks, and sync drift.
# ==============================================================================
set -euo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "${THIS_DIR}/.." && pwd)"

set +u
if [[ -f "${WORKSPACE_ROOT}/.env" ]]; then
  set -a && source "${WORKSPACE_ROOT}/.env" && set +a
fi
set -u

OUTPUT_FORMAT="text"

for arg in "$@"; do
  case "$arg" in
    --json|-j)
      OUTPUT_FORMAT="json"
      ;;
    --help|-h)
      echo "Usage: ./up cd:status [options]"
      echo ""
      echo "Options:"
      echo "  --json, -j   Output unified CD status in JSON format"
      echo "  --help, -h   Show this help message"
      exit 0
      ;;
  esac
done

if ! command -v kubectl >/dev/null 2>&1; then
  echo "Error: kubectl is not available in PATH" >&2
  exit 1
fi

if [[ "${OUTPUT_FORMAT}" == "json" ]]; then
  # JSON aggregator
  node -e "
    const { execSync } = require('child_process');
    let argoApps = [];
    let fluxReleases = [];
    let fluxKustomizations = [];

    try {
      const argoRaw = execSync('kubectl get applications.argoproj.io -A -o json 2>/dev/null || echo {}', { encoding: 'utf8' });
      const parsed = JSON.parse(argoRaw || '{}');
      if (parsed.items) {
        argoApps = parsed.items.map(item => ({
          name: item.metadata?.name,
          namespace: item.metadata?.namespace,
          syncStatus: item.status?.sync?.status || 'Unknown',
          healthStatus: item.status?.health?.status || 'Unknown',
          targetRevision: item.spec?.source?.targetRevision || 'HEAD',
          destinationNamespace: item.spec?.destination?.namespace,
          repoURL: item.spec?.source?.repoURL,
        }));
      }
    } catch {}

    try {
      const fluxRaw = execSync('kubectl get helmreleases.helm.toolkit.fluxcd.io -A -o json 2>/dev/null || echo {}', { encoding: 'utf8' });
      const parsed = JSON.parse(fluxRaw || '{}');
      if (parsed.items) {
        fluxReleases = parsed.items.map(item => {
          const readyCond = (item.status?.conditions || []).find(c => c.type === 'Ready');
          return {
            name: item.metadata?.name,
            namespace: item.metadata?.namespace,
            targetNamespace: item.spec?.targetNamespace || item.metadata?.namespace,
            ready: readyCond ? readyCond.status === 'True' : false,
            message: readyCond?.message || 'Unknown',
            chart: item.spec?.chart?.spec?.chart,
            lastAppliedRevision: item.status?.lastAppliedRevision,
          };
        });
      }
    } catch {}

    try {
      const kustomizeRaw = execSync('kubectl get kustomizations.kustomize.toolkit.fluxcd.io -A -o json 2>/dev/null || echo {}', { encoding: 'utf8' });
      const parsed = JSON.parse(kustomizeRaw || '{}');
      if (parsed.items) {
        fluxKustomizations = parsed.items.map(item => {
          const readyCond = (item.status?.conditions || []).find(c => c.type === 'Ready');
          return {
            name: item.metadata?.name,
            namespace: item.metadata?.namespace,
            ready: readyCond ? readyCond.status === 'True' : false,
            message: readyCond?.message || 'Unknown',
            path: item.spec?.path,
            lastAppliedRevision: item.status?.lastAppliedRevision,
          };
        });
      }
    } catch {}

    console.log(JSON.stringify({
      runner: process.env.THIS_CD_RUNNER || 'argocd',
      argoApplications: argoApps,
      fluxHelmReleases: fluxReleases,
      fluxKustomizations: fluxKustomizations,
      summary: {
        totalArgo: argoApps.length,
        totalFluxReleases: fluxReleases.length,
        totalFluxKustomizations: fluxKustomizations.length,
      }
    }, null, 2));
  "
  exit 0
fi

echo "================================================================================"
echo "          Vigilant Octo Waffle: GitOps Multi-CD Status Dashboard               "
echo "================================================================================"
echo "Configured CD Runner: ${THIS_CD_RUNNER:-argocd}"
echo ""

echo "--- ArgoCD Applications ---"
if kubectl get crd applications.argoproj.io >/dev/null 2>&1; then
  kubectl get applications.argoproj.io -A -o custom-columns="NAMESPACE:.metadata.namespace,NAME:.metadata.name,SYNC:.status.sync.status,HEALTH:.status.health.status,DEST_NS:.spec.destination.namespace" 2>/dev/null || echo "No ArgoCD applications found."
else
  echo "ArgoCD CRDs not installed on cluster."
fi
echo ""

echo "--- FluxCD HelmReleases ---"
if kubectl get crd helmreleases.helm.toolkit.fluxcd.io >/dev/null 2>&1; then
  kubectl get helmreleases.helm.toolkit.fluxcd.io -A -o custom-columns="NAMESPACE:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[?(@.type=='Ready')].status,STATUS:.status.conditions[?(@.type=='Ready')].message" 2>/dev/null || echo "No FluxCD HelmReleases found."
else
  echo "FluxCD HelmRelease CRDs not installed on cluster."
fi
echo ""

echo "--- FluxCD Kustomizations ---"
if kubectl get crd kustomizations.kustomize.toolkit.fluxcd.io >/dev/null 2>&1; then
  kubectl get kustomizations.kustomize.toolkit.fluxcd.io -A -o custom-columns="NAMESPACE:.metadata.namespace,NAME:.metadata.name,READY:.status.conditions[?(@.type=='Ready')].status,PATH:.spec.path" 2>/dev/null || echo "No FluxCD Kustomizations found."
else
  echo "FluxCD Kustomization CRDs not installed on cluster."
fi
echo "================================================================================"
