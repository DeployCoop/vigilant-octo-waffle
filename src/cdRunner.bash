#!/usr/bin/env bash
source src/argoRunner.bash
source src/fluxRunner.bash

cdRunner () {
  if [[ $# -ne 1 ]]; then
    echo "Usage: cdRunner <app_name>"
    exit 1
  fi

  local thing="$1"
  local runner="${THIS_CD_RUNNER:-argocd}"

  case "${runner}" in
    argocd)
      argoRunner "${thing}"
      ;;
    flux|fluxcd)
      fluxRunner "${thing}"
      ;;
    both)
      echo "==> [Multi-CD] Deploying '${thing}' to ArgoCD"
      argoRunner "${thing}"
      echo "==> [Multi-CD] Deploying '${thing}' to FluxCD"
      fluxRunner "${thing}"
      ;;
    *)
      echo "Unknown THIS_CD_RUNNER: '${runner}'. Allowed: argocd, flux, both"
      exit 1
      ;;
  esac
}
