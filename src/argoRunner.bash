#!/usr/bin/env bash
source src/merge2yaml.bash

argoRunner () {
  TMP=$(mktemp -d --suffix .tmp.d)
  trap 'rm -rf ${TMP}' EXIT
  this_cwd=$(pwd)
  if [[ $# -eq 1 ]]; then
    THIS_THING=$1
  else
    echo "wrong number of args $#"
    exit 1
  fi
  set -eu
  set -a && source ./.env && set +a
  if [[ ${VERBOSITY} -gt 10 ]]; then
    set -x
  fi
  if [[ -f ".argo_overrides/${THIS_THING}/argocd.yaml" ]]; then
    merge2yaml ".argo_overrides/${THIS_THING}/argocd.yaml" "argo/${THIS_THING}/argocd.yaml" > "${TMP}/argocd.yaml"
  else
    cp -a "argo/${THIS_THING}" ${TMP}/
  fi
  envsubst < "${TMP}/argocd.yaml" | argocd app create --name "${THIS_THING}" --grpc-web -f -

  cd "${this_cwd}"
}
