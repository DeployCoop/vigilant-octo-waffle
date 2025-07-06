#!/usr/bin/env bash

argoRunner () {
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
  #envsubst < argo/${THIS_THING}/argocd.yaml | argocd app create --name ${THIS_THING} --grpc-web -f -
  cd "argo/${THIS_THING}"
  envsubst < argocd.yaml | argocd app create --name ${THIS_THING} --grpc-web -f -
  cd "${this_cwd}"
}
